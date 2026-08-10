import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { env } from "../config.js";
import { type ExportedArticle, getAllArticles } from "../notion/client.js";

/**
 * Export the Notion database to a JSON snapshot for the Astro site to build from.
 *
 * The site reads this file through Astro's built-in `file()` content loader rather than
 * calling Notion during the build. That keeps Notion access in one tested place, keeps
 * credentials out of the site build, and leaves an inspectable intermediate artifact.
 */

const OUTPUT_PATH = resolve(import.meta.dirname, "../../web/src/data/articles.json");

/** Search index cutoff, in days. Bounds the payload the browser downloads; older
 *  articles remain reachable through the paginated listings. */
const SEARCH_WINDOW_DAYS = 90;

/** When the article entered the collection — the ordering key. Not the publish date:
 *  aggregators resurface old material, so publish dates run years back. */
function collectedOn(article: ExportedArticle): string {
  return article.fetched ?? article.published ?? "";
}

async function main(): Promise<void> {
  if (env.DRY_RUN) {
    console.log("[DRY RUN] Would export the Notion database to", OUTPUT_PATH);
    return;
  }
  if (!env.NOTION_API_KEY || !env.NOTION_DATABASE_ID) {
    throw new Error("NOTION_API_KEY and NOTION_DATABASE_ID are required to export");
  }

  const articles = await getAllArticles();
  if (articles.length === 0) {
    // Writing an empty array would deploy an empty site over a working one.
    throw new Error("Notion returned no articles — refusing to write an empty snapshot");
  }

  // Sort newest-first so the site can page through in order without re-sorting
  // the whole collection at build time.
  articles.sort((a, b) => collectedOn(b).localeCompare(collectedOn(a)));

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  // Minified: this file is a build input, not something anyone reads, and pretty-printing
  // 21k records costs several megabytes on disk and in CI transfer.
  await writeFile(OUTPUT_PATH, `${JSON.stringify(articles)}\n`, "utf8");

  const cutoff = new Date(Date.now() - SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const searchable = articles.filter((a) => collectedOn(a) >= cutoff).length;
  const bySource = new Map<string, number>();
  for (const a of articles) bySource.set(a.source, (bySource.get(a.source) ?? 0) + 1);

  console.log(`Wrote ${articles.length} articles to ${OUTPUT_PATH}`);
  console.log(`  Sources: ${bySource.size}`);
  console.log(`  Japanese: ${articles.filter((a) => a.lang === "ja").length}`);
  console.log(`  Within the ${SEARCH_WINDOW_DAYS}-day search window: ${searchable}`);
}

main()
  // Match the collector: tsx leaves an open esbuild handle that keeps the event loop
  // alive after main() resolves. See TOR-44.
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Export failed:", err);
    process.exit(1);
  });
