import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

export interface PendingPage {
  pageId: string;
  title: string;
  url: string;
}
const PATH = ".runtime/enrichment.json";

export async function loadBacklog(): Promise<PendingPage[]> {
  try {
    const rows: unknown = JSON.parse(await readFile(PATH, "utf8"));
    if (!Array.isArray(rows)) throw new Error("Invalid enrichment checkpoint");
    return rows as PendingPage[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function saveBacklog(rows: PendingPage[]): Promise<void> {
  await mkdir(".runtime", { recursive: true });
  await writeFile(`${PATH}.tmp`, JSON.stringify(rows), "utf8");
  await rename(`${PATH}.tmp`, PATH);
}

export async function enqueuePage(
  article: { title: string; url: string },
  notionUrl: string
): Promise<void> {
  const id = notionUrl.replace(/-/g, "").match(/([a-f0-9]{32})(?:\?.*)?$/i)?.[1];
  if (!id) throw new Error("Notion page id missing from create response");
  const rows = await loadBacklog();
  if (!rows.some((row) => row.pageId === id)) {
    rows.push({ pageId: id, title: article.title, url: article.url });
    await saveBacklog(rows);
  }
}
