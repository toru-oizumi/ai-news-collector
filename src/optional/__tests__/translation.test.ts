import { describe, expect, it, vi } from "vitest";
import { translateNext, translationChunks } from "../translation.js";

describe("optional resumable full translation", () => {
  it("retains all input beyond the old 8,000-character truncation", async () => {
    const input = {
      title: "AI research",
      url: "https://example.com",
      paragraphs: ["a".repeat(9500)],
    };
    expect(translationChunks(input).join("")).toBe(input.paragraphs[0]);
    const translate = vi.fn(async (_title: string, paragraphs: string[]) => ({ paragraphs }));
    let state = await translateNext(input, null, translate);
    while (!state.complete) state = await translateNext(input, state, translate);
    expect(state.paragraphs.join("")).toBe(input.paragraphs[0]);
    expect(translate).toHaveBeenCalledTimes(4);
    await translateNext(input, state, translate);
    expect(translate).toHaveBeenCalledTimes(4);
  });
  it("does not advance or mutate a failed chunk and refuses changed source input", async () => {
    const input = {
      title: "AI research",
      url: "https://example.com",
      paragraphs: ["a".repeat(4000)],
    };
    const state = await translateNext(
      input,
      null,
      vi.fn().mockResolvedValue({ paragraphs: ["translated"] })
    );
    const original = structuredClone(state);
    await expect(
      translateNext(input, state, vi.fn().mockResolvedValue({ paragraphs: [] }))
    ).rejects.toThrow();
    expect(state).toEqual(original);
    await expect(translateNext({ ...input, title: "changed" }, state, vi.fn())).rejects.toThrow(
      "does not match"
    );
  });
});
