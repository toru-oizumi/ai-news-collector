import * as cheerio from "cheerio";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

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
    _browser = await chromium.launch({ headless: true });
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
  if (needsHeadless(url)) {
    return fetchWithHeadless(url, maxChars);
  }
  return fetchWithCheerio(url, maxChars);
}

async function fetchWithHeadless(url: string, maxChars: number): Promise<string[]> {
  let page: Page | undefined;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    // Use "domcontentloaded" instead of "networkidle" — SPAs with background
    // requests can keep network busy indefinitely, causing consistent timeouts.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const html = await page.content();
    return extractParagraphs(html, maxChars);
  } catch (err) {
    console.warn(
      `[Fetcher] Headless fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  } finally {
    await page?.close();
  }
}

async function fetchWithCheerio(url: string, maxChars: number): Promise<string[]> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "AI-News-Collector/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });

    if (!res.ok) return [];

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return [];
    }

    const html = await res.text();
    return extractParagraphs(html, maxChars);
  } catch {
    return [];
  }
}

function extractParagraphs(html: string, maxChars: number): string[] {
  const $ = cheerio.load(html);

  $("script, style, nav, header, footer, aside, iframe, noscript, .ad, .sidebar").remove();

  const target = $("article").length > 0 ? $("article") : $("body");

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
