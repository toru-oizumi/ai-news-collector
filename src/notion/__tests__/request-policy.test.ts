import { describe, expect, it, vi } from "vitest";
import { NotionRequestError, NotionRequestPolicy, notionPolicy } from "../request-policy.js";

const setup = (deadline?: number) => {
  let time = 0;
  const sleep = vi.fn(async (ms: number) => {
    time += ms;
  });
  const diagnostic = vi.fn();
  return {
    policy: new NotionRequestPolicy({ now: () => time, sleep, deadline, diagnostic }),
    sleep,
    diagnostic,
    now: () => time,
  };
};
const limited = (retryAfter?: string) => ({
  status: 429,
  headers: new Headers(retryAfter === undefined ? {} : { "retry-after": retryAfter }),
  body: "secret",
  message: "secret",
});

describe("shared Notion request pacing", () => {
  it("serializes concurrent operations and paces every request", async () => {
    const d = setup();
    const starts: number[] = [];
    const action = async () => {
      starts.push(d.now());
      return "ok";
    };
    await Promise.all([
      d.policy.request("enrichment_load", action),
      d.policy.request("enrichment_reserve", action),
      d.policy.request("brief_state", action),
    ]);
    expect(starts).toEqual([0, 400, 800]);
    const client = {};
    expect(notionPolicy(client)).toBe(notionPolicy(client));
  });
  it.each(["2", "Thu, 01 Jan 1970 00:00:02 GMT"])("honors Retry-After %s", async (header) => {
    const d = setup();
    const action = vi.fn().mockRejectedValueOnce(limited(header)).mockResolvedValue("ok");
    expect(await d.policy.request("summary_update", action)).toBe("ok");
    expect(d.now()).toBe(2000);
    expect(action).toHaveBeenCalledTimes(2);
  });
  it.each([undefined, "invalid", "-1"])(
    "backs off on absent/invalid Retry-After %s and stops after three attempts",
    async (header) => {
      const d = setup();
      const action = vi.fn().mockRejectedValue(limited(header));
      await expect(d.policy.request("brief_query", action)).rejects.toMatchObject({
        diagnostic: { reason: "rate_limited", httpStatus: 429, attempts: 3, retries: 2 },
      });
      expect(d.now()).toBe(3000);
      expect(action).toHaveBeenCalledTimes(3);
      expect(JSON.stringify(d.diagnostic.mock.calls)).not.toContain("secret");
    }
  );
  it("does not truncate a long Retry-After and retry early", async () => {
    const d = setup();
    const action = vi.fn().mockRejectedValue(limited("120"));
    await expect(d.policy.request("brief_query", action)).rejects.toMatchObject({
      diagnostic: { reason: "budget_exhausted", attempts: 1, retryAfterSeconds: 120 },
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(d.sleep).not.toHaveBeenCalled();
    // The server cooldown applies to the next operation too, even after rejection.
    const next = vi.fn();
    await expect(d.policy.request("brief_state", next)).rejects.toBeInstanceOf(NotionRequestError);
    expect(next).not.toHaveBeenCalled();
  });
  it("honors stage deadlines without starting requests or waiting beyond budget", async () => {
    const d = setup(11_000);
    const action = vi.fn().mockRejectedValue(limited("2"));
    await expect(d.policy.request("enrichment_load", action)).rejects.toMatchObject({
      diagnostic: { reason: "budget_exhausted", attempts: 1 },
    });
    expect(action).toHaveBeenCalledTimes(1);
    const never = vi.fn();
    await expect(d.policy.request("brief_query", never, 5000)).rejects.toMatchObject({
      diagnostic: { attempts: 0 },
    });
    expect(never).not.toHaveBeenCalled();
  });
  it.each([{ status: 503 }, { status: 401 }, new Error("secret response lost")])(
    "never retries ambiguous errors or non-429 writes: %j",
    async (error) => {
      const d = setup();
      const action = vi.fn().mockRejectedValue(error);
      await expect(d.policy.request("state_update", action)).rejects.toBeInstanceOf(
        NotionRequestError
      );
      expect(action).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(d.diagnostic.mock.calls)).not.toContain("secret");
    }
  );
});
