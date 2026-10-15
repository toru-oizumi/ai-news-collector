import { Client } from "@notionhq/client";
import { MISTRAL_CONFIG, env } from "./config.js";
import { closeBrowser, fetchArticleBody } from "./digest/fetcher.js";
import { callMistral } from "./digest/mistral-client.js";
import { loadBacklog, saveBacklog } from "./enrichment/backlog.js";
import { loadRow, persistSummary } from "./enrichment/notion-store.js";
import { enrichOne } from "./enrichment/processor.js";
import { runEnrichment } from "./enrichment/runner.js";
import { processingBlock } from "./enrichment/state.js";

async function main(): Promise<void> {
  if (env.DRY_RUN) {
    console.log("[DRY RUN] No API calls. Would enrich at most 10 saved pages within 12 minutes.");
    return;
  }
  if (!env.NOTION_API_KEY || !env.NOTION_DATABASE_ID || !env.MISTRAL_API_KEY) {
    throw new Error("NOTION_API_KEY, NOTION_DATABASE_ID and MISTRAL_API_KEY are required");
  }
  const notion = new Client({
    auth: env.NOTION_API_KEY,
    timeoutMs: 20_000,
    fetch: fetch as unknown as NonNullable<
      NonNullable<ConstructorParameters<typeof Client>[0]>["fetch"]
    >,
  });
  try {
    const result = await runEnrichment(await loadBacklog(), {
      deadline: Date.now() + 12 * 60_000,
      load: (page) => loadRow(notion, page),
      reserve: async (row, state) => {
        const block = processingBlock(state);
        if ("code" in block)
          await notion.blocks.update({ block_id: row.blockId, code: block.code });
      },
      process: (row) =>
        enrichOne(row, {
          fetchBody: fetchArticleBody,
          generate: callMistral,
          persist: (item, state, summary) => persistSummary(notion, item, state, summary),
        }),
      checkpoint: saveBacklog,
      wait: () => new Promise((resolve) => setTimeout(resolve, MISTRAL_CONFIG.delayMs)),
    });
    console.log(`Enrichment: ${result.processed} processed; ${result.pending} pending`);
    if (result.failed) throw new Error("Enrichment persistence unavailable");
  } finally {
    await closeBrowser();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => {
    console.error("Enrichment failed; checkpoint retained");
    process.exit(1);
  });
