import { env } from "../config.js";
import { getPageByUrl, updateStatus } from "../notion/client.js";
import { fetchDigestReactions } from "../slack/reactions.js";

async function main(): Promise<void> {
  if (!process.argv.includes("--execute"))
    throw new Error("Usage: optional:reactions -- --execute (writes Notion reading Status)");
  if (
    !env.SLACK_BOT_TOKEN ||
    !env.SLACK_CHANNEL_ID ||
    !env.NOTION_API_KEY ||
    !env.NOTION_DATABASE_ID
  )
    throw new Error("Slack and Notion configuration required");
  const rank: Record<string, number> = { Unread: 0, Digested: 1, Read: 2, Starred: 3 };
  for (const { url, action } of await fetchDigestReactions()) {
    const page = await getPageByUrl(url);
    if (page && rank[page.status] !== undefined && (rank[action] ?? 0) > (rank[page.status] ?? 0))
      await updateStatus(page.pageId, action);
  }
  console.log("Reaction sync finished");
}
main().catch(() => {
  console.error("Optional reaction sync failed; check configuration and explicit execution flag");
  process.exitCode = 1;
});
