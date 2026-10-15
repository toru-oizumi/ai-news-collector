import { createHash } from "node:crypto";
import { normalizeForDedup } from "../pipeline/dedup.js";
import type { RunIdentity, StageReport } from "../runtime/reports.js";

export interface BriefCandidate {
  id: string;
  title: string;
  url: string;
  source: string;
  score: number;
  publishedAt: string | null;
  collectedAt: string;
  summary: string;
  summaryKind: "source_quoted" | "feed_excerpt" | "none";
  evidence: string[];
  summaryRecordedAt?: string;
  model?: string;
  summaryHash?: string;
}
export interface BriefBundle {
  schemaVersion: 1;
  generatedAt: string;
  validUntil: string;
  run: RunIdentity;
  status: "ok" | "partial" | "empty" | "unavailable";
  deliveryAllowed: boolean;
  reasons: string[];
  collection: StageReport | null;
  enrichment: StageReport | null;
  sourceReadAt: string | null;
  articles: BriefCandidate[];
  qualityNote: string;
  selection: {
    policy: "grounded_recent_v1";
    candidateLimit: number;
    scannedCandidates: number;
    maxArticles: number;
    sourceLimited: boolean;
  };
  delivery: { attempted: false; history: "not_checked" };
}
export const CANDIDATE_SCAN_LIMIT = 48;
export const SELECTION_POLICY = "grounded_recent_v1";
export const MAX_BRIEF_AGE_MS = 8 * 60 * 60_000;
export const MAX_PUBLISHED_AGE_MS = 7 * 24 * 60 * 60_000;
export const MAX_ARTICLE_AGE_MS = 24 * 60 * 60_000;
export const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export const sameRun = (a: RunIdentity, b: RunIdentity) =>
  a.repository === b.repository &&
  a.ref === b.ref &&
  a.runId === b.runId &&
  a.attempt === b.attempt &&
  a.sha === b.sha;

/** Formal provenance checks only; quotations do not prove semantic accuracy. */
export function hasGroundedSummary(article: BriefCandidate, now: number): boolean {
  const recorded = Date.parse(article.summaryRecordedAt ?? "");
  return (
    article.summaryKind === "source_quoted" &&
    article.summary.trim().length >= 30 &&
    article.summary.length <= 500 &&
    article.summaryHash === digest(article.summary) &&
    Number.isFinite(recorded) &&
    recorded <= now + 60_000 &&
    Array.isArray(article.evidence) &&
    article.evidence.length >= 1 &&
    article.evidence.length <= 5 &&
    article.evidence.every((quote) => typeof quote === "string" && quote.trim().length >= 20)
  );
}

export function isFreshArticle(article: BriefCandidate, now: number): boolean {
  const collected = Date.parse(article.collectedAt);
  const published = Date.parse(article.publishedAt ?? "");
  return (
    Number.isFinite(collected) &&
    collected <= now + 60_000 &&
    now - collected < MAX_ARTICLE_AGE_MS &&
    Number.isFinite(published) &&
    published <= now + 60_000 &&
    now - published < MAX_PUBLISHED_AGE_MS
  );
}

export const compareFreshness = (a: BriefCandidate, b: BriefCandidate): number =>
  Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? "") ||
  Date.parse(b.collectedAt) - Date.parse(a.collectedAt) ||
  b.score - a.score;

export function buildBundle(input: {
  run: RunIdentity;
  now: number;
  collection: StageReport | null;
  enrichment: StageReport | null;
  collectionResult: string;
  enrichmentResult: string;
  ready: boolean;
  candidates: BriefCandidate[];
  sourceReadAt: string | null;
  readFailed?: boolean;
  sourceLimited?: boolean;
  sourceScanned?: number;
}): BriefBundle {
  const { now, run } = input;
  const reasons: string[] = [];
  const report = input.collection;
  const collectionValid =
    report?.schemaVersion === 1 &&
    report.stage === "collect" &&
    sameRun(report.run, run) &&
    report.finishedAt &&
    Date.parse(report.startedAt) <= now &&
    Date.parse(report.finishedAt) <= now + 60_000 &&
    now - Date.parse(report.finishedAt) < MAX_BRIEF_AGE_MS &&
    report.status !== "running";
  if (!collectionValid) reasons.push("collection_report_missing_or_wrong_run");
  if (!input.ready || !["success", "failure"].includes(input.collectionResult))
    reasons.push("collection_not_ready");
  if (
    input.readFailed ||
    !input.sourceReadAt ||
    !Number.isFinite(Date.parse(input.sourceReadAt)) ||
    Math.abs(now - Date.parse(input.sourceReadAt)) > 180_000
  )
    reasons.push("source_read_failed");
  const blocked = reasons.length > 0;
  if (
    input.collectionResult !== "success" ||
    report?.status !== "success" ||
    Number(report?.stats.pending ?? 0) > 0
  )
    reasons.push("collection_incomplete");
  if (
    input.enrichmentResult !== "success" ||
    !input.enrichment ||
    !sameRun(input.enrichment.run, run) ||
    input.enrichment.status !== "success" ||
    Number(input.enrichment.stats.pending ?? 0) > 0
  )
    reasons.push("enrichment_incomplete");
  if (input.sourceLimited) reasons.push("candidate_window_limited");
  const seen = new Set<string>();
  const articles =
    blocked || Number(report?.stats.fetched ?? 0) === 0
      ? []
      : [...input.candidates]
          .filter((a) => {
            return (
              isFreshArticle(a, now) &&
              hasGroundedSummary(a, now) &&
              /^https?:\/\//.test(a.url) &&
              a.title.trim() &&
              a.source.trim()
            );
          })
          .sort(compareFreshness)
          .filter((a) => {
            const key = normalizeForDedup(a.url);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 3)
          .map((a) => ({
            ...a,
            id: digest(normalizeForDedup(a.url)),
            summary: a.summary,
          }));
  if (!blocked && Number(report?.stats.fetched ?? 0) > 0 && !articles.length)
    reasons.push("no_grounded_recent_articles");
  const status = blocked
    ? "unavailable"
    : !articles.length
      ? "empty"
      : reasons.length
        ? "partial"
        : "ok";
  const expiry = Math.min(
    now + MAX_BRIEF_AGE_MS,
    ...articles.map((a) => Date.parse(a.collectedAt) + MAX_ARTICLE_AGE_MS),
    ...articles.flatMap((a) =>
      a.publishedAt ? [Date.parse(a.publishedAt) + MAX_PUBLISHED_AGE_MS] : []
    )
  );
  return {
    schemaVersion: 1,
    selection: {
      policy: SELECTION_POLICY,
      candidateLimit: CANDIDATE_SCAN_LIMIT,
      scannedCandidates: input.sourceScanned ?? input.candidates.length,
      maxArticles: 3,
      sourceLimited: input.sourceLimited ?? false,
    },
    delivery: { attempted: false, history: "not_checked" },
    generatedAt: new Date(now).toISOString(),
    validUntil: new Date(expiry).toISOString(),
    run,
    status,
    deliveryAllowed: articles.length > 0 && !blocked,
    reasons,
    collection: report,
    enrichment: input.enrichment,
    sourceReadAt: input.sourceReadAt,
    articles,
    qualityNote:
      "本文引用・要約ハッシュを確認した自動要約のみ。意味の正確性は未検証です。生成のみで、配信履歴は照合していません。",
  };
}

/** Consumer contract: fetch the NEWEST run first, then match its id/attempt here.
 * Never search backward for a successful artifact after a newer failed/cancelled run. */
export function assertDeliverable(bundle: BriefBundle, expected: RunIdentity, now: number): void {
  if (
    bundle.schemaVersion !== 1 ||
    bundle.selection?.policy !== SELECTION_POLICY ||
    !sameRun(bundle.run, expected) ||
    !bundle.deliveryAllowed ||
    !["ok", "partial"].includes(bundle.status) ||
    bundle.articles.length < 1 ||
    bundle.articles.length > 3
  )
    throw new Error("Brief is not deliverable for the expected run");
  const generated = Date.parse(bundle.generatedAt);
  const expiry = Date.parse(bundle.validUntil);
  if (
    !Number.isFinite(generated) ||
    !Number.isFinite(expiry) ||
    generated > now + 60_000 ||
    now >= expiry ||
    expiry <= generated ||
    expiry > generated + MAX_BRIEF_AGE_MS
  )
    throw new Error("Brief is expired or has invalid timestamps");
  for (const article of bundle.articles) {
    if (
      !hasGroundedSummary(article, now) ||
      !isFreshArticle(article, now) ||
      !/^https?:\/\//.test(article.url) ||
      !article.title.trim() ||
      !article.source.trim() ||
      article.id !== digest(normalizeForDedup(article.url))
    )
      throw new Error("Brief contains stale, ungrounded or invalid article data");
  }
}
export function renderBundle(bundle: BriefBundle): string {
  const header = `# AI News Brief\n\n生成: ${bundle.generatedAt}\n有効期限: ${bundle.validUntil}\n状態: ${bundle.status}\n生成元: ${bundle.run.repository} · ${bundle.run.sha}\n実行: ${bundle.run.url} (attempt ${bundle.run.attempt})\n\n${bundle.qualityNote}\n`;
  if (!bundle.deliveryAllowed)
    return `${header}\n配信対象なし。過去の結果へフォールバックしません。\n理由: ${bundle.reasons.join(", ") || "新しい対象記事なし"}\n`;
  return `${header}\n${bundle.articles.map((a, i) => `${i + 1}. ${a.title.replace(/\s+/g, " ")}\n   出典: ${a.source} · 公開 ${a.publishedAt ?? "不明"} · 収集 ${a.collectedAt}\n   ${a.url}\n   ${a.summaryKind === "source_quoted" ? "自動要約" : a.summaryKind === "feed_excerpt" ? "未検証のフィード抜粋" : "要約なし"}: ${a.summary || "本文根拠のある要約は未生成です。"}`).join("\n\n")}\n`;
}
