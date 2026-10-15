import { afterEach, describe, expect, it, vi } from "vitest";
import { extractParagraphs, fetchArticleBody } from "../fetcher.js";

afterEach(() => vi.unstubAllGlobals());

describe("article extraction", () => {
  it("ignores navigation, related sidebars and footer text", () => {
    const html =
      "<nav>AI benchmark results</nav><article><h1>Northern Gannet</h1><p>A seabird was observed near the coast.</p><aside><p>LLM evaluation results</p></aside></article><footer><p>machine learning</p></footer>";
    expect(extractParagraphs(html, 6000)).toEqual([
      "Northern Gannet",
      "A seabird was observed near the coast.",
    ]);
  });
  it("does not mistake a login/error page body for article evidence", () => {
    expect(
      extractParagraphs(
        "<body><h1>Access denied</h1><p>Please sign in to view this article.</p></body>",
        6000
      )
    ).toEqual([]);
  });
  it("abstains on HTTP errors and non-HTML content", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<article><p>Not found article</p></article>", { status: 404 })
      )
      .mockResolvedValueOnce(
        new Response("binary", { headers: { "content-type": "application/pdf" } })
      );
    vi.stubGlobal("fetch", fetch);
    expect(await fetchArticleBody("https://example.com/missing")).toEqual([]);
    expect(await fetchArticleBody("https://example.com/file.pdf")).toEqual([]);
  });
});
