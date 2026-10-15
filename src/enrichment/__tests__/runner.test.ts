import { describe, expect, it, vi } from "vitest";
import type { PendingPage } from "../backlog.js";
import type { EnrichmentRow } from "../processor.js";
import { runEnrichment } from "../runner.js";
import type { ProcessingState } from "../state.js";

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
    });
    expect(d.process).toHaveBeenCalledTimes(10);
    expect(d.checkpoint.mock.calls.at(-1)?.[0]).toHaveLength(20);
    expect(d.reserve.mock.calls[0][1]).toMatchObject({ attempts: 1 });
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
