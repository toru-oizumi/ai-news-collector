import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { sealCheckpoint, validateCheckpoint } from "../../runtime/checkpoint.js";
import { migrateModelCooldown } from "../migrate-cooldown.js";

const run = {
  repository: "example/news",
  ref: "refs/heads/develop",
  sha: "test",
  runId: "123",
  attempt: 1,
  url: "local:test",
};
const rejected = "2026-10-18T10:57:01.167Z";
const until = "2026-10-18T16:57:01.167Z";
const now = Date.parse("2026-10-18T13:00:00Z");
const report = (failure: unknown = { operation: "model", httpStatus: 429 }) => ({
  schemaVersion: 1,
  stage: "enrich",
  run,
  startedAt: "2026-10-18T10:56:59Z",
  finishedAt: rejected,
  status: "failed",
  stats: {},
  failure,
});
async function fixture(body?: unknown, cooldown?: unknown) {
  const directory = await mkdtemp(join(tmpdir(), "cooldown-migrate-"));
  await writeFile(join(directory, "pending.json"), "[]");
  if (body !== undefined)
    await writeFile(join(directory, "enrich-report.json"), JSON.stringify(body));
  if (cooldown !== undefined)
    await writeFile(join(directory, "model-cooldown.json"), JSON.stringify(cooldown));
  await sealCheckpoint(directory, run);
  return directory;
}

it("migrates a sealed legacy rejection once, anchors to its recorded timestamp and remains expired later", async () => {
  const dir = await fixture(report());
  try {
    expect(await migrateModelCooldown(dir, run, now)).toEqual({
      status: "active",
      changed: true,
      nextAttemptAt: until,
      sourceRunId: "123",
    });
    await validateCheckpoint(dir, run);
    const original = await readFile(join(dir, "model-cooldown.json"), "utf8");
    const manifest = await readFile(join(dir, "checkpoint-manifest.json"), "utf8");
    expect(await migrateModelCooldown(dir, run, now + 3600000)).toMatchObject({
      status: "active",
      changed: false,
      nextAttemptAt: until,
    });
    expect(await migrateModelCooldown(dir, run, Date.parse(until))).toMatchObject({
      status: "expired",
      changed: false,
      nextAttemptAt: until,
    });
    expect(await readFile(join(dir, "model-cooldown.json"), "utf8")).toBe(original);
    expect(await readFile(join(dir, "checkpoint-manifest.json"), "utf8")).toBe(manifest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("does not interpret a historical model 429 inside a wait report as a new rejection", async () => {
  const wait = {
    ...report({
      operation: "wait",
      model: { stage: "model", reason: "http_error", httpStatus: 429 },
    }),
    finishedAt: "2026-10-18T12:59:00Z",
  };
  const dir = await fixture(wait, { schemaVersion: 1, nextAttemptAt: until });
  try {
    expect(await migrateModelCooldown(dir, run, now)).toEqual({
      status: "active",
      changed: false,
      nextAttemptAt: until,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("stops with missing evidence instead of assuming a legacy missing cooldown means permission to call", async () => {
  const dir = await fixture();
  try {
    expect(await migrateModelCooldown(dir, run, now)).toEqual({
      status: "missing_evidence",
      changed: false,
    });
    await expect(readFile(join(dir, "model-cooldown.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it.each([
  null,
  {},
  { schemaVersion: 2, nextAttemptAt: until },
  { schemaVersion: 1, nextAttemptAt: "invalid" },
])(
  "rejects corrupt sealed state without falling back to a fresh six-hour wait: %j",
  async (state) => {
    const dir = await fixture(report(), state);
    try {
      await expect(migrateModelCooldown(dir, run, now)).rejects.toThrow(
        "Invalid model cooldown checkpoint"
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
);

it("retains a longer existing deadline, including a date-only old file", async () => {
  const later = "2026-10-18T20:00:00Z";
  const dir = await fixture(report(), { schemaVersion: 1, nextAttemptAt: later });
  try {
    expect(await migrateModelCooldown(dir, run, now)).toMatchObject({
      status: "active",
      changed: false,
      nextAttemptAt: later,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("retains bounded Retry-After from a sealed actual rejection and rejects a future report", async () => {
  const body = report({
    operation: "model",
    httpStatus: 429,
    model: { stage: "model", reason: "http_error", httpStatus: 429, retryAfterSeconds: 86400 },
  });
  const dir = await fixture(body);
  try {
    expect(await migrateModelCooldown(dir, run, now)).toMatchObject({
      nextAttemptAt: "2026-10-19T10:57:01.167Z",
    });
    await expect(migrateModelCooldown(dir, run, Date.parse(rejected) - 60001)).rejects.toThrow(
      "Invalid model rejection report"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("migrates an already expired legacy rejection without starting a new wait", async () => {
  const dir = await fixture(report());
  try {
    expect(await migrateModelCooldown(dir, run, Date.parse(until) + 1000)).toMatchObject({
      status: "expired",
      changed: true,
      nextAttemptAt: until,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("keeps a precise newer report deadline instead of moving it to report completion plus six hours", async () => {
  const precise = "2026-10-18T16:57:00.000Z";
  const dir = await fixture(
    report({ operation: "model", httpStatus: 429, nextAttemptAt: precise })
  );
  try {
    expect(await migrateModelCooldown(dir, run, now)).toMatchObject({
      status: "active",
      nextAttemptAt: precise,
    });
    expect(await migrateModelCooldown(dir, run, now + 1000)).toMatchObject({
      changed: false,
      nextAttemptAt: precise,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
