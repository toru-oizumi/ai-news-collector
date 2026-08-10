import RSSParser from "rss-parser";
import { matchesKeyword } from "../pipeline/keywords.js";
import type { Article, Fetcher, RSSSourceConfig } from "../types.js";

const parser = new RSSParser({ timeout: 15_000 });

/** Key under which a configured `crowdField` is exposed on the parsed item. */
const CROWD_KEY = "crowdRaw";

/** Parsers keyed by crowd field — rss-parser needs customFields declared up front,
 *  so feeds carrying an extension element (e.g. hatena:bookmarkcount) get their own
 *  instance. Cached so we build one per distinct field, not one per fetch. */
const crowdParsers = new Map<string, RSSParser>();

function parserFor(config: RSSSourceConfig): RSSParser {
  if (!config.crowdField) return parser;

  const cached = crowdParsers.get(config.crowdField);
  if (cached) return cached;

  const created = new RSSParser({
    timeout: 15_000,
    customFields: { item: [[config.crowdField, CROWD_KEY]] },
  });
  crowdParsers.set(config.crowdField, created);
  return created;
}

/** Read the configured crowd field off a parsed item. RSS extension elements arrive
 *  as strings, so coerce and reject anything non-numeric. */
function parseCrowd(item: { [key: string]: unknown }): number | undefined {
  const raw = item[CROWD_KEY];
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** The subset of a parsed rss-parser item that the mapping reads. */
export interface RSSItemLike {
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  isoDate?: string;
  pubDate?: string;
  [key: string]: unknown;
}

/**
 * Map one parsed feed item to a normalized Article, or null if a configured filter
 * rejects it. Exported for unit testing — the network side lives in createRSSFetcher.
 */
export function mapItem(
  item: RSSItemLike,
  config: RSSSourceConfig,
  now = Date.now()
): Article | null {
  const title = item.title?.trim() ?? "";
  const url = item.link?.trim() ?? "";
  if (!title || !url) return null;

  // Keyword filter (if configured)
  if (config.keywords?.length) {
    const text = `${title} ${item.contentSnippet ?? ""}`;
    if (!matchesKeyword(text, config.keywords)) return null;
  }

  // Crowd-signal filter (if configured) — e.g. drop Hatena entries below N bookmarks.
  // An item missing the field is dropped: with `minCrowd` set we can't tell whether
  // it is genuinely unpopular or just unparsed, and keeping it would bypass the floor.
  const crowdScore = config.crowdField ? parseCrowd(item) : undefined;
  if (config.minCrowd !== undefined && (crowdScore === undefined || crowdScore < config.minCrowd)) {
    return null;
  }

  // `isoDate` is rss-parser's normalized date across RSS 2.0 / Atom / RDF.
  // RSS 1.0 feeds (Hatena) carry only dc:date and leave pubDate undefined,
  // so reading pubDate alone would null out every publishedAt on those feeds.
  const publishedAt = parseDate(item.isoDate ?? item.pubDate);

  // Freshness filter (if configured) — skip items older than maxAgeDays.
  // Items with no publish date are kept (we can't determine their age).
  if (config.maxAgeDays !== undefined && publishedAt) {
    const ageMs = now - publishedAt.getTime();
    if (ageMs > config.maxAgeDays * 24 * 60 * 60 * 1000) return null;
  }

  return {
    title,
    url: normalizeUrl(url),
    source: config.name,
    category: [],
    score: 0,
    summary: "",
    publishedAt,
    fetchedAt: new Date(),
    abstract: (item.contentSnippet ?? item.content ?? "").slice(0, 1000),
    ...(crowdScore !== undefined ? { crowdScore } : {}),
  };
}

export function createRSSFetcher(config: RSSSourceConfig): Fetcher {
  return {
    name: `RSS:${config.name}(${new URL(config.url).hostname})`,

    async fetch(): Promise<Article[]> {
      const feed = await parserFor(config).parseURL(config.url);
      const items = feed.items ?? [];

      return items
        .map((item) => mapItem(item as RSSItemLike, config))
        .filter((a): a is Article => a !== null);
    },
  };
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    // Remove common tracking params
    for (const p of ["utm_source", "utm_medium", "utm_campaign", "ref"]) {
      u.searchParams.delete(p);
    }
    return u.toString();
  } catch {
    return url;
  }
}
