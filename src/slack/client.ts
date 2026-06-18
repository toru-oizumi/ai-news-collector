import { SLACK_CONFIG, env } from "../config.js";
import type { Article } from "../types.js";

/** A Slack Block Kit block. Loosely typed — we only build a few known shapes. */
export type SlackBlock = Record<string, unknown>;

interface SlackPostResponse {
  ok: boolean;
  error?: string;
}

/** Escape the characters Slack treats specially in mrkdwn text: &, <, >. */
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Build the Block Kit payload for a digest of the given articles.
 * `total` is the full count of new articles (the digest shows the top `articles.length`).
 * Exported for unit testing (no network).
 */
export function buildDigestBlocks(
  articles: Article[],
  dateLabel: string,
  total: number
): SlackBlock[] {
  const blocks: SlackBlock[] = [
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
            total > articles.length
              ? `本日の新着 ${total} 件から上位 ${articles.length} 件`
              : `本日の新着 ${articles.length} 件`,
        },
      ],
    },
    { type: "divider" },
  ];

  for (const a of articles) {
    const cats = a.category.length > 0 ? a.category.join(" / ") : "—";
    const body = a.summary?.trim() || a.abstract.trim().slice(0, 160) || "(要約なし)";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*<${a.url}|${escapeMrkdwn(a.title)}>*\n\`${a.source}\` · score ${a.score} · ${cats}\n${escapeMrkdwn(body)}`,
      },
    });
  }

  return blocks;
}

/**
 * Post a digest of the given articles to Slack via chat.postMessage.
 * No-op (returns false) when Slack env vars are unset or there are no articles.
 * Best-effort: logs and returns false on failure — never throws.
 */
export async function postSlackDigest(articles: Article[], total: number): Promise<boolean> {
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_CHANNEL_ID) return false;
  if (articles.length === 0) return false;

  const top = articles.slice(0, SLACK_CONFIG.topN);
  const dateLabel = new Date().toISOString().slice(0, 10);
  const blocks = buildDigestBlocks(top, dateLabel, total);
  const text = `AI News Digest — ${dateLabel}: 新着 ${total} 件`;

  try {
    const res = await fetch(SLACK_CONFIG.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: env.SLACK_CHANNEL_ID,
        text, // fallback text for notifications / accessibility
        blocks,
        unfurl_links: false, // keep the digest compact — no per-link previews
      }),
      signal: AbortSignal.timeout(15_000),
    });

    // chat.postMessage returns HTTP 200 even on logical errors — check the `ok` field.
    const data = (await res.json()) as SlackPostResponse;
    if (!data.ok) {
      console.warn(`[Slack] postMessage failed: ${data.error ?? "unknown error"}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[Slack] Failed to post digest:", err);
    return false;
  }
}
