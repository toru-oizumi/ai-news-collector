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

export function normalizeForDedup(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith("utm_") || ["ref", "fbclid", "gclid"].includes(key))
        u.searchParams.delete(key);
    }
    u.searchParams.sort();
    // Preserve path case and semantic query parameters (e.g. /item?id=123).
    return `${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return url.toLowerCase();
  }
}

/** Exact lookup alternatives for URL spellings historically saved by the collector. */
export function lookupUrls(url: string): string[] {
  const key = normalizeForDedup(url);
  return [
    ...new Set([
      url,
      ...["https://", "http://"].flatMap((protocol) =>
        ["", "www."].flatMap((www) => {
          const parsed = new URL(`${protocol}${www}${key}`);
          const other = new URL(parsed);
          other.pathname = parsed.pathname.endsWith("/")
            ? parsed.pathname.slice(0, -1)
            : `${parsed.pathname}/`;
          return [parsed.toString(), other.toString()];
        })
      ),
    ]),
  ];
}
