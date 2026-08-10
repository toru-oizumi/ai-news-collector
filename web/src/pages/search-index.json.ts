import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { collectedOn, dateOf } from "../lib/articles";

/**
 * Search payload for the toolbar, emitted as a static file at build time.
 *
 * Two deliberate limits keep this to a size worth downloading on first use:
 *
 * 1. Windowed on collection date, not publish date — aggregators resurface material
 *    published years ago, and those rows are still recent reading.
 * 2. No summaries. Including even a 90-character excerpt tripled the payload
 *    (~370 KB → ~1.1 MB gzipped), so search covers titles, source names and
 *    categories. Toolbar.astro says so in the input's placeholder rather than
 *    implying full-text search that isn't there.
 *
 * Emitted as arrays rather than objects: repeating eleven key names across ~10,000
 * records is pure overhead. FIELDS documents the order for the consumer.
 */
const SEARCH_WINDOW_DAYS = 90;

/** Tuple layout. Keep in sync with the reader in Toolbar.astro. */
const FIELDS = [
  "title",
  "url",
  "source",
  "categories", // pipe-joined
  "score",
  "date", // display date
  "status",
  "lang",
  "kind",
] as const;

export const GET: APIRoute = async () => {
  const cutoff = new Date(Date.now() - SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const entries = await getCollection("articles");

  const items = entries
    .map((entry) => entry.data)
    .filter((a) => collectedOn(a) >= cutoff)
    .sort((a, b) => b.score - a.score)
    .map((a) => [
      a.title,
      a.url,
      a.source,
      a.category.join("|"),
      a.score,
      dateOf(a),
      a.status,
      a.lang,
      a.kind,
    ]);

  return new Response(JSON.stringify({ fields: FIELDS, windowDays: SEARCH_WINDOW_DAYS, items }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
