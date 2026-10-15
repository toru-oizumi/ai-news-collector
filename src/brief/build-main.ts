import { appendFile } from "node:fs/promises";
import { Client } from "@notionhq/client";
import { env } from "../config.js";
import { currentRun, loadReport } from "../runtime/reports.js";
import { type BriefCandidate, buildBundle } from "./bundle.js";
import { writeBriefFiles } from "./files.js";
import { readBriefCandidates } from "./notion-reader.js";

async function main(): Promise<void> {
  let collection = null;
  let enrichment = null;
  try {
    collection = await loadReport("collect");
    enrichment = await loadReport("enrich");
  } catch {
    /* Diagnostic bundle is still emitted. */
  }
  const run = currentRun();
  const ready = process.env.COLLECTION_READY === "true" && process.env.CHECKPOINT_VALID === "true";
  let candidates: BriefCandidate[] = [];
  let sourceReadAt: string | null = null;
  let readFailed = false;
  let sourceLimited = false;
  if (ready && collection && Number(collection.stats.fetched ?? 0) > 0) {
    try {
      if (!env.NOTION_API_KEY || !env.NOTION_DATABASE_ID)
        throw new Error("Notion credentials unavailable");
      const notion = new Client({
        auth: env.NOTION_API_KEY,
        timeoutMs: 10_000,
        fetch: fetch as unknown as NonNullable<
          NonNullable<ConstructorParameters<typeof Client>[0]>["fetch"]
        >,
      });
      const result = await readBriefCandidates(notion, env.NOTION_DATABASE_ID, Date.now());
      candidates = result.articles;
      sourceLimited = result.limited;
      sourceReadAt = new Date().toISOString();
    } catch {
      readFailed = true;
    }
  } else if (ready && collection && collection.stats.fetched === 0) {
    sourceReadAt = new Date().toISOString(); // explicit no-data collection, no stale read fallback
  }
  const bundle = buildBundle({
    run,
    now: Date.now(),
    collection,
    enrichment,
    collectionResult: process.env.COLLECTION_RESULT ?? "unknown",
    enrichmentResult: process.env.ENRICHMENT_RESULT ?? "unknown",
    ready,
    candidates,
    sourceReadAt,
    readFailed,
    sourceLimited,
  });
  await writeBriefFiles("brief-output", bundle);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `# Brief status\n\nGenerated: ${bundle.generatedAt}\nValid until: ${bundle.validUntil}\nStatus: ${bundle.status}\nArticles: ${bundle.articles.length}\nDelivery allowed: ${bundle.deliveryAllowed}\n\nRead the named artifact; article content is not copied into this potentially public job summary.\n`
    );
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `deliverable=${bundle.deliveryAllowed}\nstatus=${bundle.status}\n`
    );
  if (bundle.status === "unavailable") {
    console.error("Brief unavailable; diagnostic artifact generated, do not deliver older results");
    process.exitCode = 1;
  } else
    console.log(
      `Brief generated: ${bundle.status}, ${bundle.articles.length} articles; no messages sent`
    );
}
main().catch(() => {
  console.error("Brief generation failed before artifact completion");
  process.exitCode = 1;
});
