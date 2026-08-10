import { HN_CONFIG } from "../config.js";
import { matchesKeyword } from "../pipeline/keywords.js";
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
        // NOTE: the /search endpoint only allows `created_at_i` in numericFilters;
        // filtering by `points` here returns HTTP 400. We fetch by time and apply
        // the points threshold client-side below.
        const params = new URLSearchParams({
          query,
          tags: "story",
          numericFilters: `created_at_i>${oneDayAgo}`,
          hitsPerPage: "20",
        });

        const res = await fetch(`${HN_CONFIG.searchUrl}?${params}`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          console.warn(`[HN] Query "${query}" returned HTTP ${res.status}`);
          continue;
        }

        const data = (await res.json()) as HNResponse;

        for (const hit of data.hits) {
          if (!hit.url || seen.has(hit.url)) continue;
          if (hit.points < HN_CONFIG.minScore) continue;

          // Title must contain at least one AI-related keyword (word-boundary aware)
          if (!matchesKeyword(hit.title, HN_CONFIG.titleKeywords)) continue;

          seen.add(hit.url);

          articles.push({
            title: hit.title,
            url: hit.url,
            source: "Hacker News",
            category: [],
            score: 0, // computed by the scorer from base weight + keyword + crowd bonus
            summary: "",
            publishedAt: new Date(hit.created_at),
            fetchedAt: new Date(),
            abstract: hit.story_text?.slice(0, 500) ?? "",
            crowdScore: hit.points, // upvotes — normalized by the scorer
          });
        }
      } catch (err) {
        console.warn(`[HN] Query "${query}" failed:`, err);
      }
    }

    return articles.slice(0, HN_CONFIG.maxItems);
  },
};
