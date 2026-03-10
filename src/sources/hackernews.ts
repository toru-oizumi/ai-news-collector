import { HN_CONFIG } from "../config.js";
import type { Article, Fetcher } from "../types.js";

interface HNHit {
  objectID: string;
  title: string;
  url: string | null;
  points: number;
  num_comments: number;
  created_at: string;
  story_text?: string;
}

interface HNResponse {
  hits: HNHit[];
}

export const hackerNewsFetcher: Fetcher = {
  name: "Hacker News",

  async fetch(): Promise<Article[]> {
    const seen = new Set<string>();
    const articles: Article[] = [];
    const oneDayAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

    for (const query of HN_CONFIG.queries) {
      try {
        const params = new URLSearchParams({
          query,
          tags: "story",
          numericFilters: `created_at_i>${oneDayAgo},points>${HN_CONFIG.minScore}`,
          hitsPerPage: "20",
        });

        const res = await fetch(`${HN_CONFIG.searchUrl}?${params}`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) continue;

        const data = (await res.json()) as HNResponse;

        for (const hit of data.hits) {
          if (!hit.url || seen.has(hit.url)) continue;

          // Title must contain at least one AI-related keyword (word-boundary aware)
          const titleLower = ` ${hit.title.toLowerCase()} `;
          const isAiRelated = HN_CONFIG.titleKeywords.some((kw) =>
            kw.length <= 3 ? new RegExp(`\\b${kw}\\b`).test(titleLower) : titleLower.includes(kw)
          );
          if (!isAiRelated) continue;

          seen.add(hit.url);

          articles.push({
            title: hit.title,
            url: hit.url,
            source: "Hacker News",
            category: [],
            score: hit.points, // will be used directly
            summary: "",
            publishedAt: new Date(hit.created_at),
            fetchedAt: new Date(),
            abstract: hit.story_text?.slice(0, 500) ?? "",
          });
        }
      } catch (err) {
        console.warn(`[HN] Query "${query}" failed:`, err);
      }
    }

    return articles.slice(0, HN_CONFIG.maxItems);
  },
};
