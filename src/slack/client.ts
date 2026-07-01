import { SLACK_CONFIG, env } from "../config.js";
import type { Article } from "../types.js";

/** A Slack Block Kit block. Loosely typed — we only build a few known shapes. */
export type SlackBlock = Record<string, unknown>;

interface SlackPostResponse {
  ok: boolean;
  ts?: string;
  error?: string;
}

/** Escape the characters Slack treats specially in mrkdwn text: &, <, >. */
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Build the parent digest message: a header + a context line summarizing the count.
 * Each article is posted separately as a threaded reply (see buildArticleReplyBlocks)
 * so reactions can be attributed to individual articles (Phase 5A). Exported for testing.
 */
export function buildDigestHeaderBlocks(
  dateLabel: string,
  shown: number,
  total: number
): SlackBlock[] {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: `🗞️ AI News Digest — ${dateLabel}`, emoji: true },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            total > shown
              ? `本日の新着 ${total} 件から上位 ${shown} 件（各記事はスレッドに投稿）`
              : `本日の新着 ${shown} 件（各記事はスレッドに投稿）`,
        },
      ],
    },
  ];
}

/**
 * Build the Block Kit for a single article, posted as one threaded reply.
 * The leading `<url|title>` link is the article URL — the reaction sync (Phase 5B)
 * parses it back out to match the reaction to a Notion page. Exported for testing.
 */
export function buildArticleReplyBlocks(article: Article): SlackBlock[] {
  const cats = article.category.length > 0 ? article.category.join(" / ") : "—";
  const body = article.summary?.trim() || article.abstract.trim().slice(0, 160) || "(要約なし)";
  const notionLink = article.notionUrl ? ` · <${article.notionUrl}|Notion>` : "";
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*<${article.url}|${escapeMrkdwn(article.title)}>*\n\`${article.source}\` · score ${article.score} · ${cats}${notionLink}\n${escapeMrkdwn(body)}`,
      },
    },
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Post a single chat.postMessage. Returns the parsed response (best-effort — never throws). */
async function postMessage(payload: Record<string, unknown>): Promise<SlackPostResponse> {
  try {
    const res = await fetch(SLACK_CONFIG.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    // chat.postMessage returns HTTP 200 even on logical errors — check the `ok` field.
    return (await res.json()) as SlackPostResponse;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Post a digest to Slack: one parent message, then one threaded reply per article.
 * Threading keeps the channel quiet while letting reactions land on individual
 * articles (consumed by the Phase 5B reaction sync).
 * No-op (returns false) when Slack env vars are unset or there are no articles.
 * Best-effort: logs and returns false on failure — never throws.
 */
export async function postSlackDigest(articles: Article[], total: number): Promise<boolean> {
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_CHANNEL_ID) return false;
  if (articles.length === 0) return false;

  const top = articles.slice(0, SLACK_CONFIG.topN);
  const dateLabel = new Date().toISOString().slice(0, 10);

  // 1. Parent message. Its fallback text starts with parentTextPrefix so the reaction
  //    sync can recognize our own digests when scanning channel history.
  const parent = await postMessage({
    channel: env.SLACK_CHANNEL_ID,
    text: `${SLACK_CONFIG.parentTextPrefix} — ${dateLabel}: 新着 ${total} 件`,
    blocks: buildDigestHeaderBlocks(dateLabel, top.length, total),
    unfurl_links: false,
  });

  if (!parent.ok || !parent.ts) {
    console.warn(`[Slack] Parent digest post failed: ${parent.error ?? "no ts returned"}`);
    return false;
  }

  // 2. One threaded reply per article.
  let posted = 0;
  for (const a of top) {
    const reply = await postMessage({
      channel: env.SLACK_CHANNEL_ID,
      thread_ts: parent.ts,
      text: a.title, // fallback text for notifications / accessibility
      blocks: buildArticleReplyBlocks(a),
      unfurl_links: false,
    });
    if (reply.ok) posted++;
    else console.warn(`[Slack] Article reply failed for "${a.title.slice(0, 40)}": ${reply.error}`);
    await sleep(SLACK_CONFIG.replyDelayMs);
  }

  console.log(`  Slack digest: parent + ${posted}/${top.length} article replies`);
  return true;
}
