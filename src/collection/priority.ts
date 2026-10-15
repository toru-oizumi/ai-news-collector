import { dedup, normalizeForDedup } from "../pipeline/dedup.js";
import type { Article } from "../types.js";

const WEEK_MS = 7 * 24 * 60 * 60_000;

/** Keep the backlog, but spend the bounded save window on fresh news first. */
export function preparePending(
  backlog: Article[],
  incoming: Article[],
  confirmed: Set<string>,
  now: number
): Article[] {
  const originals = new Map<string, Article>();
  for (const article of backlog) {
    const key = normalizeForDedup(article.url);
    if (!originals.has(key)) originals.set(key, article);
  }
  const recent = (a: Article): boolean => {
    const published = a.publishedAt?.getTime();
    return published !== undefined && published <= now && now - published < WEEK_MS;
  };
  return dedup([...backlog, ...incoming])
    .filter((a) => !confirmed.has(normalizeForDedup(a.url)))
    .map((a) => {
      const original = originals.get(normalizeForDedup(a.url));
      return original
        ? {
            ...a,
            fetchedAt: original.fetchedAt,
            publishedAt: original.publishedAt ?? a.publishedAt,
          }
        : a;
    })
    .sort((a, b) => {
      const aRecent = recent(a);
      const bRecent = recent(b);
      if (aRecent !== bRecent) return aRecent ? -1 : 1;
      if (!aRecent) return 0; // preserve FIFO for old, unknown and future dates
      return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) || b.score - a.score;
    });
}
