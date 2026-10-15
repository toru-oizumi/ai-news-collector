import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { preparePending } from "../../collection/priority.js";
import type { RunIdentity, StageReport } from "../../runtime/reports.js";
import type { Article } from "../../types.js";
import {
  type BriefCandidate,
  MAX_ARTICLE_AGE_MS,
  MAX_BRIEF_AGE_MS,
  MAX_PUBLISHED_AGE_MS,
  assertDeliverable,
  buildBundle,
  renderBundle,
} from "../bundle.js";
import { verifyBriefFiles, writeBriefFiles } from "../files.js";

const now = Date.parse("2026-10-15T12:00:00Z");
const run: RunIdentity = {
  repository: "test/repo",
  ref: "refs/heads/develop",
  sha: "abc123",
  runId: "100",
  attempt: 1,
  url: "https://github.com/test/repo/actions/runs/100",
};
const report = (stage: StageReport["stage"]): StageReport => ({
  schemaVersion: 1,
  stage,
  run,
  startedAt: new Date(now - 300_000).toISOString(),
  finishedAt: new Date(now - 1000).toISOString(),
  status: "success",
  stats:
    stage === "collect"
      ? { fetched: 65, confirmed: 65, pending: 0 }
      : { processed: 10, pending: 0 },
});
const article = (n: number): BriefCandidate => ({
  id: `${n}`,
  title: `AI article ${n}`,
  url: `https://example.com/${n}`,
  source: "OpenAI",
  score: n,
  collectedAt: new Date(now - 60_000).toISOString(),
  publishedAt: "2026-10-15",
  summary: "自動要約です。",
  summaryKind: "source_quoted",
  evidence: ["Original supporting source sentence."],
});
const input = () => ({
  run,
  now,
  collection: report("collect"),
  enrichment: report("enrich"),
  collectionResult: "success",
  enrichmentResult: "success",
  ready: true,
  candidates: [article(1), article(2), article(3), article(4)],
  sourceReadAt: new Date(now).toISOString(),
});

describe("cloud brief provenance and freshness", () => {
  it("ranks at most three distinct articles with timestamps, source links and generated origin", () => {
    const bundle = buildBundle(input());
    expect(bundle.articles.map((a) => a.title)).toEqual([
      "AI article 4",
      "AI article 3",
      "AI article 2",
    ]);
    expect(bundle.status).toBe("ok");
    expect(() => assertDeliverable(bundle, run, now)).not.toThrow();
    const markdown = renderBundle(bundle);
    expect(markdown).toContain(run.url);
    expect(markdown).toContain("2026-10-15T12:00:00.000Z");
    expect(markdown).toContain("https://example.com/4");
  });
  it("publishes an explicit diagnostic after failed collection or missing current report", () => {
    for (const data of [
      { ...input(), ready: false, collectionResult: "failure" },
      { ...input(), collection: null },
      { ...input(), collection: { ...report("collect"), run: { ...run, attempt: 0 } } },
    ]) {
      const bundle = buildBundle(data);
      expect(bundle.deliveryAllowed).toBe(false);
      expect(bundle.articles).toEqual([]);
      expect(bundle.status).toBe("unavailable");
      expect(() => assertDeliverable(bundle, run, now)).toThrow();
    }
  });
  it("permits labelled partial collection/enrichment while keeping raw source links", () => {
    const bundle = buildBundle({
      ...input(),
      collection: { ...report("collect"), stats: { fetched: 65, confirmed: 39, pending: 26 } },
      enrichmentResult: "failure",
    });
    expect(bundle.status).toBe("partial");
    expect(bundle.deliveryAllowed).toBe(true);
    expect(bundle.reasons).toContain("collection_incomplete");
    expect(bundle.reasons).toContain("enrichment_incomplete");
  });
  it("never refreshes cached articles after zero source items or failed source read", () => {
    const zero = buildBundle({
      ...input(),
      collection: { ...report("collect"), stats: { fetched: 0 } },
    });
    expect(zero.status).toBe("empty");
    expect(zero.articles).toEqual([]);
    const failed = buildBundle({ ...input(), readFailed: true });
    expect(failed.status).toBe("unavailable");
    expect(failed.articles).toEqual([]);
  });
  it("rejects old source items and does not present old published articles as fresh", () => {
    const bundle = buildBundle({
      ...input(),
      candidates: [
        { ...article(1), collectedAt: new Date(now - MAX_ARTICLE_AGE_MS).toISOString() },
        { ...article(2), publishedAt: "2026-08-15" },
      ],
    });
    expect(bundle.articles).toEqual([]);
  });
  it("expires at article freshness boundary even before the eight-hour bundle expiry", () => {
    const bundle = buildBundle({
      ...input(),
      candidates: [
        { ...article(1), collectedAt: new Date(now - MAX_ARTICLE_AGE_MS + 60_000).toISOString() },
      ],
    });
    expect(Date.parse(bundle.validUntil)).toBe(now + 60_000);
    expect(() => assertDeliverable(bundle, run, now + 60_000)).toThrow();
  });
  it("enforces published seven-day boundary during delivery, not only generation", () => {
    const bundle = buildBundle({
      ...input(),
      candidates: [
        {
          ...article(1),
          publishedAt: new Date(now - MAX_PUBLISHED_AGE_MS + 60 * 60_000).toISOString(),
        },
      ],
    });
    expect(Date.parse(bundle.validUntil)).toBe(now + 60 * 60_000);
    expect(() => assertDeliverable(bundle, run, now + 2 * 60 * 60_000)).toThrow();
    bundle.validUntil = new Date(now + MAX_BRIEF_AGE_MS).toISOString();
    expect(() => assertDeliverable(bundle, run, now + 2 * 60 * 60_000)).toThrow();
  });
  it("rejects an older run, another ref/sha, another attempt and an expired result", () => {
    const bundle = buildBundle(input());
    for (const expected of [
      { ...run, runId: "101" },
      { ...run, attempt: 2 },
      { ...run, ref: "refs/heads/other" },
      { ...run, sha: "another" },
    ])
      expect(() => assertDeliverable(bundle, expected, now)).toThrow();
    expect(() => assertDeliverable(bundle, run, now + MAX_BRIEF_AGE_MS)).toThrow();
  });
  it("validates artifact hashes and fails on tampering", async () => {
    const dir = await mkdtemp(join(tmpdir(), "brief-test-"));
    try {
      await writeBriefFiles(dir, buildBundle(input()));
      expect((await verifyBriefFiles(dir, run, now)).articles).toHaveLength(3);
      await writeFile(join(dir, "brief.md"), "stale news substituted");
      await expect(verifyBriefFiles(dir, run, now)).rejects.toThrow("integrity");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

it("permits the 18:00 UTC output at 08:00 JST but rejects it the following morning", () => {
  const generated = Date.parse("2026-10-15T18:30:00Z");
  const data = input();
  const bundle = buildBundle({
    ...data,
    now: generated,
    sourceReadAt: new Date(generated).toISOString(),
    collection: {
      ...report("collect"),
      startedAt: "2026-10-15T18:00:00Z",
      finishedAt: "2026-10-15T18:05:00Z",
    },
    enrichment: {
      ...report("enrich"),
      startedAt: "2026-10-15T18:05:00Z",
      finishedAt: "2026-10-15T18:20:00Z",
    },
    candidates: [{ ...article(1), collectedAt: "2026-10-15T18:00:00Z" }],
  });
  expect(() => assertDeliverable(bundle, run, Date.parse("2026-10-15T23:00:00Z"))).not.toThrow();
  expect(() => assertDeliverable(bundle, run, Date.parse("2026-10-16T23:00:00Z"))).toThrow();
});

it("rejects an older successful bundle after a newer failed or cancelled workflow", async () => {
  const { requireCompletedLatest } = await import("../latest-run.js");
  const old = buildBundle(input());
  const newer = { ...run, runId: "101", attempt: 2, sha: "newer" };
  const expected = requireCompletedLatest({
    run: newer,
    status: "completed",
    conclusion: "failure",
  });
  expect(() => assertDeliverable(old, expected, now)).toThrow();
  expect(() =>
    requireCompletedLatest({ run: newer, status: "completed", conclusion: "cancelled" })
  ).toThrow();
  expect(() =>
    requireCompletedLatest({ run: newer, status: "in_progress", conclusion: null })
  ).toThrow();
});

it("does not fill a brief with old backlog or refresh rediscovered collection timestamps", () => {
  const raw = (n: number, publishedDays: number, collectedDays: number): Article => ({
    title: `AI article ${n}`,
    url: `https://example.com/${n}`,
    source: "OpenAI",
    category: [],
    score: 100,
    summary: "",
    abstract: "",
    lang: "en",
    publishedAt: new Date(now - publishedDays * 86_400_000),
    fetchedAt: new Date(now - collectedDays * 86_400_000),
  });
  const old = raw(2, 30, 0);
  const rediscovered = raw(3, 3, 2);
  const prepared = preparePending(
    [old, rediscovered],
    [raw(1, 0, 0), { ...raw(3, 3, 0), score: 999 }, { ...raw(2, 0, 0), score: 999 }],
    new Set(),
    now
  );
  const bundle = buildBundle({
    ...input(),
    candidates: prepared.map((a) => ({
      ...article(Number(a.url.split("/").pop())),
      collectedAt: a.fetchedAt.toISOString(),
      publishedAt: a.publishedAt?.toISOString() ?? null,
      summary: "",
      summaryKind: "none",
      evidence: [],
    })),
  });
  expect(bundle.articles.map((a) => a.title)).toEqual(["AI article 1"]);
  expect(bundle.articles).toHaveLength(1); // fewer than three is preferable to padded old news
});
