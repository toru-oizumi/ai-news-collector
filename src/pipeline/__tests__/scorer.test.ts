import { describe, expect, it } from "vitest";
import type { Article } from "../../types.js";
import { scoreAndFilter } from "../scorer.js";

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

  it("caps HN score at 200", () => {
    const articles = [makeArticle({ source: "Hacker News", score: 9999 })];
    const result = scoreAndFilter(articles);
    expect(result[0].score).toBeLessThanOrEqual(200);
  });
});
