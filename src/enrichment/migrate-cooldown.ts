import { readFile } from "node:fs/promises";
import { safeModelFailure } from "../digest/failures.js";
import { sealCheckpoint, validateCheckpoint } from "../runtime/checkpoint.js";
import { type RunIdentity, type StageReport, currentRun } from "../runtime/reports.js";
import { loadModelCooldownState, saveModelCooldown } from "./model-cooldown.js";

/** Offline, explicit reconciliation from a sealed checkpoint; never anchor a retry to now. */
export async function migrateModelCooldown(
  directory = ".runtime",
  run: RunIdentity = currentRun(),
  now = Date.now()
): Promise<{
  status: "active" | "expired" | "missing_evidence";
  changed: boolean;
  nextAttemptAt?: string;
  sourceRunId?: string;
}> {
  await validateCheckpoint(directory, run);
  const path = `${directory}/model-cooldown.json`;
  let cooldown = await loadModelCooldownState(path);
  let report: StageReport | undefined;
  try {
    report = JSON.parse(await readFile(`${directory}/enrich-report.json`, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let changed = false;
  let sourceRunId: string | undefined;
  // A wait report may contain an old 429 in `model`. It is not a new rejection.
  if (report?.failure?.operation === "model" && report.failure.httpStatus === 429) {
    const finished = Date.parse(report.finishedAt ?? "");
    const started = Date.parse(report.startedAt);
    if (
      report.schemaVersion !== 1 ||
      report.stage !== "enrich" ||
      report.status !== "failed" ||
      report.run?.repository !== run.repository ||
      report.run?.ref !== run.ref ||
      typeof report.run?.runId !== "string" ||
      typeof report.startedAt !== "string" ||
      typeof report.finishedAt !== "string" ||
      !Number.isFinite(started) ||
      !Number.isFinite(finished) ||
      started > finished ||
      finished > now + 60_000
    )
      throw new Error("Invalid model rejection report; migration refused");
    const failure = safeModelFailure(report.failure.model) ?? {
      stage: "model" as const,
      reason: "http_error" as const,
      httpStatus: 429,
    };
    const hint = failure.retryAfterSeconds ?? 0;
    // finishedAt conservatively bounds the rejection when the legacy report lacks its timestamp.
    let until = finished + Math.max(21600, hint) * 1000;
    if (report.failure.nextAttemptAt !== undefined) {
      const explicit = Date.parse(report.failure.nextAttemptAt);
      if (
        typeof report.failure.nextAttemptAt !== "string" ||
        !Number.isFinite(explicit) ||
        explicit < started + Math.max(21600, hint) * 1000
      )
        throw new Error("Invalid model rejection deadline; migration refused");
      // New reports already carry the actual rejection-based deadline. Do not re-anchor it to report completion.
      until = explicit;
    }
    sourceRunId = report.run.runId;
    if (!cooldown || until > Date.parse(cooldown.nextAttemptAt)) {
      await saveModelCooldown(new Date(until).toISOString(), path, failure);
      await sealCheckpoint(directory, run);
      cooldown = await loadModelCooldownState(path);
      changed = true;
    }
  }
  if (!cooldown) return { status: "missing_evidence", changed: false };
  return {
    status: Date.parse(cooldown.nextAttemptAt) > now ? "active" : "expired",
    changed,
    nextAttemptAt: cooldown.nextAttemptAt,
    ...(sourceRunId && { sourceRunId }),
  };
}
