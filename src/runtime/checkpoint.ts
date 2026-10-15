import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { type RunIdentity, atomicJson, currentRun } from "./reports.js";

interface CheckpointManifest {
  schemaVersion: 1;
  generatedAt: string;
  run: RunIdentity;
  files: Record<string, string>;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export async function sealCheckpoint(directory = ".runtime", run = currentRun()): Promise<void> {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith(".json") && name !== "checkpoint-manifest.json")
    .sort();
  if (!names.includes("pending.json")) throw new Error("No raw queue checkpoint to seal");
  const files: Record<string, string> = {};
  for (const name of names) {
    const text = await readFile(`${directory}/${name}`, "utf8");
    JSON.parse(text); // corrupt JSON is never labelled a valid checkpoint
    files[name] = hash(text);
  }
  await atomicJson(`${directory}/checkpoint-manifest.json`, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    run,
    files,
  });
}
export async function validateCheckpoint(
  directory = ".runtime",
  run = currentRun()
): Promise<void> {
  const manifest = JSON.parse(
    await readFile(`${directory}/checkpoint-manifest.json`, "utf8")
  ) as CheckpointManifest;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.run.repository !== run.repository ||
    manifest.run.ref !== run.ref ||
    !manifest.files["pending.json"]
  )
    throw new Error("Checkpoint provenance does not match this repository/ref");
  const actual = (await readdir(directory))
    .filter((name) => name.endsWith(".json") && name !== "checkpoint-manifest.json")
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(manifest.files).sort()))
    throw new Error("Checkpoint file set mismatch");
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (name.includes("/") || name.includes("\\") || !name.endsWith(".json"))
      throw new Error("Invalid checkpoint filename");
    const text = await readFile(`${directory}/${name}`, "utf8");
    if (hash(text) !== expected) throw new Error("Checkpoint integrity check failed");
    JSON.parse(text);
  }
}
