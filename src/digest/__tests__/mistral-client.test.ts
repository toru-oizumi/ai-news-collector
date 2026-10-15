import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("MISTRAL_API_KEY", "unit-test-placeholder");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("bounded model transport", () => {
  it("does not retry a 429 or print a potentially sensitive response body", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("response details must not be logged", { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    const { callMistral } = await import("../mistral-client.js");
    await expect(callMistral("system", "body", 1000)).rejects.toThrow(/^Mistral HTTP 429$/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects truncated model output instead of recovering partial JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [{ finish_reason: "length", message: { content: '{"summary":"cut' } }],
        })
      )
    );
    const { callMistral } = await import("../mistral-client.js");
    await expect(callMistral("system", "body", 1000)).rejects.toThrow("incomplete response");
  });
});

it("keeps only allowlisted provider code and numeric Retry-After", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json(
        {
          error: { code: "rate_limit_exceeded", message: "private provider details" },
          secret: "never persist",
        },
        { status: 429, headers: { "retry-after": "90", "x-private": "never persist" } }
      )
    )
  );
  const { callMistral } = await import("../mistral-client.js");
  const error = await callMistral("private prompt", "private article", 1000).catch((e) => e);
  expect(error.diagnostic).toEqual({
    stage: "model",
    reason: "http_error",
    httpStatus: 429,
    code: "rate_limit_exceeded",
    retryAfterSeconds: 90,
  });
  expect(JSON.stringify(error)).not.toMatch(/private|never persist/);
});

it.each(["secret-user-token", { nested: "private" }, 123])(
  "redacts unrecognized provider codes: %j",
  async (code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code }, { status: 429 })));
    const { callMistral } = await import("../mistral-client.js");
    const error = await callMistral("system", "body", 1000).catch((e) => e);
    expect(error.diagnostic.code).toBe("unrecognized");
  }
);

it("ignores oversized error responses without retaining their body", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("x".repeat(9000), { status: 429 }))
  );
  const { callMistral } = await import("../mistral-client.js");
  const error = await callMistral("system", "body", 1000).catch((e) => e);
  expect(error.diagnostic.code).toBeUndefined();
  expect(error.diagnostic.httpStatus).toBe(429);
});

it("parses HTTP-date Retry-After and rejects invalid/unbounded values", async () => {
  const { retryAfterSeconds } = await import("../mistral-client.js");
  const now = Date.parse("2026-10-15T00:00:00Z");
  expect(retryAfterSeconds("Thu, 15 Oct 2026 00:02:00 GMT", now)).toBe(120);
  expect(retryAfterSeconds("0", now)).toBe(0);
  for (const value of [
    null,
    "-1",
    "1.5",
    "9999999999999",
    "private header",
    "Thu, 99 Oct 2026 00:02:00 GMT",
  ])
    expect(retryAfterSeconds(value, now)).toBeUndefined();
});

it("redacts transport failures", async () => {
  const failure = new Error("private network details");
  failure.name = "TimeoutError";
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));
  const { callMistral } = await import("../mistral-client.js");
  const error = await callMistral("system", "body", 1000).catch((e) => e);
  expect(error.diagnostic).toEqual({ stage: "model", reason: "timeout" });
});
