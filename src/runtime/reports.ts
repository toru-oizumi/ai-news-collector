import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

import type { EnrichmentFailure } from "../enrichment/runner.js";
import type { NotionDiagnostic } from "../notion/request-policy.js";

export interface RunIdentity {
  repository: string;
  ref: string;
  sha: string;
  runId: string;
  attempt: number;
  url: string;
}
export function currentRun(): RunIdentity {
  const repository = process.env.GITHUB_REPOSITORY ?? "local";
  const runId = process.env.GITHUB_RUN_ID ?? "local";
  return {
    repository,
    ref: process.env.GITHUB_REF ?? "local",
    sha: process.env.GITHUB_SHA ?? "local",
    runId,
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1),
    url: `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repository}/actions/runs/${runId}`,
  };
}
export interface StageReport {
  schemaVersion: 1;
  stage: "collect" | "enrich";
  run: RunIdentity;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "success" | "failed";
  stats: Record<string, number | boolean>;
  failure?: EnrichmentFailure | NotionDiagnostic;
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2), "utf8");
  await rename(`${path}.tmp`, path);
}
export async function loadReport(
  stage: StageReport["stage"],
  directory = ".runtime"
): Promise<StageReport | null> {
  try {
    return JSON.parse(await readFile(`${directory}/${stage}-report.json`, "utf8")) as StageReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function runReported(
  stage: StageReport["stage"],
  action: (report: StageReport) => Promise<void>,
  directory = ".runtime",
  run = currentRun()
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const report: StageReport = {
    schemaVersion: 1,
    stage,
    run,
    startedAt: new Date().toISOString(),
    status: "running",
    stats: {},
  };
  const path = `${directory}/${stage}-report.json`;
  await atomicJson(path, report);
  try {
    await action(report);
    report.status = "success";
  } catch (error) {
    report.status = "failed";
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await atomicJson(path, report);
  }
}
