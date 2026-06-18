import * as cheerio from "cheerio";
import { AI_KEYWORDS, GITHUB_TRENDING_CONFIG } from "../config.js";
import type { Article, Fetcher } from "../types.js";

/** A repository parsed from the GitHub Trending page. */
export interface TrendingRepo {
  /** "owner/repo" */
  fullName: string;
  url: string;
  description: string;
  language: string;
  /** Stars gained within the trending window (today / this week) — the crowd signal. */
  periodStars: number;
  /** Total stars (fallback crowd signal). */
  totalStars: number;
}

/** Parse a count like "1,234" or "371 stars today" into a number (0 if none). */
function parseStarCount(text: string): number {
  const match = text.replace(/,/g, "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

/**
 * Parse the GitHub Trending HTML into raw repos.
 * Exported for unit testing against a fixture (no network).
 */
export function parseTrendingHtml(html: string): TrendingRepo[] {
  const $ = cheerio.load(html);
  const repos: TrendingRepo[] = [];

  $("article.Box-row").each((_, el) => {
    const $r = $(el);
    const href = $r.find("h2 a").attr("href")?.trim() ?? "";
    if (!href) return;

    const fullName = href.replace(/^\//, "");
    const description = $r.find("p").first().text().trim();
    const language = $r.find("[itemprop=programmingLanguage]").text().trim();
    const totalStars = parseStarCount($r.find('a[href$="/stargazers"]').first().text());
    const periodStars = parseStarCount($r.find("span.float-sm-right").text());

    repos.push({
      fullName,
      url: `https://github.com${href}`,
      description,
      language,
      periodStars,
      totalStars,
    });
  });

  return repos;
}

/**
 * Decide whether a trending repo is AI-relevant: its name or description
 * matches one of the shared AI keywords. Exported for unit testing.
 */
export function isAiRepo(repo: TrendingRepo): boolean {
  const text = ` ${`${repo.fullName} ${repo.description}`.toLowerCase()} `;
  return AI_KEYWORDS.some((kw) =>
    kw.length <= 3 ? new RegExp(`\\b${kw}\\b`).test(text) : text.includes(kw)
  );
}

/** Map a trending repo to a normalized Article (crowd score = stars gained in the window). */
export function toArticle(repo: TrendingRepo): Article {
  return {
    title: repo.fullName,
    url: repo.url,
    source: "GitHub Trending",
    category: [],
    score: 0,
    summary: "",
    // The trending page exposes no per-repo publish date.
    publishedAt: null,
    fetchedAt: new Date(),
    abstract: repo.description.slice(0, 1000),
    // Stars gained in the window is the trending signal; fall back to total stars.
    crowdScore: repo.periodStars > 0 ? repo.periodStars : repo.totalStars,
  };
}

/** Build the trending URL for a language ("" = all languages). */
function trendingUrl(language: string): string {
  const path = language ? `/${encodeURIComponent(language)}` : "";
  return `${GITHUB_TRENDING_CONFIG.baseUrl}${path}?since=${GITHUB_TRENDING_CONFIG.since}`;
}

export const githubTrendingFetcher: Fetcher = {
  name: "GitHub Trending",

  async fetch(): Promise<Article[]> {
    const seen = new Set<string>();
    const articles: Article[] = [];

    for (const language of GITHUB_TRENDING_CONFIG.languages) {
      const url = trendingUrl(language);
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "AI-News-Collector/1.0 (github.com)" },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          console.warn(`[GitHub Trending] ${url} returned ${res.status}`);
          continue;
        }

        const repos = parseTrendingHtml(await res.text())
          .filter((r) => !seen.has(r.url) && isAiRepo(r))
          .slice(0, GITHUB_TRENDING_CONFIG.maxItems);

        for (const repo of repos) {
          seen.add(repo.url);
          articles.push(toArticle(repo));
        }
      } catch (err) {
        console.warn(`[GitHub Trending] ${url} failed:`, err);
      }
    }

    return articles;
  },
};
