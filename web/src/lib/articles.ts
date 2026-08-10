import type { CollectionEntry } from "astro:content";

export type Article = CollectionEntry<"articles">["data"];

/** Rows per page in every paged listing. */
export const PER_PAGE = 50;

/**
 * How many articles the front page covers before you switch to the month archive.
 *
 * The front page necessarily changes on every publish, so it is kept small. The
 * complete record lives in /archive/<YYYY-MM>/, whose pages don't shift when new
 * articles arrive — which is also what lets wrangler upload only what changed.
 */
export const RECENT_LIMIT = 200;

/**
 * How deep the per-source and per-category views go.
 *
 * These are score-ranked "what is worth reading here" views, not archives. Without a
 * cap they were the bulk of the build: articles carry ~3.9 categories each, so the
 * category listings alone expanded 21,020 articles into 82,661 rows over 1,659 pages.
 */
export const FACET_LIMIT = 200;

/**
 * Date to show the reader: when the article was published, falling back to when the
 * collector picked it up. ~1,000 rows have no publish date at all.
 */
export function dateOf(article: Article): string | null {
  return article.published ?? article.fetched;
}

/**
 * Date to order and group by: when the article entered the collection.
 *
 * Deliberately not the publish date. Aggregator sources resurface old material — a
 * Hacker News thread about a 2019 paper carries a 2019 publish date, and ~2,800 rows
 * fetched in the last 90 days were published before it. Ordering by publish date buries
 * those in the archive, where nobody would see that they are today's reading.
 */
export function collectedOn(article: Article): string {
  return article.fetched ?? article.published ?? "";
}

/** Collection month as YYYY-MM, or "" for a row with no usable date. */
export function monthOf(article: Article): string {
  return collectedOn(article).slice(0, 7);
}

/** Newest first, with score breaking ties so a busy day still reads as ranked. */
export function byNewest(a: Article, b: Article): number {
  const dateDiff = collectedOn(b).localeCompare(collectedOn(a));
  return dateDiff !== 0 ? dateDiff : b.score - a.score;
}

/** Highest score first, for the per-source and per-category views. */
export function byScore(a: Article, b: Article): number {
  const scoreDiff = b.score - a.score;
  return scoreDiff !== 0 ? scoreDiff : collectedOn(b).localeCompare(collectedOn(a));
}

/** Group articles by collection month, newest month first, rows newest-first within. */
export function groupByMonth(articles: Article[]): Map<string, Article[]> {
  const groups = new Map<string, Article[]>();
  for (const article of articles) {
    const month = monthOf(article);
    if (!month) continue;
    const list = groups.get(month) ?? [];
    list.push(article);
    groups.set(month, list);
  }
  for (const list of groups.values()) list.sort(byNewest);
  return new Map([...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])));
}

/** "2026-08" → "2026年8月" */
export function formatMonth(month: string): string {
  const [year, m] = month.split("-");
  return `${year}年${Number(m)}月`;
}
