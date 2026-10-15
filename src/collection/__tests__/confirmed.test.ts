import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { normalizeForDedup } from "../../pipeline/dedup.js";
import { confirmSaved, loadConfirmed } from "../confirmed.js";

it("remembers confirmed URL variants across runs without re-querying a large feed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "confirmed-test-"));
  const path = join(dir, "confirmed.json");
  try {
    const known = await loadConfirmed(path);
    await confirmSaved(known, "https://www.example.com/post/?utm_source=rss", path);
    const restored = await loadConfirmed(path);
    expect(restored.has(normalizeForDedup("https://example.com/post"))).toBe(true);
    expect(restored.has(normalizeForDedup("https://example.com/other"))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
