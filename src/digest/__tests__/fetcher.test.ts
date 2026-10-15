import { type Browser, chromium } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeBrowser, extractParagraphs, fetchArticle, fetchArticleBody } from "../fetcher.js";

afterEach(async () => {
  await closeBrowser();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

describe("safe body failure diagnostics", () => {
  it.each([
    [new Response("private challenge text", { status: 403 }), "http_error", 403],
    [
      new Response("binary", { headers: { "content-type": "application/pdf" } }),
      "unsupported_content_type",
      undefined,
    ],
    [
      new Response("<body>private error text</body>", { headers: { "content-type": "text/html" } }),
      "missing_article",
      undefined,
    ],
    [
      new Response("<main><p>tiny</p></main>", { headers: { "content-type": "text/html" } }),
      "empty_article",
      undefined,
    ],
  ])(
    "distinguishes response failure without retaining body: %s",
    async (response, reason, status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      expect(await fetchArticle("https://example.com/private?token=secret")).toEqual({
        paragraphs: [],
        failure: { stage: "body", transport: "http", reason, httpStatus: status },
      });
    }
  );
  it.each([
    ["TimeoutError", "timeout"],
    ["Error", "network_error"],
  ])("redacts %s exceptions", async (name, reason) => {
    const error = new Error("private request URL and credentials");
    error.name = name;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    expect((await fetchArticle("https://example.com")).failure).toMatchObject({ reason });
  });
  it("records browser HTTP 403 rather than attempting to bypass the challenge", async () => {
    const goto = vi.fn().mockResolvedValue({ ok: () => false, status: () => 403 });
    const content = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(chromium, "launch").mockResolvedValue({
      newPage: async () => ({ goto, content, close }),
      close,
    } as unknown as Browser);
    expect(await fetchArticle("https://openai.com/article")).toEqual({
      paragraphs: [],
      failure: { stage: "body", transport: "browser", reason: "http_error", httpStatus: 403 },
    });
    expect(goto).toHaveBeenCalledTimes(1);
    expect(content).not.toHaveBeenCalled();
  });
  it("redacts browser exception messages instead of logging them", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(chromium, "launch").mockRejectedValue(new Error("private URL / browser details"));
    expect((await fetchArticle("https://openai.com/article")).failure?.reason).toBe(
      "browser_error"
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
