import { readFile } from "node:fs/promises";
import { renderBrief } from "./brief/render.js";
import type { ExportedArticle } from "./notion/client.js";

const path = process.argv[2];
if (!path || path.startsWith("--")) {
  console.error("Usage: npm run brief -- <local-snapshot.json> [--include-unverified-summaries]");
  process.exitCode = 1;
} else {
  try {
    const rows = JSON.parse(await readFile(path, "utf8")) as ExportedArticle[];
    if (!Array.isArray(rows)) throw new Error("Expected an article array");
    console.log(renderBrief(rows, process.argv.includes("--include-unverified-summaries")));
  } catch {
    console.error("Could not read article snapshot; use the export:web JSON format");
    process.exitCode = 1;
  }
}
