import { appendFile, copyFile, mkdir, readFile } from "node:fs/promises";
import type { BriefBundle } from "../brief/bundle.js";
import { verifyBriefFiles } from "../brief/files.js";
import { type LatestRun, requireCompletedLatest } from "../brief/latest-run.js";
import { env } from "../config.js";
import type { Article } from "../types.js";
import { type Outbox, prepareOutbox, readOutbox, writeOutbox } from "./outbox.js";

async function main(): Promise<void> {
  const [mode, directory] = process.argv.slice(2);
  if (!["prepare", "validate"].includes(mode) || !directory)
    throw new Error("Expected prepare|validate and bundle directory");
  const input = JSON.parse(await readFile(`${directory}/brief.json`, "utf8")) as BriefBundle;
  if (input.run.repository !== process.env.GITHUB_REPOSITORY)
    throw new Error("Brief repository mismatch");
  const latest = JSON.parse(await readFile("latest-collect.json", "utf8")) as LatestRun;
  const expected = requireCompletedLatest(latest);
  const bundle = await verifyBriefFiles(directory, expected, Date.now());
  if (!env.SLACK_CHANNEL_ID) throw new Error("Slack channel configuration missing");
  let box: Outbox;
  if (mode === "prepare") {
    if (bundle.run.runId !== process.env.SOURCE_RUN_ID) throw new Error("Brief run mismatch");
    const articles: Article[] = bundle.articles.map((a) => ({
      title: a.title,
      url: a.url,
      source: a.source as Article["source"],
      category: [],
      score: a.score,
      summary: a.summary ? `自動要約・抜粋（意味未検証）: ${a.summary}` : "要約なし",
      abstract: "",
      publishedAt: a.publishedAt ? new Date(a.publishedAt) : null,
      fetchedAt: new Date(a.collectedAt),
    }));
    box = prepareOutbox(articles, env.SLACK_CHANNEL_ID, bundle.generatedAt.slice(0, 10));
    await mkdir("slack-output", { recursive: true });
    await writeOutbox("slack-output/outbox.json", box);
    for (const name of ["brief.json", "brief.md", "manifest.json"])
      await copyFile(`${directory}/${name}`, `slack-output/${name}`);
  } else {
    box = await readOutbox(`${directory}/outbox.json`);
    const expected = prepareOutbox(
      bundle.articles.map((a) => ({ title: a.title, url: a.url }) as Article),
      env.SLACK_CHANNEL_ID,
      bundle.generatedAt.slice(0, 10)
    );
    if (
      box.id !== expected.id ||
      box.channel !== env.SLACK_CHANNEL_ID ||
      box.articles.some((a) => !bundle.articles.some((b) => b.url === a.url))
    )
      throw new Error("Outbox does not match reviewed source/channel");
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `batch=${box.id}\n`);
  console.log("Optional Slack artifact validated; no message sent by this command");
}
main().catch(() => {
  console.error("Optional Slack artifact validation failed; delivery is blocked");
  process.exitCode = 1;
});
