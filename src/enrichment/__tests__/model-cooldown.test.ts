import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { MistralRequestError } from "../../digest/failures.js";
import { sealCheckpoint, validateCheckpoint } from "../../runtime/checkpoint.js";
import { loadModelCooldown, loadModelCooldownState, saveModelCooldown } from "../model-cooldown.js";
import { type EnrichmentRow, enrichOne } from "../processor.js";
import { runEnrichment } from "../runner.js";

it("retains the model circuit across Notion failure, checkpoint restore and a different article", async () => {
  const directory = await mkdtemp(join(tmpdir(), "model-cooldown-"));
  const path = join(directory, "model-cooldown.json");
  const article: EnrichmentRow = {
    pageId: "first",
    blockId: "block",
    title: "Language model release",
    url: "https://example.com/1",
    state: {
      marker: "ai-news-processing:v1",
      status: "pending",
      attempts: 0,
      abstract: "",
      updatedAt: new Date(0).toISOString(),
    },
  };
  try {
    expect(await loadModelCooldown(path)).toBe(0);
    await expect(
      enrichOne(article, {
        now: () => 0,
        fetchBody: async () => ({
          paragraphs: [
            "An open source language model is released for local inference. The release includes model weights and usage examples for researchers. No benchmark results have been published.",
          ],
        }),
        generate: async () => {
          throw new MistralRequestError({
            stage: "model",
            reason: "http_error",
            httpStatus: 429,
            retryAfterSeconds: 86400,
          });
        },
        onRateLimit: (time, failure) => saveModelCooldown(time, path, failure),
        persist: async () => {
          throw new Error("Notion write failed");
        },
      })
    ).rejects.toThrow("Notion write failed");
    await writeFile(join(directory, "pending.json"), "[]");
    await sealCheckpoint(directory);
    await validateCheckpoint(directory);
    const cause = (await loadModelCooldownState(path))?.failure;
    expect(cause).toMatchObject({ stage: "model", httpStatus: 429, retryAfterSeconds: 86400 });
    const until = await loadModelCooldown(path);
    expect(until).toBe(86400000);
    const process = vi.fn();
    const load = vi.fn().mockResolvedValue(null);
    const dependencies = {
      cooldownUntil: until,
      cooldownFailure: cause,
      now: () => until - 1,
      deadline: Number.POSITIVE_INFINITY,
      load,
      process,
      reserve: vi.fn(),
      checkpoint: vi.fn(),
      wait: vi.fn(),
    };
    const pages = [{ pageId: "second", title: "Another model", url: "https://example.com/2" }];
    expect(await runEnrichment(pages, dependencies)).toMatchObject({
      processed: 0,
      pending: 1,
      failed: true,
      rateLimited: true,
      failure: { operation: "wait" },
    });
    expect(load).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
    expect(dependencies.checkpoint).not.toHaveBeenCalled();
    await runEnrichment(pages, { ...dependencies, now: () => until });
    expect(load).toHaveBeenCalledTimes(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("never shortens a recorded cooldown and rejects malformed checkpoints", async () => {
  const directory = await mkdtemp(join(tmpdir(), "model-cooldown-"));
  const path = join(directory, "cooldown.json");
  try {
    await saveModelCooldown("2026-10-20T00:00:00Z", path);
    await saveModelCooldown("2026-10-19T00:00:00Z", path);
    expect(await loadModelCooldown(path)).toBe(Date.parse("2026-10-20T00:00:00Z"));
    expect(await readFile(path, "utf8")).not.toContain("api_key");
    for (const value of [
      "invalid",
      "null",
      '{"schemaVersion":1,"nextAttemptAt":"invalid"}',
      '{"schemaVersion":2,"nextAttemptAt":"2026-10-20"}',
    ]) {
      await writeFile(path, value);
      await expect(loadModelCooldown(path)).rejects.toThrow();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
