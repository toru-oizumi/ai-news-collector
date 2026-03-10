import RSSParser from "rss-parser";
import type { Article, Fetcher, RSSSourceConfig } from "../types.js";

const parser = new RSSParser({ timeout: 15_000 });

export function createRSSFetcher(config: RSSSourceConfig): Fetcher {
  return {
    name: `RSS:${config.name}(${new URL(config.url).hostname})`,

    async fetch(): Promise<Article[]> {
      const feed = await parser.parseURL(config.url);
      const items = feed.items ?? [];

      const articles: Article[] = items
        .map((item) => {
          const title = item.title?.trim() ?? "";
          const url = item.link?.trim() ?? "";
          if (!title || !url) return null;

          // Keyword filter (if configured)
          if (config.keywords?.length) {
            const text = `${title} ${item.contentSnippet ?? ""}`.toLowerCase();
            const matched = config.keywords.some((kw) => text.includes(kw.toLowerCase()));
            if (!matched) return null;
          }

          return {
            title,
            url: normalizeUrl(url),
            source: config.name,
            category: [],
            score: 0,
            summary: "",
            publishedAt: item.pubDate ? new Date(item.pubDate) : null,
            fetchedAt: new Date(),
            abstract: (item.contentSnippet ?? item.content ?? "").slice(0, 1000),
          } satisfies Article;
        })
        .filter((a): a is Article => a !== null);

      return articles;
    },
  };
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    // Remove common tracking params
    for (const p of ["utm_source", "utm_medium", "utm_campaign", "ref"]) {
      u.searchParams.delete(p);
    }
    return u.toString();
  } catch {
    return url;
  }
}
