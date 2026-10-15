import { describe, expect, it } from "vitest";
import type { ExportedArticle } from "../../notion/client.js";
import { renderBrief } from "../render.js";

const article = (i: number): ExportedArticle => ({
  id: `${i}`,
  title: `Title ${i}`,
  url: `https://example.com/${i}`,
  source: "Example",
  score: i,
  category: [],
  summary: "An unverified historical summary",
  fetched: "2026-10-15",
  published: "2026-10-14",
  status: "Unread",
  lang: "en",
  kind: "primary",
  notionUrl: "",
});

describe("local brief", () => {
  it("shows at most three distinct articles with direct source links", () => {
    const text = renderBrief([article(1), article(1), article(2), article(3), article(4)]);
    expect(text.match(/https:\/\//g)).toHaveLength(3);
    expect(text).toContain("https://example.com/4");
    expect(text).toContain("出典: Example");
    expect(text).not.toContain("unverified historical summary");
  });
  it("labels historical summaries when explicitly requested", () => {
    expect(renderBrief([article(1)], true)).toContain("保存済み要約（未検証）");
  });
  it("handles an empty snapshot without inventing news", () => {
    expect(renderBrief([])).toContain("保存済みの記事はありません");
  });
});
