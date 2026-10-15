import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { sealCheckpoint, validateCheckpoint } from "../checkpoint.js";
import { type RunIdentity, loadReport, runReported } from "../reports.js";

const run: RunIdentity = {
  repository: "test/repo",
  ref: "refs/heads/develop",
  sha: "abc",
  runId: "1",
  attempt: 1,
  url: "url",
};
it("seals a coherent state and rejects another repository/ref, changed or extra files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "checkpoint-test-"));
  try {
    await expect(validateCheckpoint(dir, run)).rejects.toThrow();
    await writeFile(join(dir, "pending.json"), "[]");
    await writeFile(join(dir, "enrichment.json"), "[]");
    await sealCheckpoint(dir, run);
    await validateCheckpoint(dir, { ...run, runId: "next-run" });
    await expect(validateCheckpoint(dir, { ...run, ref: "wrong" })).rejects.toThrow("provenance");
    await writeFile(join(dir, "pending.json"), "[1]");
    await expect(validateCheckpoint(dir, run)).rejects.toThrow("integrity");
    await sealCheckpoint(dir, run);
    await writeFile(join(dir, "unexpected.json"), "[]");
    await expect(validateCheckpoint(dir, run)).rejects.toThrow("file set");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("records failure with current run provenance and no raw exception contents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "report-test-"));
  try {
    await expect(
      runReported(
        "collect",
        async (report) => {
          report.stats.fetched = 65;
          throw new Error("sensitive-response-body");
        },
        dir,
        run
      )
    ).rejects.toThrow();
    const report = await loadReport("collect", dir);
    expect(report).toMatchObject({ status: "failed", run, stats: { fetched: 65 } });
    expect(JSON.stringify(report)).not.toContain("sensitive-response-body");
    expect(report?.finishedAt).toBeTruthy();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
