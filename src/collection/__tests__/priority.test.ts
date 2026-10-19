import { describe, expect, it, vi } from "vitest";
import { initialState } from "../../enrichment/state.js";
import type { Article } from "../../types.js";
import { preparePending } from "../priority.js";
import { collectPending } from "../queue.js";

const now = Date.parse("2026-10-15T12:00:00Z");
const article = (id: number, ageDays: number | null, score = 100): Article => ({
  title: `Article ${id}`,
  url: `https://example.com/${id}`,
  source: "OpenAI",
  category: [],
  score,
  summary: "",
  abstract: "",
  publishedAt: ageDays === null ? null : new Date(now - ageDays * 86_400_000),
  fetchedAt: new Date(now - 2 * 86_400_000),
});

describe("fresh collection priority without discarding backlog", () => {
  it("saves a low-scored new article before 3502 old items when only one save fits", async () => {
    const old = Array.from({ length: 3502 }, (_, i) => article(i, 30));
    const fresh = { ...article(4000, 0.1, 1), fetchedAt: new Date(now) };
    const prepared = preparePending(old, [fresh], new Set(), now);
    let time = 0;
    const saved = vi.fn(async () => {
      time = 400_000;
      return { notionUrl: "saved", outcome: "created" as const };
    });
    const checkpoint = vi.fn();
    const result = await collectPending(prepared, {
      save: saved,
      checkpoint,
      deadline: 480_000,
      now: () => time,
    });
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith(fresh);
    expect(result).toMatchObject({ saved: 1, pending: 3502 });
    expect(checkpoint).toHaveBeenLastCalledWith(old);
  });
  it("prioritizes newest publication, using score for ties; preserves old FIFO", () => {
    const old = [article(1, 20), article(2, null), article(3, 7), article(4, -1)];
    const fresh = [article(5, 6), article(6, 1, 2), article(7, 1, 10)];
    expect(preparePending(old, fresh, new Set(), now).map((a) => a.title)).toEqual([
      "Article 7",
      "Article 6",
      "Article 5",
      ...old.map((a) => a.title),
    ]);
  });
  it("keeps the original collection time even if a rediscovered duplicate wins scoring", () => {
    const old = article(1, 20, 1);
    const incoming = { ...old, score: 999, fetchedAt: new Date(now), publishedAt: new Date(now) };
    const prepared = preparePending([old], [incoming], new Set(), now);
    expect(prepared).toEqual([
      { ...incoming, fetchedAt: old.fetchedAt, publishedAt: old.publishedAt },
    ]);
    expect(initialState(prepared[0]).collectedAt).toBe(old.fetchedAt.toISOString());
    expect(incoming.fetchedAt.getTime()).toBe(now);
    expect(old.score).toBe(1);
  });
  it("still excludes confirmed URLs and keeps unknown/invalid dates outside the fresh lane", () => {
    const invalid = { ...article(2, 1), publishedAt: new Date("invalid") };
    expect(
      preparePending(
        [article(1, 30), invalid],
        [article(3, 1)],
        new Set([article(1, 30).url.replace("https://", "")]),
        now
      ).map((a) => a.title)
    ).toEqual(["Article 3", "Article 2"]);
  });
});
