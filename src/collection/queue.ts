import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeForDedup } from "../pipeline/dedup.js";
import type { Article, ArticleSaveResult } from "../types.js";

const QUEUE_PATH = ".runtime/pending.json";

export async function loadPending(path = QUEUE_PATH): Promise<Article[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  // Corrupt checkpoints must fail visibly, never silently discard unsaved items.
  const rows = JSON.parse(text) as Article[];
  if (!Array.isArray(rows)) throw new Error("Invalid collection checkpoint");
  return rows.map((row) => ({
    ...row,
    publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
    fetchedAt: new Date(row.fetchedAt),
  }));
}

export async function savePending(articles: Article[], path = QUEUE_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(articles), "utf8");
  await rename(`${path}.tmp`, path);
}

/** Dependencies make the entire failure/replay path testable without credentials. */
export async function collectPending(
  articles: Article[],
  options: {
    save: (article: Article) => Promise<ArticleSaveResult | null>;
    checkpoint: (pending: Article[]) => Promise<void>;
    deadline: number;
    now?: () => number;
  }
): Promise<{ saved: number; existing: number; pending: number }> {
  const now = options.now ?? Date.now;
  let pending = articles;
  const result = { saved: 0, existing: 0, pending: 0 };
  await options.checkpoint(pending);
  for (const article of [...pending]) {
    // Reserve time for the final Notion request/checkpoint and CI cache upload.
    if (now() + 90_000 >= options.deadline) break;
    let saved: ArticleSaveResult | null = null;
    try {
      saved = await options.save(article);
    } catch {
      // Keep this item; other candidates can still be saved.
    }
    if (saved !== null) {
      if (saved.outcome === "existing") result.existing++;
      else result.saved++;
      const key = normalizeForDedup(article.url);
      pending = pending.filter((a) => normalizeForDedup(a.url) !== key);
      await options.checkpoint(pending);
    }
  }
  result.pending = pending.length;
  return result;
}
