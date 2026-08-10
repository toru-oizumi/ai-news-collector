import { describe, expect, it } from "vitest";
import { QIITA_CONFIG } from "../../config.js";
import { type QiitaItem, isRelevantItem, toArticle } from "../qiita.js";

const NOW = new Date("2026-08-10T00:00:00.000Z").getTime();

function qiitaItem(overrides: Partial<QiitaItem> = {}): QiitaItem {
  return {
    title: "LLM の量子化モデルで必要メモリと推論速度を見積もる方法",
    url: "https://qiita.com/someone/items/abc123",
    likes_count: 10,
    created_at: "2026-08-09T12:00:00+09:00",
    ...overrides,
  };
}

describe("isRelevantItem", () => {
  it("keeps a recent, sufficiently liked item", () => {
    expect(isRelevantItem(qiitaItem(), NOW)).toBe(true);
  });

  it("drops items below the LGTM floor", () => {
    expect(isRelevantItem(qiitaItem({ likes_count: 0 }), NOW)).toBe(false);
    expect(isRelevantItem(qiitaItem({ likes_count: QIITA_CONFIG.minLikes - 1 }), NOW)).toBe(false);
  });

  it("keeps items exactly at the LGTM floor", () => {
    expect(isRelevantItem(qiitaItem({ likes_count: QIITA_CONFIG.minLikes }), NOW)).toBe(true);
  });

  it("drops items older than the freshness window", () => {
    expect(isRelevantItem(qiitaItem({ created_at: "2026-06-01T00:00:00+09:00" }), NOW)).toBe(false);
  });

  it("drops items with no URL or title", () => {
    expect(isRelevantItem(qiitaItem({ url: "" }), NOW)).toBe(false);
    expect(isRelevantItem(qiitaItem({ title: "" }), NOW)).toBe(false);
  });

  it("keeps items with an unparseable date — age can't be determined", () => {
    expect(isRelevantItem(qiitaItem({ created_at: "not a date" }), NOW)).toBe(true);
  });
});

describe("toArticle", () => {
  it("maps LGTM count to crowdScore", () => {
    expect(toArticle(qiitaItem({ likes_count: 42 })).crowdScore).toBe(42);
  });

  it("sets the source to Qiita and leaves scoring fields to the scorer", () => {
    const article = toArticle(qiitaItem());
    expect(article.source).toBe("Qiita");
    expect(article.score).toBe(0);
    expect(article.category).toEqual([]);
    // lang/kind come from SOURCE_META in the scorer, not from the fetcher.
    expect(article.lang).toBeUndefined();
    expect(article.kind).toBeUndefined();
  });

  it("parses the publish date", () => {
    const article = toArticle(qiitaItem({ created_at: "2026-08-09T12:00:00+09:00" }));
    expect(article.publishedAt?.toISOString()).toBe("2026-08-09T03:00:00.000Z");
  });

  it("yields a null date for an unparseable value", () => {
    expect(toArticle(qiitaItem({ created_at: "not a date" })).publishedAt).toBeNull();
  });

  it("collapses whitespace in the body excerpt", () => {
    // Qiita returns full Markdown; runs of newlines would otherwise land in Notion as-is.
    const article = toArticle(qiitaItem({ body: "# 見出し\n\n本文が   続く\n\n" }));
    expect(article.abstract).toBe("# 見出し 本文が 続く");
  });

  it("caps the excerpt length", () => {
    const article = toArticle(qiitaItem({ body: "あ".repeat(3000) }));
    expect(article.abstract).toHaveLength(1000);
  });

  it("tolerates a missing body", () => {
    expect(toArticle(qiitaItem({ body: undefined })).abstract).toBe("");
  });
});
