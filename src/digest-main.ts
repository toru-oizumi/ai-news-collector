import { Client } from "@notionhq/client";
import { MISTRAL_CONFIG, env } from "./config.js";
import { generateDigest } from "./digest/digest.js";
import { fetchArticleBody } from "./digest/fetcher.js";
import { writeDigestToPage } from "./digest/notion-writer.js";
import { translateArticle } from "./digest/translator.js";

interface ArticleRow {
  pageId: string;
  title: string;
  url: string;
}

async function queryUnreadArticles(notion: Client): Promise<ArticleRow[]> {
  const res = await notion.databases.query({
    database_id: env.NOTION_DATABASE_ID,
    filter: {
      property: "Status",
      select: { equals: "Unread" },
    },
    sorts: [{ property: "Score", direction: "descending" }],
    page_size: 30,
  });

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

  if (!env.NOTION_API_KEY || !env.NOTION_DATABASE_ID || !env.MISTRAL_API_KEY) {
    console.error("Missing required env vars: NOTION_API_KEY, NOTION_DATABASE_ID, MISTRAL_API_KEY");
    process.exit(1);
  }

  const notion = new Client({ auth: env.NOTION_API_KEY });

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

    if (!digestResult && translated.length === 0) {
      console.log("   → Both digest and translation failed, skipping");
      fail++;
      continue;
    }

    // 2d. Write to Notion page body
    console.log("   → Writing to Notion page...");
    try {
      await writeDigestToPage(
        notion,
        article.pageId,
        digestResult?.digest ?? "(Digest generation failed)",
        digestResult?.keyPoints ?? [],
        translated
      );

      // Update Status to "Digested" to prevent re-processing
      await notion.pages.update({
        page_id: article.pageId,
        properties: {
          Status: { select: { name: "Digested" } },
        },
      });

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
  const processed = success + fail;

  console.log(`\n[4/4] Done in ${elapsed}s: ${success} success, ${fail} failed`);
  console.log(
    `[Digest] Tokens — digest: ${digestTokens.toLocaleString()}, translate: ${translateTokens.toLocaleString()}, total: ${totalTokens.toLocaleString()}`
  );
  if (processed > 0) {
    console.log(
      `[Digest] Avg tokens/article — digest: ${Math.round(digestTokens / processed).toLocaleString()}, translate: ${Math.round(translateTokens / processed).toLocaleString()}`
    );
  }
  // Monthly estimate: 30 days × 4 runs/day (every 6h, same cadence as collect)
  const monthlyEstimate = totalTokens * 30 * 4;
  const freeTierPct = ((monthlyEstimate / 1_000_000_000) * 100).toFixed(2);
  console.log(
    `[Digest] Monthly estimate: ~${monthlyEstimate.toLocaleString()} tokens (${freeTierPct}% of 1B free tier)`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
