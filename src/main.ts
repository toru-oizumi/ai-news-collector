import { MISTRAL_CONFIG, RSS_SOURCES, env } from "./config.js";
import { getExistingUrls, pushOneToNotion } from "./notion/client.js";
import { dedup } from "./pipeline/dedup.js";
import { scoreAndFilter, selectDiverse } from "./pipeline/scorer.js";
import { summarizeOne } from "./pipeline/summarizer.js";
import { postSlackDigest } from "./slack/client.js";
import { anthropicFetcher } from "./sources/anthropic-scraper.js";
import { githubTrendingFetcher } from "./sources/github-trending.js";
import { hackerNewsFetcher } from "./sources/hackernews.js";
import { huggingFaceFetcher } from "./sources/huggingface.js";
import { lobstersFetcher } from "./sources/lobsters.js";
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
    lobstersFetcher,
    githubTrendingFetcher,
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

  // ── Step 5: Process article by article (summarize → push) ──
  // Cap per-source representation so one high-volume source can't fill every slot.
  const toProcess = selectDiverse(articles, MISTRAL_CONFIG.maxSummarize);

  if (env.DRY_RUN) {
    console.log("\n[5/5] Skipping Mistral summarization (dry-run)");
    console.log("\n=== DRY RUN RESULTS ===");
    for (const a of toProcess.slice(0, 20)) {
      const crowd = a.crowdScore !== undefined ? ` crowd: ${a.crowdScore}` : "";
      console.log(`\n[${a.source}] (score: ${a.score}${crowd}) ${a.title}`);
      console.log(`  URL: ${a.url}`);
      console.log(`  Categories: ${a.category.join(", ")}`);
    }
    if (toProcess.length > 20) {
      console.log(`\n... and ${toProcess.length - 20} more`);
    }
  } else if (env.NOTION_API_KEY && env.NOTION_DATABASE_ID) {
    console.log(`\n[5/5] Processing ${toProcess.length} articles (summarize → push)...`);
    let skipped = 0;
    let totalTokens = 0;
    // Successfully-pushed articles, in score order, for the Slack digest.
    const pushed: Article[] = [];

    for (let i = 0; i < toProcess.length; i++) {
      const article = toProcess[i];
      const tag = `[${i + 1}/${toProcess.length}]`;

      const tokens = await summarizeOne(article);
      totalTokens += tokens;

      const notionUrl = await pushOneToNotion(article);
      const ok = notionUrl !== null;
      if (ok) {
        if (notionUrl) article.notionUrl = notionUrl;
        pushed.push(article);
      } else {
        skipped++;
      }

      const title = article.title.slice(0, 60);
      console.log(`  ${tag} ${ok ? "✓" : "✗"} [${article.source}] ${title}`);
    }

    console.log(`\n  Created: ${pushed.length}, Skipped: ${skipped}`);
    const avgTokens = toProcess.length > 0 ? Math.round(totalTokens / toProcess.length) : 0;
    console.log(
      `[Summarizer] Total tokens: ${totalTokens.toLocaleString()} (avg: ${avgTokens}/article)`
    );

    // ── Step 6: Post a digest to Slack (optional, best-effort) ──
    if (env.SLACK_BOT_TOKEN && env.SLACK_CHANNEL_ID) {
      const ok = await postSlackDigest(pushed, pushed.length);
      console.log(ok ? "  ✓ Slack digest posted" : "  ⚠ Slack digest not posted");
    }
  } else {
    console.warn("\n⚠ No NOTION_API_KEY / NOTION_DATABASE_ID — printing results only");
    for (const a of toProcess.slice(0, 10)) {
      console.log(`[${a.source}] ${a.title} → ${a.url}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Done in ${elapsed}s ===`);
}

main()
  // Force a clean exit on success. `npm run collect` runs via tsx (esbuild
  // service), which leaves an open handle that keeps the event loop alive
  // after main() resolves — without this the process hangs until the CI job
  // timeout cancels it. See TOR-44.
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
