import { AI_KEYWORDS, LOBSTERS_CONFIG } from "../config.js";
import type { Article, Fetcher } from "../types.js";

/** A story from lobste.rs `hottest.json`. Only the fields we use are typed. */
export interface LobstersStory {
  title: string;
  url: string;
  score: number;
  comment_count: number;
  description_plain?: string;
  description?: string;
  created_at: string;
  tags?: string[];
}

/**
 * Decide whether a Lobsters story is AI-relevant: it carries an AI tag,
 * or its title/description matches one of the shared AI keywords.
 * Exported for unit testing.
 */
export function isAiStory(story: LobstersStory): boolean {
  const tags = story.tags ?? [];
  if (tags.some((t) => LOBSTERS_CONFIG.aiTags.includes(t.toLowerCase()))) {
    return true;
  }
  const text = ` ${`${story.title} ${story.description_plain ?? ""}`.toLowerCase()} `;
  return AI_KEYWORDS.some((kw) =>
    kw.length <= 3 ? new RegExp(`\\b${kw}\\b`).test(text) : text.includes(kw)
  );
}

/** Map a raw Lobsters story to a normalized Article (crowd score = vote count). */
export function toArticle(story: LobstersStory): Article {
  const published = new Date(story.created_at);
  return {
    title: story.title,
    // Lobsters stories may be self-posts with no external URL → fall back to comments page.
    url: story.url,
    source: "Lobsters",
    category: [],
    score: 0,
    summary: "",
    publishedAt: Number.isNaN(published.getTime()) ? null : published,
    fetchedAt: new Date(),
    abstract: (story.description_plain ?? story.description ?? "").slice(0, 1000),
    crowdScore: story.score,
  };
}

export const lobstersFetcher: Fetcher = {
  name: "Lobsters",

  async fetch(): Promise<Article[]> {
    try {
      const res = await fetch(LOBSTERS_CONFIG.url, {
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        console.warn(`[Lobsters] API returned ${res.status}`);
        return [];
      }

      const stories = (await res.json()) as LobstersStory[];

      return stories
        .filter((s) => s.url && s.score >= LOBSTERS_CONFIG.minScore && isAiStory(s))
        .slice(0, LOBSTERS_CONFIG.maxItems)
        .map(toArticle);
    } catch (err) {
      console.warn("[Lobsters] Failed:", err);
      return [];
    }
  },
};
