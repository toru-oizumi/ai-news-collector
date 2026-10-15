import type { Client } from "@notionhq/client";
import { describe, expect, it, vi } from "vitest";
import { STATE_MARKER } from "../../enrichment/state.js";
import { MAX_ARTICLE_AGE_MS, digest } from "../bundle.js";
import { readBriefCandidates } from "../notion-reader.js";

const now = Date.parse("2026-10-15T12:00:00Z");
const summary = "本文の出典付き自動要約です。";
const state = {
  marker: STATE_MARKER,
  status: "ready",
  attempts: 1,
  updatedAt: new Date(now).toISOString(),
  collectedAt: new Date(now).toISOString(),
  abstract: "raw",
  input: "article_body",
  summaryHash: digest(summary),
  evidence: ["A genuine supporting sentence from the article."],
};
const page = {
  id: "id",
  created_time: new Date(now).toISOString(),
  properties: {
    Title: { title: [{ plain_text: "AI research" }] },
    URL: { url: "https://example.com/post" },
    Source: { select: { name: "OpenAI" } },
    Score: { number: 100 },
    Summary: { rich_text: [{ plain_text: summary }] },
    Published: { date: { start: "2026-10-15" } },
  },
};
const setup = (text = JSON.stringify(state), storedSummary = summary) => {
  const query = vi.fn().mockResolvedValue({
    results: [
      {
        ...page,
        properties: {
          ...page.properties,
          Summary: { rich_text: [{ plain_text: storedSummary }] },
        },
      },
    ],
  });
  const list = vi.fn().mockResolvedValue({
    results: [{ type: "code", code: { rich_text: [{ plain_text: text }] } }],
  });
  return {
    client: { databases: { query }, blocks: { children: { list } } } as unknown as Client,
    query,
  };
};
describe("bounded brief source read", () => {
  it("filters old created_time precisely before limiting candidates to twelve", async () => {
    const { client, query } = setup();
    const articles = await readBriefCandidates(client, "database", now);
    expect(query.mock.calls[0][0].page_size).toBe(12);
    expect(query.mock.calls[0][0].filter.and).toContainEqual({
      timestamp: "created_time",
      created_time: { on_or_after: new Date(now - MAX_ARTICLE_AGE_MS).toISOString() },
    });
    expect(articles.articles[0]).toMatchObject({
      summaryKind: "source_quoted",
      summary,
      collectedAt: new Date(now).toISOString(),
    });
  });
  it("does not trust a changed Summary or a legacy record with no processing marker", async () => {
    const changed = setup(JSON.stringify(state), "manually replaced summary");
    expect((await readBriefCandidates(changed.client, "db", now)).articles[0].summaryKind).toBe(
      "none"
    );
    const legacy = setup("{}");
    expect((await readBriefCandidates(legacy.client, "db", now)).articles).toEqual([]);
  });
});
