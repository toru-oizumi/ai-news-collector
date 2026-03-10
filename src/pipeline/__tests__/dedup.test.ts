import { describe, expect, it } from "vitest";
import type { Article } from "../../types.js";
import { dedup } from "../dedup.js";

function makeArticle(url: string, score = 0): Article {
  return {
    title: "Test Article",
    url,
    source: "OpenAI",
    category: [],
    score,
    summary: "",
    publishedAt: null,
    fetchedAt: new Date(),
    abstract: "",
  };
}

describe("dedup", () => {
  it("removes exact duplicate URLs", () => {
    const articles = [
      makeArticle("https://example.com/post"),
      makeArticle("https://example.com/post"),
    ];
    expect(dedup(articles)).toHaveLength(1);
  });

  it("normalizes URLs (strips trailing slash, www, tracking params)", () => {
    const articles = [
      makeArticle("https://www.example.com/post/"),
      makeArticle("https://example.com/post"),
    ];
    expect(dedup(articles)).toHaveLength(1);
  });

  it("strips UTM params before dedup", () => {
    // URLs with different tracking params should be treated as same
    const articles = [
      makeArticle("https://example.com/post"),
      makeArticle("https://example.com/post?utm_source=twitter"),
    ];
    // Note: UTM stripping happens in rss-fetcher normalizeUrl, not in dedup
    // dedup normalizes for host+path only (ignores query params)
    expect(dedup(articles)).toHaveLength(1);
  });

  it("keeps higher-scored article when duplicates found", () => {
    const articles = [
      makeArticle("https://example.com/post", 10),
      makeArticle("https://example.com/post", 90),
    ];
    const result = dedup(articles);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(90);
  });

  it("keeps distinct URLs", () => {
    const articles = [
      makeArticle("https://example.com/post-1"),
      makeArticle("https://example.com/post-2"),
    ];
    expect(dedup(articles)).toHaveLength(2);
  });

  it("handles empty array", () => {
    expect(dedup([])).toHaveLength(0);
  });
});
