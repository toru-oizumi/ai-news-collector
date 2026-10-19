import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type ModelFailure, safeModelFailure } from "../digest/failures.js";
import { atomicJson } from "../runtime/reports.js";

const PATH = ".runtime/model-cooldown.json";

/** Missing on older checkpoints; malformed state must not silently enable calls. */
export interface ModelCooldown {
  nextAttemptAt: string;
  failure?: ModelFailure;
}

export async function loadModelCooldownState(path = PATH): Promise<ModelCooldown | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (
      value?.schemaVersion !== 1 ||
      typeof value.nextAttemptAt !== "string" ||
      !Number.isFinite(Date.parse(value.nextAttemptAt))
    )
      throw new Error("Invalid model cooldown checkpoint");
    return { nextAttemptAt: value.nextAttemptAt, failure: safeModelFailure(value.failure) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function loadModelCooldown(path = PATH): Promise<number> {
  const state = await loadModelCooldownState(path);
  return state ? Date.parse(state.nextAttemptAt) : 0;
}

/** Persist before the Notion state write, so its failure cannot reopen the circuit. */
export async function saveModelCooldown(
  nextAttemptAt: string,
  path = PATH,
  failure?: ModelFailure
): Promise<void> {
  if (!Number.isFinite(Date.parse(nextAttemptAt))) throw new Error("Invalid model retry time");
  const previous = await loadModelCooldownState(path);
  const until = Math.max(Date.parse(nextAttemptAt), Date.parse(previous?.nextAttemptAt ?? "") || 0);
  // A shorter observation must not replace the cause associated with the longer deadline.
  const cause =
    previous && Date.parse(previous.nextAttemptAt) >= Date.parse(nextAttemptAt)
      ? previous.failure
      : safeModelFailure(failure);
  await mkdir(dirname(path), { recursive: true });
  await atomicJson(path, {
    schemaVersion: 1,
    nextAttemptAt: new Date(until).toISOString(),
    ...(cause && { failure: cause }),
  });
}
