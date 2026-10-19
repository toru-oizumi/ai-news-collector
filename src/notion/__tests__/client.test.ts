import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "../../types.js";

const api = vi.hoisted(() => ({ query: vi.fn(), create: vi.fn() }));
vi.mock("@notionhq/client", () => ({
  APIResponseError: class extends Error {},
  Client: class {
    databases = { query: api.query };
    pages = { create: api.create };
  },
}));
const article: Article = {
  title: "Model release",
  url: "https://example.com/article",
  source: "OpenAI",
  category: [],
  score: 50,
  summary: "",
  publishedAt: null,
  fetchedAt: new Date(0),
  abstract: "Original feed excerpt",
};

beforeEach(() => {
  vi.resetModules();
  api.query.mockReset();
  api.create.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("idempotent Notion persistence", () => {
  it("fails closed when the URL lookup fails", async () => {
    api.query.mockRejectedValue(new Error("network unavailable"));
    const { pushOneToNotion } = await import("../client.js");
    expect(await pushOneToNotion(article)).toBeNull();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("reconciles a create committed before its response was lost, without a second create", async () => {
    api.query.mockResolvedValueOnce({ results: [] }).mockResolvedValueOnce({
      results: [{ id: "0123456789abcdef0123456789abcdef", properties: {} }],
    });
    api.create.mockRejectedValue(new Error("response lost AFTER commit"));
    const { pushOneToNotion } = await import("../client.js");
    const lost = pushOneToNotion(article);
    await vi.runAllTimersAsync();
    expect(await lost).toBeNull();
    const replay = pushOneToNotion(article);
    await vi.runAllTimersAsync();
    expect(await replay).toEqual({
      notionUrl: "https://www.notion.so/0123456789abcdef0123456789abcdef",
      outcome: "existing",
    });
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it("creates raw content and a processing marker in one request, with no model API", async () => {
    api.query.mockResolvedValue({ results: [] });
    api.create.mockResolvedValue({ id: "0123456789abcdef0123456789abcdef" });
    const { pushOneToNotion } = await import("../client.js");
    const saved = pushOneToNotion(article);
    await vi.runAllTimersAsync();
    expect(await saved).toEqual({
      notionUrl: "https://www.notion.so/0123456789abcdef0123456789abcdef",
      outcome: "created",
    });
    const request = api.create.mock.calls[0][0];
    expect(request.properties.Summary.rich_text[0].text.content).toBe("");
    expect(request.children[0].code.rich_text[0].text.content).toContain('"status":"pending"');
    expect(request.children[0].code.rich_text[0].text.content).toContain("Original feed excerpt");
  });
});

it("preserves Japanese feed excerpts in Summary with an explicit unverified label", async () => {
  const { collectionSummary } = await import("../client.js");
  const japanese = { ...article, lang: "ja" as const };
  expect(collectionSummary(japanese)).toBe("【フィード抜粋・未検証】Original feed excerpt");
  expect(collectionSummary({ ...japanese, abstract: " " })).toBe("");
});
