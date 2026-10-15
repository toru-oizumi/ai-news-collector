import { readFile, writeFile } from "node:fs/promises";
import { SLACK_CONFIG, env } from "../config.js";
import type { ExportedArticle } from "../notion/client.js";
import { postMessage } from "../slack/client.js";
import type { Article } from "../types.js";
import { deliverOutbox, prepareOutbox, readOutbox, withOutboxLock, writeOutbox } from "./outbox.js";

async function main(): Promise<void> {
  const [mode, input, output, channel] = process.argv.slice(2);
  if (mode === "prepare" && input && output && channel) {
    const rows = JSON.parse(await readFile(input, "utf8")) as ExportedArticle[];
    const articles: Article[] = rows.map((row) => ({
      title: row.title,
      url: row.url,
      source: row.source as Article["source"],
      category: row.category as Article["category"],
      score: row.score,
      summary: row.summary
        ? `保存済み要約（未検証）: ${row.summary.slice(0, 300)}`
        : "（要約未生成）",
      abstract: "",
      publishedAt: null,
      fetchedAt: new Date(0),
      notionUrl: row.notionUrl,
    }));
    const box = prepareOutbox(articles, channel, new Date().toISOString().slice(0, 10));
    // Never overwrite an existing delivery ledger while preparing a preview.
    await writeFile(output, JSON.stringify(box, null, 2), { encoding: "utf8", flag: "wx" });
    console.log(
      `Prepared ${box.articles.length} articles locally. Review ${output} before sending.`
    );
    return;
  }
  if (mode === "deliver" && input && process.argv.includes("--execute")) {
    await withOutboxLock(input, async () => {
      const box = await readOutbox(input);
      if (!env.SLACK_BOT_TOKEN || box.channel !== env.SLACK_CHANNEL_ID)
        throw new Error("Configured Slack channel must match the reviewed outbox");
      await deliverOutbox(box, {
        checkpoint: (state) => writeOutbox(input, state),
        send: postMessage,
        wait: () => new Promise((resolve) => setTimeout(resolve, SLACK_CONFIG.replyDelayMs)),
      });
    });
    console.log("Outbox delivery confirmed");
    return;
  }
  throw new Error(
    "Usage: optional:slack -- prepare <snapshot.json> <outbox.json> <channel-id> OR deliver <outbox.json> --execute"
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Optional delivery failed");
  process.exitCode = 1;
});
