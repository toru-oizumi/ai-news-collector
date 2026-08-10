import { QIITA_CONFIG, env } from "../config.js";
import type { Article, Fetcher } from "../types.js";

/** An item from the Qiita API v2 `/items` endpoint. Only the fields we use are typed. */
export interface QiitaItem {
  title: string;
  url: string;
  likes_count: number;
  created_at: string;
  body?: string;
  tags?: { name: string }[];
}

/** Keep an item if it clears the LGTM floor and is recent enough. Exported for unit testing. */
export function isRelevantItem(item: QiitaItem, now = Date.now()): boolean {
  if (!item.url || !item.title) return false;
  if (item.likes_count < QIITA_CONFIG.minLikes) return false;

  const published = new Date(item.created_at);
  if (Number.isNaN(published.getTime())) return true; // undatable — keep, age is unknown
  const ageMs = now - published.getTime();
  return ageMs <= QIITA_CONFIG.maxAgeDays * 24 * 60 * 60 * 1000;
}

/** Map a raw Qiita item to a normalized Article (crowd score = LGTM count). */
export function toArticle(item: QiitaItem): Article {
  const published = new Date(item.created_at);
  return {
    title: item.title,
    url: item.url,
    source: "Qiita",
    category: [],
    score: 0,
    summary: "",
    publishedAt: Number.isNaN(published.getTime()) ? null : published,
    fetchedAt: new Date(),
    // Qiita returns full Markdown bodies. Keep a lead excerpt only — Japanese articles
    // skip the summarizer, so this doubles as the summary shown in Notion and Slack.
    abstract: (item.body ?? "").replace(/\s+/g, " ").trim().slice(0, 1000),
    crowdScore: item.likes_count,
  };
}

export const qiitaFetcher: Fetcher = {
  name: "Qiita",

  async fetch(): Promise<Article[]> {
    const seen = new Set<string>();
    const articles: Article[] = [];

    // A token is optional — it only raises the hourly rate limit.
    const headers: Record<string, string> = { Accept: "application/json" };
    if (env.QIITA_TOKEN) headers.Authorization = `Bearer ${env.QIITA_TOKEN}`;

    for (const tag of QIITA_CONFIG.tags) {
      try {
        const url = new URL(QIITA_CONFIG.apiUrl);
        url.searchParams.set("query", `tag:${tag}`);
        url.searchParams.set("per_page", String(QIITA_CONFIG.perPage));

        const res = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
          headers,
        });
        if (!res.ok) {
          console.warn(`[Qiita] tag:${tag} returned ${res.status}`);
          continue;
        }

        const items = (await res.json()) as QiitaItem[];
        if (!Array.isArray(items)) {
          console.warn(`[Qiita] tag:${tag} returned an unexpected payload`);
          continue;
        }

        for (const item of items) {
          // Tag queries overlap heavily (a post tagged both LLM and 生成AI appears twice).
          if (seen.has(item.url) || !isRelevantItem(item)) continue;
          seen.add(item.url);
          articles.push(toArticle(item));
        }
      } catch (err) {
        // One failing tag shouldn't lose the others.
        console.warn(`[Qiita] tag:${tag} failed:`, err);
      }
    }

    return articles
      .sort((a, b) => (b.crowdScore ?? 0) - (a.crowdScore ?? 0))
      .slice(0, QIITA_CONFIG.maxItems);
  },
};
