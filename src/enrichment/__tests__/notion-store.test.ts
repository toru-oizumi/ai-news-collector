import type { Client } from "@notionhq/client";
import { describe, expect, it, vi } from "vitest";
import { persistSummary } from "../notion-store.js";
import type { EnrichmentRow } from "../processor.js";

it("replays replace the same Summary/property and managed block, never append or change reading status", async () => {
  const pages = { update: vi.fn().mockResolvedValue({}) };
  const blocks = { update: vi.fn().mockResolvedValue({}) };
  const client = { pages, blocks } as unknown as Client;
  const row: EnrichmentRow = {
    pageId: "page",
    blockId: "owned-block",
    title: "title",
    url: "url",
    state: {
      marker: "ai-news-processing:v1",
      status: "ready",
      attempts: 1,
      abstract: "",
      updatedAt: new Date(0).toISOString(),
    },
  };
  await persistSummary(client, row, row.state, "summary");
  await persistSummary(client, row, row.state, "summary");
  expect(pages.update.mock.calls[0]).toEqual(pages.update.mock.calls[1]);
  expect(blocks.update.mock.calls[0]).toEqual(blocks.update.mock.calls[1]);
  expect(pages.update.mock.calls[0][0].properties).toEqual({
    Summary: { rich_text: [{ text: { content: "summary" } }] },
  });
});

it("can replay a Summary success followed by a failed managed-block update", async () => {
  const pages = { update: vi.fn().mockResolvedValue({}) };
  const blocks = {
    update: vi.fn().mockRejectedValueOnce(new Error("lost state response")).mockResolvedValue({}),
  };
  const client = { pages, blocks } as unknown as Client;
  const row: EnrichmentRow = {
    pageId: "page",
    blockId: "owned-block",
    title: "title",
    url: "url",
    state: {
      marker: "ai-news-processing:v1",
      status: "ready",
      attempts: 1,
      abstract: "",
      updatedAt: new Date(0).toISOString(),
    },
  };
  await expect(persistSummary(client, row, row.state, "summary")).rejects.toThrow();
  await persistSummary(client, row, row.state, "summary");
  expect(pages.update.mock.calls[0]).toEqual(pages.update.mock.calls[1]);
  expect(blocks.update.mock.calls[0]).toEqual(blocks.update.mock.calls[1]);
});
