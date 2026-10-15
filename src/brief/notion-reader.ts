import type { Client } from "@notionhq/client";
import { readState } from "../enrichment/state.js";
import {
  type BriefCandidate,
  CANDIDATE_SCAN_LIMIT,
  MAX_ARTICLE_AGE_MS,
  MAX_PUBLISHED_AGE_MS,
  hasGroundedSummary,
  isFreshArticle,
} from "./bundle.js";

interface Props {
  Title?: { title?: { plain_text?: string }[] };
  URL?: { url?: string | null };
  Source?: { select?: { name?: string } | null };
  Score?: { number?: number | null };
  Summary?: { rich_text?: { plain_text?: string }[] };
  Published?: { date?: { start?: string } | null };
}
const text = (parts: { plain_text?: string }[] | undefined) =>
  (parts ?? []).map((p) => p.plain_text ?? "").join("");

/** Read recent nonempty summaries first, then verify owned body provenance locally. */
export async function readBriefCandidates(
  notion: Client,
  databaseId: string,
  now: number
): Promise<{ articles: BriefCandidate[]; limited: boolean; scanned: number }> {
  const candidates: BriefCandidate[] = [];
  const deadline = Date.now() + 120_000;
  let cursor: string | undefined;
  let scanned = 0;
  // Four pages of twelve; no unbounded crawl or fallback to score-ranked history.
  for (let batch = 0; batch < CANDIDATE_SCAN_LIMIT / 12; batch++) {
    if (Date.now() + 12_000 >= deadline) return { articles: candidates, limited: true, scanned };
    const response = await notion.databases.query({
      database_id: databaseId,
      page_size: 12,
      start_cursor: cursor,
      filter: {
        and: [
          {
            property: "Fetched",
            date: { on_or_after: new Date(now - MAX_ARTICLE_AGE_MS).toISOString().slice(0, 10) },
          },
          {
            timestamp: "created_time",
            created_time: { on_or_after: new Date(now - MAX_ARTICLE_AGE_MS).toISOString() },
          },
          {
            property: "Published",
            date: { on_or_after: new Date(now - MAX_PUBLISHED_AGE_MS).toISOString().slice(0, 10) },
          },
          { property: "Published", date: { on_or_before: new Date(now).toISOString() } },
          { property: "Summary", rich_text: { is_not_empty: true } },
        ],
      },
      sorts: [
        { property: "Published", direction: "descending" },
        { timestamp: "created_time", direction: "descending" },
        { property: "Score", direction: "descending" },
      ],
    });
    if (response.results.length > 12) throw new Error("Unexpected brief page size");
    for (const page of response.results) {
      if (Date.now() + 12_000 >= deadline) return { articles: candidates, limited: true, scanned };
      scanned++;
      if (!("properties" in page) || !("created_time" in page)) continue;
      const props = page.properties as Props;
      const blocks = await notion.blocks.children.list({ block_id: page.id, page_size: 100 });
      const state = blocks.results
        .flatMap((block) =>
          "type" in block && block.type === "code" ? [readState(text(block.code.rich_text))] : []
        )
        .find((item) => item !== null);
      if (!state || state.status !== "ready" || state.input !== "article_body") continue;
      const candidate: BriefCandidate = {
        id: page.id,
        title: text(props.Title?.title),
        url: props.URL?.url ?? "",
        source: props.Source?.select?.name ?? "",
        score: props.Score?.number ?? 0,
        publishedAt: props.Published?.date?.start ?? null,
        collectedAt: state.collectedAt ?? page.created_time,
        summary: text(props.Summary?.rich_text),
        summaryKind: "source_quoted",
        evidence: state.evidence ?? [],
        summaryHash: state.summaryHash,
        summaryRecordedAt: state.updatedAt,
        model: state.model,
      };
      if (hasGroundedSummary(candidate, now) && isFreshArticle(candidate, now))
        candidates.push(candidate);
    }
    if (!response.has_more) return { articles: candidates, limited: false, scanned };
    if (!response.next_cursor || response.next_cursor === cursor)
      throw new Error("Invalid brief pagination cursor");
    cursor = response.next_cursor;
  }
  return { articles: candidates, limited: true, scanned };
}
