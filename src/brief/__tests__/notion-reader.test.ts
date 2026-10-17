import type { Client } from "@notionhq/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STATE_MARKER } from "../../enrichment/state.js";
import { NotionRequestPolicy } from "../../notion/request-policy.js";
import { MAX_ARTICLE_AGE_MS, digest } from "../bundle.js";
import { readBriefCandidates } from "../notion-reader.js";

afterEach(() => vi.restoreAllMocks());

const policy = () => {
  let time = Date.now();
  return new NotionRequestPolicy({
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  });
};
const now = Date.parse("2026-10-15T12:00:00Z");
const summary = "記事本文に示された内容を、出典の引用と照合した日本語の要約として伝えます。";
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
    const articles = await readBriefCandidates(client, "database", now, policy());
    expect(query.mock.calls[0][0].page_size).toBe(12);
    expect(query.mock.calls[0][0].sorts).toEqual([
      { property: "Published", direction: "descending" },
      { timestamp: "created_time", direction: "descending" },
      { property: "Score", direction: "descending" },
    ]);
    expect(query.mock.calls[0][0].filter.and).toContainEqual({
      property: "Summary",
      rich_text: { is_not_empty: true },
    });
    expect(query.mock.calls[0][0].filter.and).toContainEqual({
      property: "Published",
      date: { on_or_before: new Date(now).toISOString() },
    });
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
    expect((await readBriefCandidates(changed.client, "db", now, policy())).articles).toEqual([]);
    const legacy = setup("{}");
    expect((await readBriefCandidates(legacy.client, "db", now, policy())).articles).toEqual([]);
  });
});

it("looks past twelve unverified excerpts instead of pinning the same high-score candidates", async () => {
  const excerpts = Array.from({ length: 12 }, (_, n) => ({ ...page, id: `excerpt-${n}` }));
  const fresh = { ...page, id: "fresh", properties: { ...page.properties, Score: { number: 1 } } };
  const query = vi
    .fn()
    .mockResolvedValueOnce({ results: excerpts, has_more: true, next_cursor: "next" })
    .mockResolvedValueOnce({ results: [fresh], has_more: false });
  const list = vi.fn(async ({ block_id }: { block_id: string }) => ({
    results: [
      {
        type: "code",
        code: {
          rich_text: [
            {
              plain_text: JSON.stringify({
                ...state,
                status: block_id === "fresh" ? "ready" : "excerpt",
              }),
            },
          ],
        },
      },
    ],
  }));
  const client = { databases: { query }, blocks: { children: { list } } } as unknown as Client;
  const result = await readBriefCandidates(client, "db", now, policy());
  expect(result.articles.map((a) => a.id)).toEqual(["fresh"]);
  expect(result).toMatchObject({ scanned: 13, limited: false });
  expect(query.mock.calls[1][0].start_cursor).toBe("next");
});

it("stops after 48 inspected records and reports the bounded candidate window", async () => {
  let batch = 0;
  const query = vi.fn(async () => ({
    results: Array.from({ length: 12 }, (_, n) => ({ ...page, id: `${batch}-${n}` })),
    has_more: true,
    next_cursor: String(++batch),
  }));
  const list = vi.fn().mockResolvedValue({ results: [] });
  const client = { databases: { query }, blocks: { children: { list } } } as unknown as Client;
  expect(await readBriefCandidates(client, "db", now, policy())).toMatchObject({
    articles: [],
    scanned: 48,
    limited: true,
  });
  expect(query).toHaveBeenCalledTimes(4);
  expect(list).toHaveBeenCalledTimes(48);
});

it("honors the read budget before querying and never falls back to high scores", async () => {
  const { client, query } = setup();
  const requestPolicy = policy();
  vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(120_000);
  expect(await readBriefCandidates(client, "db", now, requestPolicy)).toEqual({
    articles: [],
    scanned: 0,
    limited: true,
  });
  expect(query).not.toHaveBeenCalled();
});

it.each([
  { ...state, status: "pending" },
  { ...state, status: "excerpt" },
  { ...state, input: "feed_excerpt" },
  { ...state, evidence: [] },
  { ...state, summaryHash: "wrong" },
  { ...state, updatedAt: "invalid" },
])("rejects non-body or inconsistent summary provenance before ranking: %j", async (processing) => {
  const { client } = setup(JSON.stringify(processing));
  expect((await readBriefCandidates(client, "db", now, policy())).articles).toEqual([]);
});

it("fails visibly when pagination claims more data without a valid next cursor", async () => {
  const { client, query } = setup();
  query.mockResolvedValue({ results: [], has_more: true, next_cursor: null });
  await expect(readBriefCandidates(client, "db", now, policy())).rejects.toThrow(
    "pagination cursor"
  );
});

it("retries query and provenance reads through the same policy without changing quality gates", async () => {
  const { client, query } = setup();
  query.mockRejectedValueOnce({ status: 429, headers: new Headers({ "retry-after": "2" }) });
  const list = vi.mocked(client.blocks.children.list);
  list.mockRejectedValueOnce({ status: 429, headers: new Headers({ "retry-after": "1" }) });
  const result = await readBriefCandidates(client, "db", now, policy());
  expect(query).toHaveBeenCalledTimes(2);
  expect(list).toHaveBeenCalledTimes(2);
  expect(result.articles).toHaveLength(1);
  expect(result.articles[0].summaryHash).toBe(digest(summary));
});
