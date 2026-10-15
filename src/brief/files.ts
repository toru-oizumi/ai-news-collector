import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { RunIdentity } from "../runtime/reports.js";
import { type BriefBundle, assertDeliverable, digest, renderBundle } from "./bundle.js";

export async function writeBriefFiles(directory: string, bundle: BriefBundle): Promise<void> {
  await mkdir(directory, { recursive: true });
  const json = `${JSON.stringify(bundle, null, 2)}\n`;
  const markdown = renderBundle(bundle);
  await writeFile(`${directory}/brief.json`, json, "utf8");
  await writeFile(`${directory}/brief.md`, markdown, "utf8");
  await writeFile(
    `${directory}/manifest.json`,
    JSON.stringify(
      {
        schemaVersion: 1,
        run: bundle.run,
        generatedAt: bundle.generatedAt,
        validUntil: bundle.validUntil,
        files: { "brief.json": digest(json), "brief.md": digest(markdown) },
      },
      null,
      2
    ),
    "utf8"
  );
}

export async function verifyBriefFiles(
  directory: string,
  run: RunIdentity,
  now: number
): Promise<BriefBundle> {
  const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, "utf8")) as {
    schemaVersion: number;
    files: Record<string, string>;
  };
  if (manifest.schemaVersion !== 1) throw new Error("Unknown brief manifest schema");
  for (const name of ["brief.json", "brief.md"]) {
    if (digest(await readFile(`${directory}/${name}`, "utf8")) !== manifest.files[name])
      throw new Error("Brief integrity check failed");
  }
  const bundle = JSON.parse(await readFile(`${directory}/brief.json`, "utf8")) as BriefBundle;
  assertDeliverable(bundle, run, now);
  return bundle;
}
