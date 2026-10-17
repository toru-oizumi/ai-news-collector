import { Client } from "@notionhq/client";
import { afterEach, expect, it, vi } from "vitest";
import { boundedNotionFetch } from "../bounded-fetch.js";
import { NotionRequestPolicy } from "../request-policy.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("aborts a stalled response body after headers and never retries the ambiguous request", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(async (_input, init) => ({
    ok: true,
    text: () =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted secret body")), {
          once: true,
        });
      }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  const client = new Client({
    auth: "test",
    timeoutMs: 10_000,
    logger: () => {},
    fetch: boundedNotionFetch as unknown as NonNullable<
      NonNullable<ConstructorParameters<typeof Client>[0]>["fetch"]
    >,
  });
  const result = new NotionRequestPolicy().request("brief_query", () =>
    client.databases.query({ database_id: "db" })
  );
  const assertion = expect(result).rejects.toMatchObject({
    diagnostic: { reason: "request_failed", attempts: 1 },
  });
  await vi.advanceTimersByTimeAsync(10_000);
  await assertion;
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
