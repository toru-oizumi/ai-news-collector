import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { translateArticle } from "../digest/translator.js";
import { type TranslationCheckpoint, type TranslationInput, translateNext } from "./translation.js";

async function main(): Promise<void> {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath || !process.argv.includes("--execute"))
    throw new Error(
      "Usage: optional:translate -- <body.json> <translation.json> --execute (one chunk per invocation, no Notion writes)"
    );
  if (resolve(inputPath) === resolve(outputPath)) throw new Error("Input and output must differ");
  const input = JSON.parse(await readFile(inputPath, "utf8")) as TranslationInput;
  let checkpoint: TranslationCheckpoint | null = null;
  try {
    checkpoint = JSON.parse(await readFile(outputPath, "utf8")) as TranslationCheckpoint;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const translated = await translateNext(input, checkpoint, translateArticle);
  await writeFile(`${outputPath}.tmp`, JSON.stringify(translated, null, 2), "utf8");
  await rename(`${outputPath}.tmp`, outputPath);
  console.log(
    `Translation checkpoint saved locally. Complete: ${translated.complete}. No Notion append performed.`
  );
}
main().catch(() => {
  console.error(
    "Optional translation failed; check arguments, body and checkpoint. No automatic retry."
  );
  process.exitCode = 1;
});
