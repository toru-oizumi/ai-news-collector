import { describe, expect, it } from "vitest";
import type { RSSSourceConfig } from "../../types.js";
import { type RSSItemLike, mapItem } from "../rss-fetcher.js";

const base: RSSSourceConfig = { name: "Hatena", url: "https://example.com/feed" };

function item(overrides: Partial<RSSItemLike> = {}): RSSItemLike {
  return { title: "AI safety research", link: "https://example.com/post", ...overrides };
}

describe("mapItem — required fields", () => {
  it("drops items with no title", () => {
    expect(mapItem(item({ title: "  " }), base)).toBeNull();
  });

  it("drops items with no link", () => {
    expect(mapItem(item({ link: undefined }), base)).toBeNull();
  });

  it("normalizes the URL: strips the hash and tracking params", () => {
    const article = mapItem(
      item({ link: "https://example.com/post?utm_source=rss&id=7#section" }),
      base
    );
    expect(article?.url).toBe("https://example.com/post?id=7");
  });
});

describe("mapItem — publish date", () => {
  it("reads isoDate when pubDate is absent (RSS 1.0 / RDF feeds like Hatena)", () => {
    // Regression: reading pubDate alone nulled out publishedAt on every Hatena entry,
    // which also silently disabled the maxAgeDays filter for that feed.
    const article = mapItem(item({ isoDate: "2026-08-10T00:04:33.000Z" }), base);
    expect(article?.publishedAt?.toISOString()).toBe("2026-08-10T00:04:33.000Z");
  });

  it("still reads pubDate for feeds that only provide it", () => {
    const article = mapItem(item({ pubDate: "Mon, 10 Aug 2026 01:40:52 GMT" }), base);
    expect(article?.publishedAt?.toISOString()).toBe("2026-08-10T01:40:52.000Z");
  });

  it("prefers isoDate when both are present", () => {
    const article = mapItem(
      item({ isoDate: "2026-08-10T00:00:00.000Z", pubDate: "Tue, 01 Jan 2019 00:00:00 GMT" }),
      base
    );
    expect(article?.publishedAt?.toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });

  it("yields null for an unparseable date", () => {
    const article = mapItem(item({ pubDate: "not a date" }), base);
    expect(article?.publishedAt).toBeNull();
  });
});

describe("mapItem — freshness filter", () => {
  const now = new Date("2026-08-10T00:00:00.000Z").getTime();
  const config: RSSSourceConfig = { ...base, maxAgeDays: 7 };

  it("keeps items inside the window", () => {
    expect(mapItem(item({ isoDate: "2026-08-05T00:00:00.000Z" }), config, now)).not.toBeNull();
  });

  it("drops items older than the window", () => {
    expect(mapItem(item({ isoDate: "2026-07-01T00:00:00.000Z" }), config, now)).toBeNull();
  });

  it("keeps undated items — their age can't be determined", () => {
    expect(mapItem(item(), config, now)).not.toBeNull();
  });

  it("applies the window to isoDate-only feeds", () => {
    // Guards the interaction between the date fallback and this filter: before the
    // fallback, an old Hatena entry parsed as undated and slipped through as "fresh".
    const stale = mapItem(item({ isoDate: "2026-06-01T00:00:00.000Z" }), config, now);
    expect(stale).toBeNull();
  });
});

describe("mapItem — crowd signal", () => {
  const config: RSSSourceConfig = { ...base, crowdField: "hatena:bookmarkcount" };

  it("parses the configured extension element into crowdScore", () => {
    // rss-parser exposes the mapped field as a string.
    const article = mapItem(item({ crowdRaw: "127" }), config);
    expect(article?.crowdScore).toBe(127);
  });

  it("leaves crowdScore unset when the field is missing", () => {
    expect(mapItem(item(), config)?.crowdScore).toBeUndefined();
  });

  it("leaves crowdScore unset for a non-numeric value", () => {
    expect(mapItem(item({ crowdRaw: "many" }), config)?.crowdScore).toBeUndefined();
  });

  it("ignores the field entirely when no crowdField is configured", () => {
    expect(mapItem(item({ crowdRaw: "127" }), base)?.crowdScore).toBeUndefined();
  });

  it("keeps items at or above minCrowd", () => {
    const withFloor: RSSSourceConfig = { ...config, minCrowd: 10 };
    expect(mapItem(item({ crowdRaw: "10" }), withFloor)).not.toBeNull();
    expect(mapItem(item({ crowdRaw: "42" }), withFloor)).not.toBeNull();
  });

  it("drops items below minCrowd", () => {
    const withFloor: RSSSourceConfig = { ...config, minCrowd: 10 };
    expect(mapItem(item({ crowdRaw: "3" }), withFloor)).toBeNull();
  });

  it("drops items with an unparseable count when minCrowd is set", () => {
    // Keeping them would let items bypass the floor entirely.
    const withFloor: RSSSourceConfig = { ...config, minCrowd: 10 };
    expect(mapItem(item({ crowdRaw: "" }), withFloor)).toBeNull();
    expect(mapItem(item(), withFloor)).toBeNull();
  });
});

describe("mapItem — keyword filter", () => {
  it("keeps items matching a configured keyword", () => {
    const config: RSSSourceConfig = { ...base, keywords: ["生成ai", "llm"] };
    const article = mapItem(item({ title: "LLMの量子化モデルで必要メモリを見積もる" }), config);
    expect(article).not.toBeNull();
  });

  it("drops items matching nothing", () => {
    const config: RSSSourceConfig = { ...base, keywords: ["生成ai", "機械学習"] };
    // A real Hatena tag-search entry that carries no AI content.
    const article = mapItem(item({ title: "ない漢字だけの湯飲みがある話" }), config);
    expect(article).toBeNull();
  });

  it("searches the content snippet as well as the title", () => {
    const config: RSSSourceConfig = { ...base, keywords: ["大規模言語モデル"] };
    const article = mapItem(
      item({ title: "今週読んだ記事", contentSnippet: "大規模言語モデルの評価について" }),
      config
    );
    expect(article).not.toBeNull();
  });

  it("does not fire on substrings of unrelated words", () => {
    const config: RSSSourceConfig = { ...base, keywords: ["ai"] };
    expect(mapItem(item({ title: "Now available in Tokyo" }), config)).toBeNull();
  });
});
