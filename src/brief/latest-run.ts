import type { RunIdentity } from "../runtime/reports.js";

export interface LatestRun {
  run: RunIdentity;
  status: string;
  conclusion: string | null;
}
/** This metadata must come from a fresh read of GitHub's newest run, not the bundle. */
export function requireCompletedLatest(value: LatestRun): RunIdentity {
  if (
    value.status !== "completed" ||
    !["success", "failure", "timed_out"].includes(value.conclusion ?? "") ||
    !value.run.runId ||
    !Number.isInteger(value.run.attempt) ||
    value.run.attempt < 1 ||
    !value.run.sha
  )
    throw new Error("Newest collection run is not usable");
  return value.run;
}
