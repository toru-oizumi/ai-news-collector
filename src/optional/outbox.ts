import { createHash } from "node:crypto";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import {
  type SlackPostResponse,
  buildArticleReplyBlocks,
  buildArticleReplyText,
  buildDigestHeaderBlocks,
} from "../slack/client.js";
import type { Article } from "../types.js";

interface Delivery {
  state: "pending" | "sending" | "sent" | "failed" | "uncertain";
  ts?: string;
}
export interface Outbox {
  version: 1;
  id: string;
  channel: string;
  date: string;
  articles: Article[];
  parent: Delivery;
  replies: Delivery[];
}

export function prepareOutbox(articles: Article[], channel: string, date: string): Outbox {
  if (!channel || !articles.length)
    throw new Error("A channel and at least one article are required");
  const top = [...new Map(articles.map((article) => [article.url, article])).values()].slice(0, 10);
  return {
    version: 1,
    id: createHash("sha256")
      .update(JSON.stringify([channel, date, top.map((a) => a.url)]))
      .digest("hex"),
    channel,
    date,
    articles: top,
    parent: { state: "pending" },
    replies: top.map(() => ({ state: "pending" })),
  };
}

export async function writeOutbox(path: string, outbox: Outbox): Promise<void> {
  await writeFile(`${path}.tmp`, JSON.stringify(outbox, null, 2), "utf8");
  await rename(`${path}.tmp`, path);
}

export async function readOutbox(path: string): Promise<Outbox> {
  const box = JSON.parse(await readFile(path, "utf8")) as Outbox;
  if (
    box.version !== 1 ||
    !box.channel ||
    !Array.isArray(box.articles) ||
    box.articles.length > 10 ||
    box.replies?.length !== box.articles.length
  )
    throw new Error("Invalid outbox");
  const allowed = ["pending", "sending", "sent", "failed", "uncertain"];
  if (
    [box.parent, ...box.replies].some(
      (entry) =>
        !entry ||
        !allowed.includes(entry.state) ||
        (entry.state === "sent" && (typeof entry.ts !== "string" || !entry.ts))
    )
  )
    throw new Error("Invalid outbox delivery state");
  return box;
}

/** Local ledger must be kept across retries. A sending/uncertain entry needs manual
 * reconciliation with Slack history; it is never automatically sent again. */
export async function deliverOutbox(
  box: Outbox,
  deps: {
    checkpoint: (box: Outbox) => Promise<void>;
    send: (payload: Record<string, unknown>) => Promise<SlackPostResponse>;
    wait: () => Promise<void>;
  }
): Promise<void> {
  const deliveries = [box.parent, ...box.replies];
  if (deliveries.some((entry) => ["sending", "uncertain"].includes(entry.state)))
    throw new Error("Delivery outcome unknown; reconcile Slack history before retrying");
  const send = async (entry: Delivery, payload: Record<string, unknown>) => {
    if (entry.state === "sent") return;
    entry.state = "sending";
    await deps.checkpoint(box); // intent is durable BEFORE the external effect
    let response: SlackPostResponse;
    try {
      response = await deps.send(payload);
    } catch {
      response = { ok: false, uncertain: true };
    }
    if (response.ok === true && typeof response.ts === "string" && response.ts) {
      entry.state = "sent";
      entry.ts = response.ts;
    } else
      entry.state = response.ok === false && response.rejected === true ? "failed" : "uncertain";
    await deps.checkpoint(box);
    if (entry.state !== "sent")
      throw new Error(`Slack delivery ${entry.state}; checkpoint retained`);
    await deps.wait();
  };
  await send(box.parent, {
    channel: box.channel,
    text: `AI News Digest — ${box.date}: ${box.articles.length} 件`,
    blocks: buildDigestHeaderBlocks(box.date, box.articles.length, box.articles.length),
    unfurl_links: false,
  });
  if (!box.parent.ts) throw new Error("Parent timestamp missing");
  for (const [index, article] of box.articles.entries()) {
    await send(box.replies[index], {
      channel: box.channel,
      thread_ts: box.parent.ts,
      text: buildArticleReplyText(article),
      blocks: buildArticleReplyBlocks(article),
      unfurl_links: false,
    });
  }
}

/** Exclusion between local CLI processes; a stale lock requires manual reconciliation. */
export async function withOutboxLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  const lock = await open(`${path}.lock`, "wx");
  try {
    return await action();
  } finally {
    await lock.close();
    await unlink(`${path}.lock`);
  }
}
