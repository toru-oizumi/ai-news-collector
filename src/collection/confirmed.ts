import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeForDedup } from "../pipeline/dedup.js";

const PATH = ".runtime/confirmed.json";

export async function loadConfirmed(path = PATH): Promise<Set<string>> {
  try {
    const rows: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(rows) || !rows.every((row) => typeof row === "string"))
      throw new Error("Invalid confirmed-URL checkpoint");
    return new Set(rows);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }
}

/** Call only AFTER raw save and enrichment enqueue have both been confirmed. */
export async function confirmSaved(known: Set<string>, url: string, path = PATH): Promise<void> {
  known.add(normalizeForDedup(url));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify([...known]), "utf8");
  await rename(`${path}.tmp`, path);
}
