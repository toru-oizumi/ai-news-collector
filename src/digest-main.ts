import { APIResponseError, Client } from "@notionhq/client";
import { MISTRAL_CONFIG, env } from "./config.js";
import { generateDigest } from "./digest/digest.js";
import { closeBrowser, fetchArticleBody } from "./digest/fetcher.js";
import { writeDigestToPage } from "./digest/notion-writer.js";
import { translateArticle } from "./digest/translator.js";

interface ArticleRow {
  pageId: string;
  title: string;
  url: string;
}

const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

// Retry rate limits (429), server errors (5xx), and transport/network failures
// (e.g. the intermittent node-fetch "Premature close" drops — see TOR-71).
function isRetryable(err: unknown): boolean {
  if (err instanceof APIResponseError) return err.status === 429 || err.status >= 500;
  return true;
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const hasRetry = attempt < RETRY_DELAYS_MS.length;
      if (hasRetry && isRetryable(err)) {
        const delay = RETRY_DELAYS_MS[attempt];
        const reason =
          err instanceof APIResponseError
            ? `HTTP ${err.status}`
            : err instanceof Error
              ? err.message
              : String(err);
        console.warn(`[Notion] "${label}" failed (${reason}) — retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("withRetry: exhausted retries");
}

async function queryUnreadArticles(notion: Client): Promise<ArticleRow[]> {
  const res = await withRetry(
    () =>
      notion.databases.query({
        database_id: env.NOTION_DATABASE_ID,
        filter: {
          property: "Status",
          select: { equals: "Unread" },
        },
        sorts: [{ property: "Score", direction: "descending" }],
        page_size: 30,
      }),
    "databases.query"
  );

  return res.results
    .filter((p): p is Extract<typeof p, { properties: unknown }> => "properties" in p)
    .map((p) => {
      const props = p.properties as Record<
        string,
        { type: string; title?: { text?: { content?: string } }[]; url?: string }
      >;
      return {
        pageId: p.id,
        title: props.Title?.title?.[0]?.text?.content ?? "",
        url: props.URL?.url ?? "",
      };
    })
    .filter((a) => a.url);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const startTime = Date.now();
  console.log("=== AI News Digest + Translate ===");
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Mode: ${env.DRY_RUN ? "DRY RUN" : "LIVE"}`);

  if (env.DRY_RUN) {
    console.log(
      "[DRY RUN] Would query Notion for Unread articles, generate digests/translations, and write to Notion pages."
    );
    console.log("[DRY RUN] No API calls made.");
    return;
  }

  if (!env.NOTION_API_KEY || !env.NOTION_DATABASE_ID || !env.MISTRAL_API_KEY) {
    console.error("Missing required env vars: NOTION_API_KEY, NOTION_DATABASE_ID, MISTRAL_API_KEY");
    process.exit(1);
  }

  // Use native fetch (undici) rather than the client's default node-fetch, which
  // intermittently fails with "Premature close" on Node 24 (TOR-71).
  const notion = new Client({
    auth: env.NOTION_API_KEY,
    fetch: fetch as unknown as NonNullable<
      NonNullable<ConstructorParameters<typeof Client>[0]>["fetch"]
    >,
  });

  // 1. Query Notion DB for articles to process
  console.log("[1/4] Querying Notion for unprocessed articles...");
  const articles = await queryUnreadArticles(notion);
  console.log(`  Found ${articles.length} articles`);

  if (articles.length === 0) {
    console.log("No articles to process. Done!");
    return;
  }

  // 2. Process each article
  console.log("\n[2/4] Processing articles...");
  let success = 0;
  let fail = 0;
  let mistralAttempts = 0; // articles that reached Mistral API calls
  let digestTokens = 0;
  let translateTokens = 0;

  for (const article of articles) {
    console.log(`\n── ${article.title.slice(0, 60)}...`);

    // 2a. Fetch article body
    const paragraphs = await fetchArticleBody(article.url);
    if (paragraphs.length === 0) {
      console.log("   → Could not fetch body, skipping");
      fail++;
      continue;
    }
    console.log(`   → Fetched ${paragraphs.length} paragraphs`);

    mistralAttempts++;

    // 2b. Generate digest (1 API call)
    console.log("   → Generating digest...");
    const digestResult = await generateDigest(article.title, paragraphs);
    digestTokens += digestResult?.tokens ?? 0;
    await sleep(MISTRAL_CONFIG.delayMs);

    // 2c. Generate full Japanese translation (1 API call)
    console.log("   → Translating...");
    const { paragraphs: translated, tokens: tTokens } = await translateArticle(
      article.title,
      paragraphs
    );
    translateTokens += tTokens;
    await sleep(MISTRAL_CONFIG.delayMs);

    // Skip only if both failed
    if (!digestResult || translated.length === 0) {
      console.log("   → Digest or translation failed, skipping");
      fail++;
      continue;
    }

    // 2d. Write to Notion page body
    console.log("   → Writing to Notion page...");
    try {
      await writeDigestToPage(
        notion,
        article.pageId,
        digestResult.digest,
        digestResult.keyPoints,
        translated
      );

      // Small delay before status update to respect Notion rate limit
      await new Promise((r) => setTimeout(r, 350));

      await withRetry(
        () =>
          notion.pages.update({
            page_id: article.pageId,
            properties: {
              Status: { select: { name: "Digested" } },
            },
          }),
        article.title
      );

      console.log("   → Done");
      success++;
    } catch (err) {
      console.warn("   → Notion write failed:", err);
      fail++;
    }
  }

  // 3. Summary log with token usage
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalTokens = digestTokens + translateTokens;

  console.log("\n[3/4] Token usage:");
  console.log(
    `[Digest] Tokens — digest: ${digestTokens.toLocaleString()}, translate: ${translateTokens.toLocaleString()}, total: ${totalTokens.toLocaleString()}`
  );
  if (mistralAttempts > 0) {
    console.log(
      `[Digest] Avg tokens/article — digest: ${Math.round(digestTokens / mistralAttempts).toLocaleString()}, translate: ${Math.round(translateTokens / mistralAttempts).toLocaleString()}`
    );
  }
  // Monthly estimate: 30 days × 4 runs/day (every 6h, same cadence as collect)
  const monthlyEstimate = totalTokens * 30 * 4;
  const freeTierPct = ((monthlyEstimate / 1_000_000_000) * 100).toFixed(2);
  console.log(
    `[Digest] Monthly estimate: ~${monthlyEstimate.toLocaleString()} tokens (${freeTierPct}% of 1B free tier)`
  );

  console.log(`\n[4/4] Done in ${elapsed}s: ${success} success, ${fail} failed`);

  await closeBrowser();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
