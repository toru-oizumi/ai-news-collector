import type { Client } from "@notionhq/client";
import { readState } from "../enrichment/state.js";
import { type BriefCandidate, MAX_ARTICLE_AGE_MS, MAX_PUBLISHED_AGE_MS, digest } from "./bundle.js";

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

/** Bounded live read, independent of cache. No legacy summary is trusted by default. */
export async function readBriefCandidates(
  notion: Client,
  databaseId: string,
  now: number
): Promise<{ articles: BriefCandidate[]; limited: boolean }> {
  const response = await notion.databases.query({
    database_id: databaseId,
    page_size: 12,
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
          or: [
            {
              property: "Published",
              date: {
                on_or_after: new Date(now - MAX_PUBLISHED_AGE_MS).toISOString().slice(0, 10),
              },
            },
            { property: "Published", date: { is_empty: true } },
          ],
        },
      ],
    },
    sorts: [{ property: "Score", direction: "descending" }],
  });
  const candidates: BriefCandidate[] = [];
  const deadline = Date.now() + 120_000;
  let limited = response.has_more;
  for (const page of response.results) {
    if (Date.now() + 12_000 >= deadline) {
      limited = true;
      break;
    }
    if (!("properties" in page) || !("created_time" in page)) continue;
    const props = page.properties as Props;
    const blocks = await notion.blocks.children.list({ block_id: page.id, page_size: 100 });
    const state = blocks.results
      .flatMap((block) =>
        "type" in block && block.type === "code" ? [readState(text(block.code.rich_text))] : []
      )
      .find((item) => item !== null);
    // Pre-change records have no source/body provenance. They are not auto-delivered.
    if (!state || state.status === "non_ai") continue;
    const summary = text(props.Summary?.rich_text);
    const quoted =
      state.status === "ready" &&
      state.input === "article_body" &&
      state.summaryHash === digest(summary) &&
      Array.isArray(state.evidence) &&
      state.evidence.length > 0;
    const excerpt = state.status === "excerpt" && typeof state.abstract === "string";
    candidates.push({
      id: page.id,
      title: text(props.Title?.title),
      url: props.URL?.url ?? "",
      source: props.Source?.select?.name ?? "",
      score: props.Score?.number ?? 0,
      publishedAt: props.Published?.date?.start ?? null,
      collectedAt: state.collectedAt ?? page.created_time,
      summary: quoted ? summary : excerpt ? state.abstract.slice(0, 300) : "",
      summaryKind: quoted ? "source_quoted" : excerpt ? "feed_excerpt" : "none",
      summaryRecordedAt: quoted ? state.updatedAt : undefined,
      model: quoted ? state.model : undefined,
      evidence: quoted ? (state.evidence ?? []) : [],
    });
  }
  return { articles: candidates, limited: Boolean(limited) };
}
