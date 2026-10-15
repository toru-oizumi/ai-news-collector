import type { ExportedArticle } from "../notion/client.js";
import { normalizeForDedup } from "../pipeline/dedup.js";

/** A local preview only. Historical Summary values have no verified provenance. */
export function renderBrief(articles: ExportedArticle[], includeUnverified = false): string {
  const seen = new Set<string>();
  const top = [...articles]
    .filter((a) => /^https?:\/\//.test(a.url) && a.title.trim())
    .sort((a, b) => (b.fetched ?? "").localeCompare(a.fetched ?? "") || b.score - a.score)
    .filter((a) => {
      const key = normalizeForDedup(a.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
  if (!top.length) return "保存済みの記事はありません。\n";
  return top
    .map((a, index) => {
      const line = `${index + 1}. ${a.title.replace(/\s+/g, " ")}\n   出典: ${a.source} · ${a.published ?? "公開日不明"}\n   ${a.url}`;
      return includeUnverified && a.summary.trim()
        ? `${line}\n   保存済み要約（未検証）: ${a.summary.replace(/\s+/g, " ").slice(0, 180)}`
        : line;
    })
    .join("\n\n");
}
