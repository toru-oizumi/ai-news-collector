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

          const publishedAt = parseDate(item.pubDate);

          // Freshness filter (if configured) — skip items older than maxAgeDays.
          // Items with no publish date are kept (we can't determine their age).
          if (config.maxAgeDays !== undefined && publishedAt) {
            const ageMs = Date.now() - publishedAt.getTime();
            if (ageMs > config.maxAgeDays * 24 * 60 * 60 * 1000) return null;
          }

          const article: Article = {
            title,
            url: normalizeUrl(url),
            source: config.name,
            category: [],
            score: 0,
            summary: "",
            publishedAt,
            fetchedAt: new Date(),
            abstract: (item.contentSnippet ?? item.content ?? "").slice(0, 1000),
          };
          return article;
        })
        .filter((a): a is Article => a !== null);

      return articles;
    },
  };
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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
