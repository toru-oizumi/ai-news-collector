import * as cheerio from "cheerio";
import { ANTHROPIC_URLS } from "../config.js";
import type { Article, Fetcher } from "../types.js";

export const anthropicFetcher: Fetcher = {
  name: "Anthropic",

  async fetch(): Promise<Article[]> {
    const articles: Article[] = [];

    for (const pageUrl of ANTHROPIC_URLS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);

        let html: string;
        try {
          const res = await fetch(pageUrl, {
            headers: { "User-Agent": "AI-News-Collector/1.0 (github.com)" },
            signal: controller.signal,
          });
          if (!res.ok) {
            console.warn(`[Anthropic] ${pageUrl} returned ${res.status}`);
            continue;
          }
          html = await res.text();
        } finally {
          clearTimeout(timer);
        }
        const $ = cheerio.load(html);

        // Anthropic uses <a> tags with href starting with /news/ or /engineering/ or /research/
        // The actual selectors may change — this is a best-effort parse
        $("a[href]").each((_, el) => {
          const href = $(el).attr("href") ?? "";
          // Match blog post links (not nav links, not anchors)
          if (!href.match(/^\/(news|engineering|research)\/.+/)) return;

          const fullUrl = new URL(href, "https://www.anthropic.com").toString();

          // Try to extract title from the link text or nearest heading
          let title = $(el).find("h2, h3, h4").first().text().trim();
          if (!title) title = $(el).text().trim();
          // Skip nav-like short text
          if (!title || title.length < 10) return;
          // Skip duplicates within this run
          if (articles.some((a) => a.url === fullUrl)) return;

          // Try to find a date or description nearby
          const parent = $(el).closest("div, article, li");
          const description = parent.find("p").first().text().trim().slice(0, 500);
          const dateText = parent.find("time").attr("datetime") ?? "";

          articles.push({
            title,
            url: fullUrl,
            source: "Anthropic",
            category: [],
            score: 0,
            summary: "",
            publishedAt: dateText ? new Date(dateText) : null,
            fetchedAt: new Date(),
            abstract: description,
          });
        });
      } catch (err) {
        console.warn(`[Anthropic] Failed to fetch ${pageUrl}:`, err);
      }
    }

    return articles;
  },
};
