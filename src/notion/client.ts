import { APIResponseError, Client } from "@notionhq/client";
import { SOURCE_META, env } from "../config.js";
import type { Article } from "../types.js";

const RETRY_DELAYS_MS = [5_000, 15_000, 30_000]; // 3 retries with backoff

/**
 * Whether an error is worth retrying: rate limits (429), server errors (5xx), and
 * transport/network failures. The latter covers the intermittent node-fetch
 * "Premature close" drops against api.notion.com that were failing whole runs (TOR-71) —
 * those surface as plain (non-APIResponseError) errors, so retry anything that isn't a
 * definitive 4xx from the API.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof APIResponseError) return err.status === 429 || err.status >= 500;
  return true;
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const hasRetry = attempt < RETRY_DELAYS_MS.length;
      if (hasRetry && isRetryable(err)) {
        const delay = RETRY_DELAYS_MS[attempt];
        const reason =
          err instanceof APIResponseError
            ? `HTTP ${err.status}`
            : err instanceof Error
              ? err.message
              : String(err);
        console.warn(`[Notion] "${label}" failed (${reason}) — retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  // unreachable, but satisfies TypeScript
  throw new Error("withRetry: exhausted retries");
}

// The @notionhq/client defaults to node-fetch@2, whose keep-alive sockets
// intermittently fail against api.notion.com with "Premature close" on Node 24.
// Inject the platform's native fetch (undici) instead — the same transport the
// Mistral/Slack calls use without issue. Type is derived from the constructor so
// we don't depend on the (unexported) ClientOptions type. See TOR-71.
type NotionFetch = NonNullable<NonNullable<ConstructorParameters<typeof Client>[0]>["fetch"]>;

let notion: Client;

function getClient(): Client {
  if (!notion) {
    notion = new Client({
      auth: env.NOTION_API_KEY,
      fetch: fetch as unknown as NotionFetch,
    });
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

// ── Read the whole database for the static site export (Phase B) ──

/** One row as published to the static site. Dates are ISO date strings (YYYY-MM-DD)
 *  because they cross a JSON boundary; the site parses them back with zod. */
export interface ExportedArticle {
  /** Notion page id — used as the Astro content collection entry id. */
  id: string;
  title: string;
  url: string;
  source: string;
  category: string[];
  score: number;
  summary: string;
  published: string | null;
  fetched: string | null;
  status: string;
  lang: string;
  kind: string;
  /** Notion page URL, so the site can link back to the editable record. */
  notionUrl: string;
}

/** Notion's query-result property union is very broad. These narrow shapes describe
 *  only what we read, matching the loose-cast approach used elsewhere in this file. */
interface RawProps {
  Title?: { title?: { plain_text?: string }[] };
  URL?: { url?: string | null };
  Source?: { select?: { name?: string } | null };
  Category?: { multi_select?: { name?: string }[] };
  Score?: { number?: number | null };
  Summary?: { rich_text?: { plain_text?: string }[] };
  Published?: { date?: { start?: string } | null };
  Fetched?: { date?: { start?: string } | null };
  Status?: { select?: { name?: string } | null };
  Lang?: { select?: { name?: string } | null };
  Kind?: { select?: { name?: string } | null };
}

function joinRichText(parts: { plain_text?: string }[] | undefined): string {
  // Notion splits long text into multiple rich-text chunks; reading only [0] would
  // truncate any summary that carries formatting or exceeds the chunk size.
  return (parts ?? []).map((p) => p.plain_text ?? "").join("");
}

function toExported(page: {
  id: string;
  properties: unknown;
  url?: string;
}): ExportedArticle | null {
  const props = page.properties as RawProps;

  const url = props.URL?.url ?? "";
  const title = joinRichText(props.Title?.title);
  // A row with no URL or title can't be rendered as a link — skip rather than
  // emit an entry the site would have to special-case.
  if (!url || !title) return null;

  const source = props.Source?.select?.name ?? "Unknown";
  // Rows collected before Lang/Kind existed have neither property. Deriving them from
  // the source name classifies the whole back catalogue correctly instead of labelling
  // 20k rows "English primary" — those rows are never re-collected (URL dedup), so
  // without this the site's language and tier filters would stay useless on all history.
  const meta = SOURCE_META[source as keyof typeof SOURCE_META];

  return {
    id: page.id,
    title,
    url,
    source,
    category: (props.Category?.multi_select ?? [])
      .map((c) => c.name ?? "")
      .filter((name) => name !== ""),
    score: props.Score?.number ?? 0,
    summary: joinRichText(props.Summary?.rich_text),
    published: props.Published?.date?.start ?? null,
    fetched: props.Fetched?.date?.start ?? null,
    status: props.Status?.select?.name ?? "Unread",
    lang: props.Lang?.select?.name ?? meta?.lang ?? "en",
    kind: props.Kind?.select?.name ?? meta?.kind ?? "primary",
    notionUrl: page.url ?? "",
  };
}

/**
 * Read every row in the database, newest first, for the static site export.
 *
 * Cursor pagination alone is not enough: `databases.query` stops returning results
 * after ~10,000 rows in a single cursor chain — `has_more` simply goes false, so a
 * naive do/while loop silently truncates the oldest history (observed: 10,000 rows
 * returned while the database held two further months). So we walk backwards in time
 * instead, re-anchoring the query with a `Fetched on_or_before` bound each time a
 * chain ends, and stop when a window yields nothing new.
 *
 * Properties only — the digest lives in the page body and fetching blocks would cost
 * one request per row.
 */
export async function getAllArticles(): Promise<ExportedArticle[]> {
  const client = getClient();
  const byId = new Map<string, ExportedArticle>();
  let before: string | undefined;
  let requests = 0;

  for (;;) {
    const sizeBeforeWindow = byId.size;
    let oldestSeen: string | undefined;
    let cursor: string | undefined;

    do {
      const res = await withRetry(
        () =>
          client.databases.query({
            database_id: env.NOTION_DATABASE_ID,
            start_cursor: cursor,
            page_size: 100,
            filter: {
              and: [
                { property: "URL", url: { is_not_empty: true } },
                // `on_or_before` (not `before`) so rows sharing the boundary date are
                // not skipped; the id map removes the resulting overlap.
                ...(before ? [{ property: "Fetched", date: { on_or_before: before } }] : []),
              ],
            },
            sorts: [{ property: "Fetched", direction: "descending" }],
          }),
        "databases.query(export)"
      );
      requests++;

      for (const page of res.results) {
        if (!("properties" in page)) continue;
        const article = toExported(page);
        if (!article) continue;
        byId.set(article.id, article);
        if (article.fetched && (!oldestSeen || article.fetched < oldestSeen)) {
          oldestSeen = article.fetched;
        }
      }

      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    } while (cursor);

    // Nothing new in this window: either we've reached the end of the database, or
    // a single Fetched date holds more rows than one chain can return. Either way,
    // advancing the bound again would loop forever.
    if (byId.size === sizeBeforeWindow || !oldestSeen) break;
    before = oldestSeen;
  }

  const articles = [...byId.values()];
  console.log(`[Notion] Exported ${articles.length} articles across ${requests} request(s)`);
  return articles;
}

// ── Look up a page by URL / update its Status (Phase 5B reaction sync) ──

export interface NotionPageRef {
  pageId: string;
  /** Current Status select name (e.g. "Unread", "Digested", "Read", "Starred"), or "" if unset. */
  status: string;
}

/** Find the page whose URL property exactly matches `url`. Returns null if none. */
export async function getPageByUrl(url: string): Promise<NotionPageRef | null> {
  const client = getClient();
  const res = await withRetry(
    () =>
      client.databases.query({
        database_id: env.NOTION_DATABASE_ID,
        page_size: 1,
        filter: { property: "URL", url: { equals: url } },
      }),
    "databases.query(byUrl)"
  );

  const page = res.results[0];
  if (!page || !("properties" in page)) return null;

  // The query-result property union is broad; read the select name via a narrow cast
  // (same loose-typing approach as digest-main.ts).
  const statusProp = page.properties.Status as { select?: { name?: string } | null } | undefined;
  return { pageId: page.id, status: statusProp?.select?.name ?? "" };
}

/** Set a page's Status select. */
export async function updateStatus(pageId: string, status: string): Promise<void> {
  const client = getClient();
  await withRetry(
    () =>
      client.pages.update({
        page_id: pageId,
        properties: { Status: { select: { name: status } } },
      }),
    "pages.update(status)"
  );
  // Notion rate limit: 3 req/sec
  await new Promise((r) => setTimeout(r, 350));
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
            // Set by the scorer from SOURCE_META. Omitted rather than sent as null when
            // absent, so a DB without these properties keeps working unchanged.
            ...(article.lang ? { Lang: { select: { name: article.lang } } } : {}),
            ...(article.kind ? { Kind: { select: { name: article.kind } } } : {}),
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
