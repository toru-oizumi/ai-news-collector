import { describe, expect, it, vi } from "vitest";
import { MistralRequestError } from "../../digest/failures.js";
import { NotionRequestError } from "../../notion/request-policy.js";
import type { PendingPage } from "../backlog.js";
import { type EnrichmentRow, enrichOne } from "../processor.js";
import { finished, runEnrichment } from "../runner.js";
import { type ProcessingState, eligible } from "../state.js";

const pages = (n: number): PendingPage[] =>
  Array.from({ length: n }, (_, i) => ({
    pageId: `${i}`,
    title: "AI model release",
    url: `https://example.com/${i}`,
  }));
const row = (page: PendingPage): EnrichmentRow => ({
  ...page,
  blockId: `block-${page.pageId}`,
  state: {
    marker: "ai-news-processing:v1",
    status: "pending",
    attempts: 0,
    abstract: "",
    updatedAt: new Date(0).toISOString(),
  },
});
const deps = () => ({
  deadline: 720_000,
  now: () => 0,
  load: vi.fn(async (page: PendingPage) => row(page)),
  reserve: vi.fn().mockResolvedValue(undefined),
  process: vi.fn(async (item: EnrichmentRow) => ({
    rateLimited: false,
    apiCalled: true,
    state: { ...item.state, status: "ready" as ProcessingState["status"], attempts: 1 },
  })),
  checkpoint: vi.fn().mockResolvedValue(undefined),
  wait: vi.fn().mockResolvedValue(undefined),
});

describe("bounded enrichment orchestration", () => {
  it("processes at most ten and checkpoints all remaining pages", async () => {
    const d = deps();
    expect(await runEnrichment(pages(30), d)).toEqual({
      processed: 10,
      pending: 20,
      failed: false,
      rateLimited: false,
    });
    expect(d.process).toHaveBeenCalledTimes(10);
    expect(d.checkpoint.mock.calls.at(-1)?.[0]).toHaveLength(20);
    expect(d.reserve.mock.calls[0][1]).toMatchObject({ attempts: 0 });
  });
  it("stops before the time budget is exhausted", async () => {
    const d = deps();
    d.now = () => 600_000;
    expect(await runEnrichment(pages(3), d)).toMatchObject({ processed: 0, pending: 3 });
    expect(d.load).not.toHaveBeenCalled();
  });
  it("stops the whole run on the first 429 and retains that page", async () => {
    const d = deps();
    d.process.mockImplementation(async (item) => ({
      rateLimited: true,
      apiCalled: true,
      state: { ...item.state, status: "rate_limited" as ProcessingState["status"], attempts: 1 },
    }));
    expect(await runEnrichment(pages(4), d)).toMatchObject({ processed: 1, pending: 4 });
    expect(d.process).toHaveBeenCalledTimes(1);
    expect(d.wait).not.toHaveBeenCalled();
  });
  it("stops safely after a Notion state write fails", async () => {
    const d = deps();
    d.reserve.mockRejectedValue(new Error("response lost"));
    expect(await runEnrichment(pages(4), d)).toMatchObject({
      processed: 0,
      pending: 4,
      failed: true,
    });
    expect(d.process).not.toHaveBeenCalled();
  });
  it("does not reprocess ready pages or pages with three attempts", async () => {
    const d = deps();
    d.load.mockImplementation(async (page) => ({
      ...row(page),
      state: { ...row(page).state, attempts: 3 },
    }));
    expect(await runEnrichment(pages(3), d)).toMatchObject({ processed: 0, pending: 0 });
    expect(d.process).not.toHaveBeenCalled();
  });
});

it.each([0, 2, 3, 7])(
  "retains and retries rate-limited rows with %i prior attempts",
  async (attempts) => {
    const d = deps();
    d.load.mockImplementation(async (page) => ({
      ...row(page),
      state: { ...row(page).state, status: "rate_limited", attempts },
    }));
    d.process.mockImplementation(async (item) => ({
      rateLimited: true,
      apiCalled: true,
      state: { ...item.state, status: "rate_limited", attempts },
    }));
    expect(await runEnrichment(pages(4), d)).toEqual({
      processed: 1,
      pending: 4,
      failed: true,
      rateLimited: true,
      failure: { operation: "model", httpStatus: 429 },
    });
    expect(d.reserve.mock.calls[0][1]).toMatchObject({ attempts });
    expect(d.checkpoint).not.toHaveBeenCalled();
    expect(d.wait).not.toHaveBeenCalled();
  }
);

it("retains a legacy rate-limited row during its cooldown without calling the model", async () => {
  const d = deps();
  d.load.mockImplementation(async (page) => ({
    ...row(page),
    state: {
      ...row(page).state,
      status: "rate_limited",
      attempts: 7,
      nextAttemptAt: new Date(6 * 60 * 60_000).toISOString(),
    },
  }));
  expect(await runEnrichment(pages(3), d)).toMatchObject({
    processed: 0,
    pending: 3,
    failed: false,
  });
  expect(d.process).not.toHaveBeenCalled();
  expect(d.reserve).not.toHaveBeenCalled();
  expect(d.checkpoint).not.toHaveBeenCalled();
});

it.each(["ready", "excerpt", "non_ai", "insufficient_evidence", "invalid_response"] as const)(
  "keeps %s terminal even with no attempts",
  (status) => {
    const state = { ...row(pages(1)[0]).state, status };
    expect(finished(state)).toBe(true);
    expect(eligible(state, 0)).toBe(false);
  }
);

it.each(["pending", "model_failed", "body_unavailable"] as const)(
  "still exhausts true %s failures at three attempts",
  (status) => {
    const state = { ...row(pages(1)[0]).state, status, attempts: 3 };
    expect(finished(state)).toBe(true);
    expect(eligible(state, 0)).toBe(false);
  }
);

it("retries repeated model 429s without consuming the final available failure attempt", async () => {
  let stored = { ...row(pages(1)[0]).state, attempts: 2 };
  let now = 0;
  const d = deps();
  d.deadline = Number.POSITIVE_INFINITY;
  d.now = () => now;
  d.load.mockImplementation(async (page) => ({ ...row(page), state: stored }));
  d.reserve.mockImplementation(async (_item, state) => {
    stored = state;
  });
  const generate = vi.fn().mockRejectedValue(
    new MistralRequestError({
      stage: "model",
      reason: "http_error",
      httpStatus: 429,
    })
  );
  d.process.mockImplementation((item) =>
    enrichOne(item, {
      now: () => now,
      fetchBody: async () => ({
        paragraphs: [
          "An open source language model is released for local inference. The release includes model weights and usage examples for researchers. No benchmark results have been published.",
        ],
      }),
      generate,
      persist: async (_item, state) => {
        stored = state;
      },
    })
  );
  for (let run = 0; run < 4; run++) {
    expect(await runEnrichment(pages(2), d)).toMatchObject({
      failed: true,
      rateLimited: true,
      pending: 2,
      processed: 1,
    });
    expect(stored.attempts).toBe(2);
    expect(stored.status).toBe("rate_limited");
    now += 6 * 60 * 60_000;
  }
  expect(generate).toHaveBeenCalledTimes(4);
  generate.mockRejectedValue(
    new MistralRequestError({
      stage: "model",
      reason: "http_error",
      httpStatus: 503,
    })
  );
  expect(await runEnrichment(pages(1), d)).toMatchObject({ pending: 0, processed: 1 });
  expect(stored).toMatchObject({ attempts: 3, status: "model_failed" });
});

it.each(["load", "reserve", "process", "checkpoint", "wait"] as const)(
  "reports only the bounded operation when %s fails",
  async (operation) => {
    const d = deps();
    d[operation].mockRejectedValue(new Error("secret response https://private.example/token"));
    const result = await runEnrichment(pages(2), d);
    expect(result.failed).toBe(true);
    expect(result.failure).toEqual({ operation });
    expect(JSON.stringify(result)).not.toContain("secret");
    if (operation === "checkpoint") expect(result.pending).toBe(2);
  }
);

it.each(["load", "reserve", "process"] as const)(
  "preserves safe Notion diagnostics when %s exhausts rate-limit retries",
  async (operation) => {
    const d = deps();
    const diagnostic = {
      stage: "notion" as const,
      operation: "state_update" as const,
      reason: "rate_limited" as const,
      httpStatus: 429,
      attempts: 3,
      retries: 2,
      retryAfterSeconds: 90,
    };
    d[operation].mockRejectedValue(new NotionRequestError(diagnostic));
    expect(await runEnrichment(pages(2), d)).toMatchObject({
      pending: 2,
      failed: true,
      rateLimited: true,
      failure: diagnostic,
    });
    expect(d.wait).not.toHaveBeenCalled();
    expect(d.checkpoint).not.toHaveBeenCalled();
  }
);

it("keeps the final failure attempt after a model 429 state write fails across restart", async () => {
  let stored = { ...row(pages(1)[0]).state, attempts: 2 };
  let now = 0;
  const d = deps();
  d.deadline = Number.POSITIVE_INFINITY;
  d.now = () => now;
  d.load.mockImplementation(async (page) => ({ ...row(page), state: stored }));
  d.reserve.mockImplementation(async (_item, state) => {
    stored = state;
  });
  const generate = vi.fn().mockRejectedValue(
    new MistralRequestError({
      stage: "model",
      reason: "http_error",
      httpStatus: 429,
    })
  );
  const persist = vi
    .fn()
    .mockRejectedValueOnce(new Error("state write failed"))
    .mockImplementation(async (_item, state) => {
      stored = state;
    });
  d.process.mockImplementation((item) =>
    enrichOne(item, {
      now: () => now,
      fetchBody: async () => ({
        paragraphs: [
          "An open source language model is released for local inference. The release includes model weights and usage examples for researchers. No benchmark results have been published.",
        ],
      }),
      generate,
      persist,
    })
  );
  expect(await runEnrichment(pages(1), d)).toMatchObject({
    failed: true,
    pending: 1,
    processed: 1,
  });
  expect(stored).toMatchObject({ attempts: 2, status: "pending" });
  expect(stored.nextAttemptAt).toBe("1970-01-01T06:00:00.000Z");
  expect(d.checkpoint).not.toHaveBeenCalled();
  expect(await runEnrichment(pages(1), d)).toMatchObject({ pending: 1, processed: 0 });
  expect(generate).toHaveBeenCalledTimes(1);
  now += 6 * 60 * 60_000;
  expect(await runEnrichment(pages(1), d)).toMatchObject({
    failed: true,
    rateLimited: true,
    pending: 1,
    processed: 1,
  });
  expect(stored).toMatchObject({ attempts: 2, status: "rate_limited" });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(d.checkpoint).not.toHaveBeenCalled();
});
