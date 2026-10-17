import type { Client } from "@notionhq/client";
import { type NotionRequestPolicy, notionPolicy } from "../notion/request-policy.js";
import type { PendingPage } from "./backlog.js";
import type { EnrichmentRow } from "./processor.js";
import { type ProcessingState, processingBlock, readState } from "./state.js";

export async function loadRow(
  notion: Client,
  page: PendingPage,
  policy: NotionRequestPolicy = notionPolicy(notion)
): Promise<EnrichmentRow | null> {
  let cursor: string | undefined;
  do {
    const response = await policy.request("enrichment_load", () =>
      notion.blocks.children.list({
        block_id: page.pageId,
        start_cursor: cursor,
        page_size: 100,
      })
    );
    for (const block of response.results) {
      if (!("type" in block) || block.type !== "code") continue;
      const state = readState(block.code.rich_text.map((part) => part.plain_text).join(""));
      if (state) return { ...page, blockId: block.id, state };
    }
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return null;
}

export async function persistSummary(
  notion: Client,
  row: EnrichmentRow,
  state: ProcessingState,
  summary: string,
  policy: NotionRequestPolicy = notionPolicy(notion)
): Promise<void> {
  await policy.request("summary_update", () =>
    notion.pages.update({
      page_id: row.pageId,
      properties: { Summary: { rich_text: summary ? [{ text: { content: summary } }] : [] } },
    })
  );
  const block = processingBlock(state);
  if (!("code" in block)) throw new Error("Invalid processing block");
  await policy.request("state_update", () =>
    notion.blocks.update({ block_id: row.blockId, code: block.code })
  );
}
