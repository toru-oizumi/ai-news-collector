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
    if (!existing || article.score > existing.score) {
      map.set(key, article);
    }
  }

  return Array.from(map.values());
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
