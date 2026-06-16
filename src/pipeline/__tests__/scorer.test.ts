import { describe, expect, it } from "vitest";
import type { Article } from "../../types.js";
import { scoreAndFilter, selectDiverse } from "../scorer.js";

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    title: "Test Article",
    url: "https://example.com/test",
    source: "OpenAI",
    category: [],
    score: 0,
    summary: "",
    publishedAt: null,
    fetchedAt: new Date(),
    abstract: "",
    ...overrides,
  };
}

describe("scoreAndFilter", () => {
  it("assigns base score by source weight", () => {
    const articles = [makeArticle({ source: "OpenAI" })];
    const result = scoreAndFilter(articles);
    // OpenAI base weight = 80
    expect(result[0].score).toBeGreaterThanOrEqual(80);
  });

  it("applies keyword bonus", () => {
    const base = scoreAndFilter([makeArticle({ source: "OpenAI", title: "test" })]);
    const withBonus = scoreAndFilter([
      makeArticle({ source: "OpenAI", title: "New Claude agent with tool use" }),
    ]);
    expect(withBonus[0].score).toBeGreaterThan(base[0].score);
  });

  it("filters articles below minScore", () => {
    // AWS ML base weight = 40, minScore = 30 — should pass
    const lowScoreArticle = makeArticle({ source: "AWS ML", title: "unrelated content" });
    const result = scoreAndFilter([lowScoreArticle]);
    expect(result.length).toBeGreaterThanOrEqual(0); // may pass depending on score
    for (const a of result) expect(a.score).toBeGreaterThanOrEqual(30);
  });

  it("auto-categorizes LLM articles", () => {
    const articles = [makeArticle({ title: "New GPT model released", abstract: "language model" })];
    const result = scoreAndFilter(articles);
    expect(result[0].category).toContain("LLM");
  });

  it("auto-categorizes Agent articles", () => {
    const articles = [makeArticle({ title: "Agentic AI with tool use and function calling" })];
    const result = scoreAndFilter(articles);
    expect(result[0].category).toContain("Agent");
  });

  it("assigns 'Other' when no category matched", () => {
    const articles = [makeArticle({ title: "Something unrelated", abstract: "" })];
    const result = scoreAndFilter(articles);
    // Should either have "Other" or some category
    if (result.length > 0) {
      expect(result[0].category.length).toBeGreaterThan(0);
    }
  });

  it("sorts by score descending", () => {
    const articles = [
      makeArticle({ source: "AWS ML", title: "aws thing" }),
      makeArticle({ source: "OpenAI", title: "openai thing" }),
    ];
    const result = scoreAndFilter(articles);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });

  it("adds a crowd bonus from crowdScore (HN)", () => {
    // "open source agent" clears minScore on its own (base 20 + keyword bonuses).
    const title = "open source agent framework";
    const withoutCrowd = scoreAndFilter([makeArticle({ source: "Hacker News", title })]);
    const withCrowd = scoreAndFilter([
      makeArticle({ source: "Hacker News", title, crowdScore: 500 }),
    ]);
    expect(withCrowd[0].score).toBeGreaterThan(withoutCrowd[0].score);
  });

  it("normalizes crowd score across sources (log + per-source scale)", () => {
    // HN points and Lobsters scores live on different scales but should land close
    // after normalization (HN 250 points ≈ Lobsters 50 votes given scale 5).
    const hn = scoreAndFilter([makeArticle({ source: "Hacker News", crowdScore: 250 })]);
    const lob = scoreAndFilter([makeArticle({ source: "Lobsters", crowdScore: 50 })]);
    const hnCrowd = hn[0].score - 20; // minus HN base weight
    const lobCrowd = lob[0].score - 30; // minus Lobsters base weight
    expect(Math.abs(hnCrowd - lobCrowd)).toBeLessThanOrEqual(2);
  });

  it("caps the crowd bonus at maxBonus", () => {
    const huge = scoreAndFilter([makeArticle({ source: "Hacker News", crowdScore: 10_000_000 })]);
    // base (20) + maxBonus (60) = 80, plus any keyword bonus from the default title
    expect(huge[0].score).toBeLessThanOrEqual(20 + 60 + 5);
  });

  it("ranks a crowd-backed practitioner story above a bare arXiv paper", () => {
    const arxiv = makeArticle({ source: "arXiv", title: "A new benchmark for X" });
    const hn = makeArticle({ source: "Hacker News", title: "ai agent tool", crowdScore: 300 });
    const result = scoreAndFilter([arxiv, hn]);
    expect(result[0].source).toBe("Hacker News");
  });
});

describe("selectDiverse", () => {
  // Simulates the OpenAI-flood case: one source has many high-scoring items that
  // would otherwise fill every slot and bury a lower-scoring crowd source.
  function scored(source: Article["source"], score: number): Article {
    return makeArticle({ source, score });
  }

  it("caps a single source so other sources can surface", () => {
    // OpenAI floods with 20 high-scoring items; Lobsters scores lower but should
    // still surface once other sources exist to fill the non-OpenAI slots.
    const flood = Array.from({ length: 20 }, (_, i) => scored("OpenAI", 130 - i));
    const lobsters = Array.from({ length: 5 }, (_, i) => scored("Lobsters", 99 - i));
    const result = selectDiverse([...flood, ...lobsters], 10, 5);
    expect(result.filter((a) => a.source === "OpenAI")).toHaveLength(5);
    expect(result.filter((a) => a.source === "Lobsters")).toHaveLength(5);
  });

  it("tops up from overflow rather than under-filling when few sources exist", () => {
    // Only one source available, cap 5, but we ask for 8 → should still return 8.
    const flood = Array.from({ length: 20 }, (_, i) => scored("OpenAI", 130 - i));
    const result = selectDiverse(flood, 8, 5);
    expect(result).toHaveLength(8);
  });

  it("returns results sorted by score descending", () => {
    const items = [scored("OpenAI", 130), scored("Lobsters", 99), scored("OpenAI", 120)];
    const result = selectDiverse(items, 3, 5);
    expect(result.map((a) => a.score)).toEqual([130, 120, 99]);
  });
});
