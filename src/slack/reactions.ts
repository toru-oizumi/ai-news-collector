import { SLACK_CONFIG, env } from "../config.js";

/** Notion Status an article can be advanced to based on a Slack reaction. */
export type ArticleAction = "Read" | "Starred";

/** One resolved reaction: an article URL and the action its reactions imply. */
export interface ReactionResult {
  url: string;
  action: ArticleAction;
}

interface SlackMessage {
  text?: string;
  ts?: string;
  reply_count?: number;
  reactions?: { name: string; count: number }[];
}

interface SlackListResponse {
  ok: boolean;
  messages?: SlackMessage[];
  error?: string;
}

/**
 * Map the reaction shortcodes present on a message to an article action.
 * "Starred" takes precedence over "Read". Returns null when no known emoji is present.
 * Exported for unit testing.
 */
export function reactionsToStatus(names: string[]): ArticleAction | null {
  const set = new Set(names);
  if (SLACK_CONFIG.reactions.starred.some((n) => set.has(n))) return "Starred";
  if (SLACK_CONFIG.reactions.read.some((n) => set.has(n))) return "Read";
  return null;
}

/**
 * Extract the article URL from a reply's mrkdwn text. The article link is the first
 * `<url|title>` in the message (see buildArticleReplyBlocks). Exported for unit testing.
 */
export function extractArticleUrl(text: string): string | null {
  const m = text.match(/<(https?:\/\/[^|>]+)\|/);
  return m ? m[1] : null;
}

async function slackGet(url: string, params: Record<string, string>): Promise<SlackListResponse> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}?${qs}`, {
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
    signal: AbortSignal.timeout(15_000),
  });
  return (await res.json()) as SlackListResponse;
}

/**
 * Scan recent channel history for our digest parents, read each thread's per-article
 * replies, and resolve the reactions on them into {url, action} pairs.
 * Best-effort: returns [] on any failure or when Slack env vars are unset.
 */
export async function fetchDigestReactions(): Promise<ReactionResult[]> {
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_CHANNEL_ID) return [];

  try {
    const oldest = Math.floor(
      (Date.now() - SLACK_CONFIG.reactionLookbackDays * 86_400_000) / 1000
    ).toString();

    const history = await slackGet(SLACK_CONFIG.historyUrl, {
      channel: env.SLACK_CHANNEL_ID,
      oldest,
      limit: "200",
    });
    if (!history.ok) {
      console.warn(`[Slack] conversations.history failed: ${history.error ?? "unknown"}`);
      return [];
    }

    // Our digest parents: their fallback text starts with the known prefix and they have replies.
    const parents = (history.messages ?? []).filter(
      (m) =>
        m.ts && (m.reply_count ?? 0) > 0 && (m.text ?? "").startsWith(SLACK_CONFIG.parentTextPrefix)
    );

    // Resolve per-URL, keeping the strongest action (Starred beats Read).
    const byUrl = new Map<string, ArticleAction>();

    for (const parent of parents) {
      const replies = await slackGet(SLACK_CONFIG.repliesUrl, {
        channel: env.SLACK_CHANNEL_ID,
        ts: parent.ts as string,
        limit: "200",
      });
      if (!replies.ok) continue;

      for (const msg of replies.messages ?? []) {
        if (!msg.reactions || msg.reactions.length === 0 || !msg.text) continue;
        const url = extractArticleUrl(msg.text);
        if (!url) continue;
        const action = reactionsToStatus(msg.reactions.map((r) => r.name));
        if (!action) continue;

        // Starred always wins; otherwise set Read only if nothing recorded yet.
        if (action === "Starred" || !byUrl.has(url)) byUrl.set(url, action);
      }
    }

    return Array.from(byUrl, ([url, action]) => ({ url, action }));
  } catch (err) {
    console.warn("[Slack] fetchDigestReactions failed:", err);
    return [];
  }
}
