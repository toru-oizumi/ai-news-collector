import * as cheerio from "cheerio";

/**
 * Fetch article body text from URL.
 * Returns plain text paragraphs array.
 */
export async function fetchArticleBody(url: string, maxChars = 12000): Promise<string[]> {
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
  } catch {
    return [];
  }
}
