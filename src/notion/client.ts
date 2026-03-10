import { Client } from "@notionhq/client";
import { env } from "../config.js";
import type { Article } from "../types.js";

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
    const res = await client.databases.query({
      database_id: env.NOTION_DATABASE_ID,
      start_cursor: cursor,
      page_size: 100,
      filter: {
        property: "URL",
        url: { is_not_empty: true },
      },
    });

    for (const page of res.results) {
      if ("properties" in page) {
        const urlProp = page.properties.URL;
        if (urlProp?.type === "url" && urlProp.url) {
          urls.add(urlProp.url);
        }
      }
    }

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return urls;
}

// ── Push articles to Notion ──

export async function pushToNotion(
  articles: Article[]
): Promise<{ created: number; skipped: number }> {
  const client = getClient();
  let created = 0;
  let skipped = 0;

  // Process in batches to respect Notion API rate limits (3 req/sec)
  for (const article of articles) {
    try {
      await client.pages.create({
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
      });
      created++;
    } catch (err) {
      console.warn(`[Notion] Failed to create page for "${article.title}":`, err);
      skipped++;
    }

    // Notion rate limit: 3 requests/sec → ~340ms between requests
    await new Promise((r) => setTimeout(r, 350));
  }

  return { created, skipped };
}
