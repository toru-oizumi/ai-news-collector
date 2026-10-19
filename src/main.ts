import { appendFile } from "node:fs/promises";
import { confirmSaved, loadConfirmed } from "./collection/confirmed.js";
import { preparePending } from "./collection/priority.js";
import { collectPending, loadPending, savePending } from "./collection/queue.js";
import { JP_RSS_SOURCES, RSS_SOURCES, env } from "./config.js";
import { enqueuePage } from "./enrichment/backlog.js";
import { pushOneToNotion } from "./notion/client.js";
import { dedup } from "./pipeline/dedup.js";
import { scoreAndFilter } from "./pipeline/scorer.js";
import { type StageReport, runReported } from "./runtime/reports.js";
import { anthropicFetcher } from "./sources/anthropic-scraper.js";
import { githubTrendingFetcher } from "./sources/github-trending.js";
import { hackerNewsFetcher } from "./sources/hackernews.js";
import { huggingFaceFetcher } from "./sources/huggingface.js";
import { lobstersFetcher } from "./sources/lobsters.js";
import { qiitaFetcher } from "./sources/qiita.js";
import { createRSSFetcher } from "./sources/rss-fetcher.js";
import type { Article, Fetcher } from "./types.js";

async function main(report?: StageReport) {
  const startTime = Date.now();
  console.log("=== AI News Collector ===");
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Mode: ${env.DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log();

  // ── Step 1: Fetch from all sources in parallel ──
  console.log("[1/4] Fetching from sources...");

  const fetchers: Fetcher[] = [
    ...RSS_SOURCES.map(createRSSFetcher),
    ...JP_RSS_SOURCES.map(createRSSFetcher),
    anthropicFetcher,
    hackerNewsFetcher,
    huggingFaceFetcher,
    lobstersFetcher,
    githubTrendingFetcher,
    qiitaFetcher,
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
  if (report) report.stats.fetched = allArticles.length;

  // ── Step 2: Deduplicate ──
  console.log("\n[2/4] Deduplicating...");
  let articles = dedup(allArticles);
  console.log(`  After dedup: ${articles.length}`);

  // ── Step 3: Score and filter ──
  console.log("\n[3/4] Scoring and filtering...");
  articles = scoreAndFilter(articles);
  console.log(`  After scoring (min threshold): ${articles.length}`);

  if (env.DRY_RUN) {
    console.log(`[DRY RUN] ${articles.length} candidates; no Notion, Mistral or Slack writes`);
    return;
  }
  if (!env.NOTION_API_KEY || !env.NOTION_DATABASE_ID) {
    throw new Error("NOTION_API_KEY and NOTION_DATABASE_ID are required");
  }

  // Persist every candidate BEFORE querying/writing Notion. No summarization quota
  // drops raw collection results; unsuccessful saves remain in the local queue.
  console.log("\n[4/4] Saving raw articles with checkpoints...");
  const confirmed = await loadConfirmed();
  const pending = preparePending(await loadPending(), articles, confirmed, Date.now());
  await savePending(pending);
  // Each save performs a bounded URL lookup and fails closed on lookup failure.
  let snapshotReady = false;
  const result = await collectPending(pending, {
    save: async (article) => {
      const saved = await pushOneToNotion(article);
      if (saved !== null) {
        if (!snapshotReady && process.env.GITHUB_OUTPUT) {
          // Publish can proceed even if a later save/checkpoint fails.
          await appendFile(process.env.GITHUB_OUTPUT, "ready=true\n");
        }
        snapshotReady = true;
        if (article.lang !== "ja") await enqueuePage(article, saved.notionUrl);
        await confirmSaved(confirmed, article.url);
      }
      return saved;
    },
    checkpoint: savePending,
    deadline: startTime + 8 * 60_000,
  });
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `ready=${snapshotReady || result.pending === 0}\n`);
  }
  console.log(
    `Confirmed saved: ${result.saved + result.existing} (created: ${result.saved}, existing: ${result.existing}), pending: ${result.pending}`
  );
  if (report)
    report.stats = {
      ...report.stats,
      confirmed: result.saved + result.existing,
      created: result.saved,
      existing: result.existing,
      pending: result.pending,
    };
  if (result.pending > 0) {
    console.warn(
      `::warning::Collection incomplete: ${result.pending} pending; checkpoint retained for replay.`
    );
    if (!snapshotReady) throw new Error("No candidate could be confirmed saved");
  }
  // Delivery is intentionally separate: no replay of a partially delivered Slack
  // thread. The local brief command can read a saved snapshot without credentials.

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Done in ${elapsed}s ===`);
}

(env.DRY_RUN ? main() : runReported("collect", main))
  // Force a clean exit on success. `npm run collect` runs via tsx (esbuild
  // service), which leaves an open handle that keeps the event loop alive
  // after main() resolves — without this the process hangs until the CI job
  // timeout cancels it. See TOR-44.
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
