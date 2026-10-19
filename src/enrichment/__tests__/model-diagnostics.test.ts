import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { safeModelFailure } from "../../digest/failures.js";
import { sealCheckpoint, validateCheckpoint } from "../../runtime/checkpoint.js";
import { runReported } from "../../runtime/reports.js";
import { loadModelCooldownState, saveModelCooldown } from "../model-cooldown.js";
import type { EnrichmentRow } from "../processor.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("retains bounded provider diagnostics in the report and across checkpoint restart without extending a wait", async () => {
  vi.resetModules();
  vi.stubEnv("MISTRAL_API_KEY", "private-test-token");
  const fetch = vi.fn().mockResolvedValue(
    Response.json(
      {
        error: {
          code: "insufficient_quota",
          type: "rate_limit_error",
          message: "private provider message",
        },
      },
      { status: 429, headers: { "retry-after": "86400", "x-private": "private header" } }
    )
  );
  vi.stubGlobal("fetch", fetch);
  const { callMistral } = await import("../../digest/mistral-client.js");
  const { enrichOne } = await import("../processor.js");
  const { runEnrichment } = await import("../runner.js");
  const directory = await mkdtemp(join(tmpdir(), "model-diagnostic-"));
  const path = join(directory, "model-cooldown.json");
  const page = { pageId: "page", title: "AI model", url: "https://example.com/article" };
  const state = {
    marker: "ai-news-processing:v1" as const,
    status: "pending" as const,
    attempts: 0,
    abstract: "",
    updatedAt: new Date(0).toISOString(),
  };
  const load = vi.fn(async () => ({ ...page, blockId: "block", state }));
  const persist = vi.fn();
  const dependencies = {
    deadline: Number.POSITIVE_INFINITY,
    now: () => 0,
    load,
    reserve: vi.fn(),
    checkpoint: vi.fn(),
    wait: vi.fn(),
    process: (row: EnrichmentRow) =>
      enrichOne(row, {
        now: () => 0,
        fetchBody: async () => ({
          paragraphs: [
            "A language model with open source weights supports local inference for developers. This synthetic body is used to verify failure diagnostics without external API calls.",
          ],
        }),
        generate: callMistral,
        persist,
        onRateLimit: (time, failure) => saveModelCooldown(time, path, failure),
      }),
  };
  try {
    await expect(
      runReported(
        "enrich",
        async (report) => {
          const result = await runEnrichment([page], dependencies);
          report.failure = result.failure;
          if (result.failed) throw new Error("bounded failure");
        },
        directory
      )
    ).rejects.toThrow("bounded failure");
    const reportText = await readFile(join(directory, "enrich-report.json"), "utf8");
    const report = JSON.parse(reportText);
    expect(report.failure).toEqual({
      operation: "model",
      httpStatus: 429,
      nextAttemptAt: "1970-01-02T00:00:00.000Z",
      model: {
        stage: "model",
        reason: "http_error",
        httpStatus: 429,
        code: "insufficient_quota",
        codeStatus: "present",
        codeKind: "string",
        providerType: "rate_limit_error",
        retryAfterSeconds: 86400,
        retryAfterStatus: "valid",
      },
    });
    expect(reportText).not.toMatch(/private|Authorization|example\.com/);
    await writeFile(join(directory, "pending.json"), "[]");
    await sealCheckpoint(directory);
    await validateCheckpoint(directory);
    const cooldown = await loadModelCooldownState(path);
    expect(cooldown?.failure).toEqual(report.failure.model);
    const original = await readFile(path, "utf8");
    load.mockClear();
    const waiting = await runEnrichment([page], {
      ...dependencies,
      now: () => 86400000 - 1,
      cooldownUntil: Date.parse(cooldown?.nextAttemptAt ?? ""),
      cooldownFailure: cooldown?.failure,
    });
    expect(waiting.failure).toEqual({
      operation: "wait",
      nextAttemptAt: cooldown?.nextAttemptAt,
      model: report.failure.model,
    });
    expect(waiting.failure?.httpStatus).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await readFile(path, "utf8")).toBe(original);
    // A shorter later observation cannot replace the longer cooldown or its cause.
    await saveModelCooldown("1970-01-01T06:00:00.000Z", path, {
      stage: "model",
      reason: "http_error",
      httpStatus: 429,
      code: "rate_limited",
    });
    expect(await readFile(path, "utf8")).toBe(original);
    expect(persist).toHaveBeenCalledOnce();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("drops unrecognized fields and raw values from restored model diagnostics", () => {
  expect(
    safeModelFailure({
      stage: "model",
      reason: "http_error",
      httpStatus: 429,
      code: "private key",
      retryAfterSeconds: Number.POSITIVE_INFINITY,
      codeStatus: "private body",
      retryAfterStatus: "private header",
      message: "private message",
      headers: { Authorization: "private" },
    })
  ).toEqual({ stage: "model", reason: "http_error", httpStatus: 429, code: "unrecognized" });
  expect(safeModelFailure({ stage: "model", reason: "private body" })).toBeUndefined();
});

it("does not invent a code kind for already redacted historical evidence", () => {
  expect(
    safeModelFailure({
      stage: "model",
      reason: "http_error",
      httpStatus: 429,
      code: "unrecognized",
    })
  ).toEqual({ stage: "model", reason: "http_error", httpStatus: 429, code: "unrecognized" });
  expect(
    safeModelFailure({
      stage: "model",
      reason: "http_error",
      code: "unrecognized",
      codeKind: "numeric_string",
      providerType: "rate_limit_error",
    })
  ).toEqual({
    stage: "model",
    reason: "http_error",
    code: "unrecognized",
    codeKind: "numeric_string",
    providerType: "rate_limit_error",
  });
});
