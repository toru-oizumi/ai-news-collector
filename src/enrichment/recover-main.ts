import { readFile } from "node:fs/promises";
import type { ExportedArticle } from "../notion/client.js";
import { loadBacklog, saveBacklog } from "./backlog.js";

// Local recovery only. Subsequent enrichment checks each page's managed state;
// legacy pages without a marker are ignored and user reading Status is preserved.
async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: npm run recover:enrichment -- <local-snapshot.json>");
  const articles = JSON.parse(await readFile(path, "utf8")) as ExportedArticle[];
  if (!Array.isArray(articles)) throw new Error("Expected an exported article array");
  const pending = await loadBacklog();
  const known = new Set(pending.map((row) => row.pageId.replace(/-/g, "")));
  for (const article of articles) {
    const pageId = article.id.replace(/-/g, "");
    if (!/^[a-f0-9]{32}$/i.test(pageId) || known.has(pageId) || article.lang === "ja") continue;
    pending.push({ pageId, title: article.title, url: article.url });
    known.add(pageId);
  }
  await saveBacklog(pending);
  console.log(
    `${pending.length} page references checkpointed locally. No external API calls made.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Recovery failed");
  process.exitCode = 1;
});
