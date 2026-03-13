import { APIResponseError, type Client } from "@notionhq/client";
import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints.js";

const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err instanceof APIResponseError && err.status === 429;
      const hasRetry = attempt < RETRY_DELAYS_MS.length;
      if (isRateLimit && hasRetry) {
        const delay = RETRY_DELAYS_MS[attempt];
        console.warn(`[NotionWriter] Rate limited — retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("withRetry: exhausted retries");
}

/**
 * Append Digest + full Japanese translation to a Notion page body.
 * If the page already has content, new blocks are appended at the end.
 */
export async function writeDigestToPage(
  notion: Client,
  pageId: string,
  digest: string,
  keyPoints: string[],
  translatedParagraphs: string[]
): Promise<void> {
  const blocks: BlockObjectRequest[] = [];

  // ── Digest section ──
  blocks.push({
    object: "block",
    type: "heading_2",
    heading_2: {
      rich_text: [{ type: "text", text: { content: "📝 Digest" } }],
    },
  });

  for (const chunk of splitText(digest, 2000)) {
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: chunk } }],
      },
    });
  }

  // Key Points
  blocks.push({
    object: "block",
    type: "heading_3",
    heading_3: {
      rich_text: [{ type: "text", text: { content: "■ Key Points" } }],
    },
  });

  for (const point of keyPoints) {
    blocks.push({
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [{ type: "text", text: { content: point.slice(0, 2000) } }],
      },
    });
  }

  // Divider
  blocks.push({
    object: "block",
    type: "divider",
    divider: {},
  });

  // ── Full Japanese translation section ──
  if (translatedParagraphs.length > 0) {
    blocks.push({
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: "🇯🇵 日本語全文訳" } }],
      },
    });

    for (const para of translatedParagraphs) {
      for (const chunk of splitText(para, 2000)) {
        blocks.push({
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: chunk } }],
          },
        });
      }
    }
  }

  // Notion API allows max 100 blocks per append call — split into chunks if needed
  for (let i = 0; i < blocks.length; i += 100) {
    const chunk = blocks.slice(i, i + 100);
    await withRetry(() =>
      notion.blocks.children.append({
        block_id: pageId,
        children: chunk,
      })
    );
    // Notion rate limit: 3 req/sec
    if (i + 100 < blocks.length) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }
}

/** Split text into chunks of at most maxLen characters */
function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }
  return chunks;
}
