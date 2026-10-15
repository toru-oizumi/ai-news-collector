import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Article } from "../../types.js";
import { collectPending, loadPending, savePending } from "../queue.js";

const article = (id: number): Article => ({
  title: `Article ${id}`,
  url: `https://example.com/${id}`,
  source: "OpenAI",
  category: [],
  score: 50,
  summary: "",
  publishedAt: null,
  fetchedAt: new Date("2026-10-15T00:00:00Z"),
  abstract: "Raw evidence",
});

describe("collection checkpoint", () => {
  it("saves all 65 articles without depending on a model", async () => {
    const save = vi.fn().mockResolvedValue("notion-url");
    const checkpoint = vi.fn();
    const result = await collectPending(
      Array.from({ length: 65 }, (_, i) => article(i)),
      new Set(),
      { save, checkpoint, deadline: 480_000, now: () => 0 }
    );
    expect(result).toEqual({ saved: 65, existing: 0, pending: 0 });
    expect(save).toHaveBeenCalledTimes(65);
    expect(checkpoint).toHaveBeenLastCalledWith([]);
  });

  it("retains failed saves and completes other articles; replay only saves the remainder", async () => {
    let pending: Article[] = [];
    const checkpoint = async (rows: Article[]) => {
      pending = rows;
    };
    const result = await collectPending([article(1), article(2), article(3)], new Set(), {
      save: async (a) => {
        if (a.url.endsWith("/2")) throw new Error("connection reset");
        return "saved";
      },
      checkpoint,
      deadline: 480_000,
      now: () => 0,
    });
    expect(result).toMatchObject({ saved: 2, pending: 1 });
    expect(pending.map((a) => a.url)).toEqual([article(2).url]);
    const replay = vi.fn().mockResolvedValue("saved");
    await collectPending(pending, new Set(), {
      save: replay,
      checkpoint,
      deadline: 480_000,
      now: () => 0,
    });
    expect(replay).toHaveBeenCalledTimes(1);
    expect(pending).toEqual([]);
  });

  it("stops before its deadline and retains untouched articles", async () => {
    const save = vi.fn();
    const checkpoint = vi.fn();
    expect(
      await collectPending([article(1)], new Set(), {
        save,
        checkpoint,
        deadline: 90_000,
        now: () => 1,
      })
    ).toMatchObject({ pending: 1 });
    expect(save).not.toHaveBeenCalled();
    expect(checkpoint).toHaveBeenCalledWith([article(1)]);
  });

  it("reconciles an already committed create before dropping its checkpoint entry", async () => {
    const save = vi.fn().mockResolvedValue("existing-page");
    const result = await collectPending([article(1)], new Set([article(1).url]), {
      save,
      checkpoint: vi.fn(),
      deadline: 480_000,
      now: () => 0,
    });
    expect(save).toHaveBeenCalledTimes(1); // repairs enrichment enqueue after a crash
    expect(result).toMatchObject({ existing: 1, pending: 0 });
  });

  it("round trips dates atomically and rejects a corrupt checkpoint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "news-test-"));
    const path = join(dir, "pending.json");
    try {
      expect(await loadPending(path)).toEqual([]);
      await savePending([article(1)], path);
      expect(await loadPending(path)).toEqual([article(1)]);
      await writeFile(path, "broken json");
      await expect(loadPending(path)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
