import type { Article } from "../types.js";

/**
 * Deduplicate articles by normalized URL.
 * When duplicates exist, keep the one with higher score or from a higher-priority source.
 */
export function dedup(articles: Article[]): Article[] {
  const map = new Map<string, Article>();

  for (const article of articles) {
    const key = normalizeForDedup(article.url);
    const existing = map.get(key);
    if (!existing || rank(article) > rank(existing)) {
      map.set(key, article);
    }
  }

  return Array.from(map.values());
}

/**
 * Comparison key for choosing which duplicate to keep. Dedup runs before scoring,
 * so `score` is usually 0 here; fall back to the crowd signal so a story that also
 * surfaced on HN/Lobsters (with votes) wins over a bare RSS duplicate.
 */
function rank(article: Article): number {
  return article.score > 0 ? article.score : (article.crowdScore ?? 0);
}

function normalizeForDedup(url: string): string {
  try {
    const u = new URL(url);
    // Strip protocol, www, trailing slash
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
