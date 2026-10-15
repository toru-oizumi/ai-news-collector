import * as cheerio from "cheerio";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import type { BodyFailure, BodyFetchResult } from "./failures.js";

/**
 * Domains that require a headless browser (JS-rendered content).
 * Add new domains here when cheerio-based fetch returns empty body.
 * Note: headless fetches share a single browser instance (see getBrowser/closeBrowser).
 */
const HEADLESS_DOMAINS = ["openai.com"];

// Module-level browser instance, lazily initialized and reused across calls.
let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!_browser) {
    _browser = await chromium.launch({ headless: true, timeout: 15_000 });
  }
  return _browser;
}

/** Close the shared headless browser. Call once after all fetches are complete. */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

function needsHeadless(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return HEADLESS_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * Fetch article body text from URL.
 * Uses a headless browser for known JS-rendered sites, cheerio otherwise.
 * Returns plain text paragraphs array.
 */
export async function fetchArticleBody(url: string, maxChars = 12000): Promise<string[]> {
  return (await fetchArticle(url, maxChars)).paragraphs;
}

export async function fetchArticle(url: string, maxChars = 12000): Promise<BodyFetchResult> {
  if (needsHeadless(url)) {
    return fetchWithHeadless(url, maxChars);
  }
  return fetchWithCheerio(url, maxChars);
}

const failed = (
  transport: BodyFailure["transport"],
  reason: BodyFailure["reason"],
  httpStatus?: number
): BodyFetchResult => ({
  paragraphs: [],
  failure: { stage: "body", transport, reason, httpStatus },
});

function extractResult(
  html: string,
  maxChars: number,
  transport: BodyFailure["transport"]
): BodyFetchResult {
  const $ = cheerio.load(html);
  if (!$("article, main, [role=main]").length) return failed(transport, "missing_article");
  const paragraphs = extractParagraphs(html, maxChars);
  return paragraphs.length ? { paragraphs } : failed(transport, "empty_article");
}

async function fetchWithHeadless(url: string, maxChars: number): Promise<BodyFetchResult> {
  let page: Page | undefined;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    // Use "domcontentloaded" instead of "networkidle" — SPAs with background
    // requests can keep network busy indefinitely, causing consistent timeouts.
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    if (!response) return failed("browser", "network_error");
    if (!response.ok()) return failed("browser", "http_error", response.status());
    const contentType = response.headers()["content-type"] ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain"))
      return failed("browser", "unsupported_content_type");
    const html = await page.content();
    return extractResult(html, maxChars, "browser");
  } catch (err) {
    return failed(
      "browser",
      err instanceof Error && err.name === "TimeoutError" ? "timeout" : "browser_error"
    );
  } finally {
    await page?.close().catch(() => undefined);
  }
}

async function fetchWithCheerio(url: string, maxChars: number): Promise<BodyFetchResult> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "AI-News-Collector/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });

    if (!res.ok) return failed("http", "http_error", res.status);

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return failed("http", "unsupported_content_type");
    }

    const html = await res.text();
    return extractResult(html, maxChars, "http");
  } catch (err) {
    return failed(
      "http",
      err instanceof Error && ["TimeoutError", "AbortError"].includes(err.name)
        ? "timeout"
        : "network_error"
    );
  }
}

export function extractParagraphs(html: string, maxChars: number): string[] {
  const $ = cheerio.load(html);

  $("script, style, nav, header, footer, aside, iframe, noscript, .ad, .sidebar").remove();

  // Generic body fallback mixes navigation/related posts with the article. Abstain
  // when a page has no recognizable main content instead of inventing a summary.
  const target =
    $("article").first().length > 0 ? $("article").first() : $("main, [role=main]").first();

  const paragraphs: string[] = [];
  let totalChars = 0;

  target.find("p, h1, h2, h3, h4, h5, h6, li").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length < 10) return;
    if (totalChars + text.length > maxChars) return false;
    paragraphs.push(text);
    totalChars += text.length;
  });

  return paragraphs;
}
