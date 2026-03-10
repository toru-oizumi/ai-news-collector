import { RSS_SOURCES, env } from "./config.js";
import { getExistingUrls, pushToNotion } from "./notion/client.js";
import { dedup } from "./pipeline/dedup.js";
import { scoreAndFilter } from "./pipeline/scorer.js";
import { summarizeArticles } from "./pipeline/summarizer.js";
import { anthropicFetcher } from "./sources/anthropic-scraper.js";
import { hackerNewsFetcher } from "./sources/hackernews.js";
import { huggingFaceFetcher } from "./sources/huggingface.js";
import { createRSSFetcher } from "./sources/rss-fetcher.js";
import type { Article, Fetcher } from "./types.js";

async function main() {
  const startTime = Date.now();
  console.log("=== AI News Collector ===");
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Mode: ${env.DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log();

  // ── Step 1: Fetch from all sources in parallel ──
  console.log("[1/5] Fetching from sources...");

  const fetchers: Fetcher[] = [
    ...RSS_SOURCES.map(createRSSFetcher),
    anthropicFetcher,
    hackerNewsFetcher,
    huggingFaceFetcher,
  ];

  const fetchResults = await Promise.allSettled(
    fetchers.map(async (f) => {
      try {
        const articles = await f.fetch();
        console.log(`  ✓ ${f.name}: ${articles.length} articles`);
        return articles;
      } catch (err) {
        console.warn(`  ✗ ${f.name}: ${err}`);
        return [] as Article[];
      }
    })
  );

  const allArticles = fetchResults.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  console.log(`\n  Total fetched: ${allArticles.length}`);

  // ── Step 2: Deduplicate ──
  console.log("\n[2/5] Deduplicating...");
  let articles = dedup(allArticles);
  console.log(`  After dedup: ${articles.length}`);

  // ── Step 3: Score and filter ──
  console.log("\n[3/5] Scoring and filtering...");
  articles = scoreAndFilter(articles);
  console.log(`  After scoring (min threshold): ${articles.length}`);

  // ── Step 4: Remove already-seen URLs (from Notion DB) ──
  if (!env.DRY_RUN && env.NOTION_API_KEY && env.NOTION_DATABASE_ID) {
    console.log("\n[4/5] Checking Notion for existing articles...");
    try {
      const existingUrls = await getExistingUrls();
      const beforeCount = articles.length;
      articles = articles.filter((a) => !existingUrls.has(a.url));
      console.log(`  Removed ${beforeCount - articles.length} duplicates (already in Notion)`);
      console.log(`  New articles to process: ${articles.length}`);
    } catch (err) {
      console.warn("  ⚠ Could not query Notion for dedup:", err);
    }
  } else {
    console.log("\n[4/5] Skipping Notion dedup (dry-run or no credentials)");
  }

  if (articles.length === 0) {
    console.log("\nNo new articles to process. Done!");
    return;
  }

  // ── Step 5: Summarize with Gemini ──
  console.log("\n[5/5] Summarizing with Gemini...");
  await summarizeArticles(articles);

  // ── Output / Push ──
  if (env.DRY_RUN) {
    console.log("\n=== DRY RUN RESULTS ===");
    for (const a of articles.slice(0, 20)) {
      console.log(`\n[${a.source}] (score: ${a.score}) ${a.title}`);
      console.log(`  URL: ${a.url}`);
      console.log(`  Categories: ${a.category.join(", ")}`);
      if (a.summary) console.log(`  Summary: ${a.summary}`);
    }
    if (articles.length > 20) {
      console.log(`\n... and ${articles.length - 20} more`);
    }
  } else if (env.NOTION_API_KEY && env.NOTION_DATABASE_ID) {
    console.log("\nPushing to Notion...");
    const result = await pushToNotion(articles);
    console.log(`  Created: ${result.created}, Skipped: ${result.skipped}`);
  } else {
    console.warn("\n⚠ No NOTION_API_KEY / NOTION_DATABASE_ID — printing results only");
    for (const a of articles.slice(0, 10)) {
      console.log(`[${a.source}] ${a.title} → ${a.url}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Done in ${elapsed}s ===`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
