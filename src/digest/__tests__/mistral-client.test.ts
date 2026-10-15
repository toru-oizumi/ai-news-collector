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
