import { APIResponseError, Client } from "@notionhq/client";
import { env } from "../config.js";
import type { Article } from "../types.js";

const RETRY_DELAYS_MS = [5_000, 15_000, 30_000]; // 3 retries with backoff

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err instanceof APIResponseError && err.status === 429;
      const hasRetry = attempt < RETRY_DELAYS_MS.length;

      if (isRateLimit && hasRetry) {
        const delay = RETRY_DELAYS_MS[attempt];
        console.warn(`[Notion] Rate limited on "${label}" — retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  // unreachable, but satisfies TypeScript
  throw new Error("withRetry: exhausted retries");
}

let notion: Client;

function getClient(): Client {
  if (!notion) {
    notion = new Client({ auth: env.NOTION_API_KEY });
  }
  return notion;
}

// ── Check existing URLs in DB for dedup ──

export async function getExistingUrls(): Promise<Set<string>> {
  const client = getClient();
  const urls = new Set<string>();
  let cursor: string | undefined;

  // Paginate through all pages to collect URLs
  // Notion API returns 100 results per page
  do {
    const res = await withRetry(
      () =>
        client.databases.query({
          database_id: env.NOTION_DATABASE_ID,
          start_cursor: cursor,
          page_size: 100,
          filter: {
            property: "URL",
            url: { is_not_empty: true },
          },
        }),
      "databases.query"
    );

    for (const page of res.results) {
      if ("properties" in page) {
        const urlProp = page.properties.URL;
        if (urlProp?.type === "url" && typeof urlProp.url === "string") {
          urls.add(urlProp.url);
        }
      }
    }

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return urls;
}

// ── Push a single article to Notion ──

export async function pushOneToNotion(article: Article): Promise<string | null> {
  const client = getClient();
  try {
    const page = await withRetry(
      () =>
        client.pages.create({
          parent: { database_id: env.NOTION_DATABASE_ID },
          properties: {
            Title: {
              title: [{ text: { content: article.title.slice(0, 200) } }],
            },
            URL: {
              url: article.url,
            },
            Source: {
              select: { name: article.source },
            },
            Category: {
              multi_select: article.category.map((c) => ({ name: c })),
            },
            Score: {
              number: article.score,
            },
            Summary: {
              rich_text: [{ text: { content: article.summary.slice(0, 2000) } }],
            },
            Published: article.publishedAt
              ? { date: { start: article.publishedAt.toISOString().split("T")[0] } }
              : { date: null },
            Fetched: {
              date: { start: article.fetchedAt.toISOString().split("T")[0] },
            },
            Status: {
              select: { name: "Unread" },
            },
          },
        }),
      article.title
    );
    // Notion rate limit: 3 requests/sec → ~340ms between requests
    await new Promise((r) => setTimeout(r, 350));
    // `pages.create` returns a full page object (with `url`) for integration tokens;
    // fall back to the empty string if the field is somehow absent so the push still counts.
    return "url" in page ? page.url : "";
  } catch (err) {
    console.warn(`[Notion] Failed to create page for "${article.title}":`, err);
    return null;
  }
}
