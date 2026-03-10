import { describe, expect, it } from "vitest";
import { HN_CONFIG } from "../../config.js";

// titleKeywords フィルタのロジック (hackernews.ts と同じ実装)
function isAiRelated(title: string): boolean {
  const titleLower = ` ${title.toLowerCase()} `;
  return HN_CONFIG.titleKeywords.some((kw) =>
    kw.length <= 3 ? new RegExp(`\\b${kw}\\b`).test(titleLower) : titleLower.includes(kw)
  );
}

describe("HN title filter", () => {
  it("passes AI-related titles", () => {
    expect(isAiRelated("New GPT-5 model released by OpenAI")).toBe(true);
    expect(isAiRelated("Claude 4 achieves SOTA on benchmarks")).toBe(true);
    expect(isAiRelated("Open source LLM outperforms GPT-4")).toBe(true);
    expect(isAiRelated("Anthropic releases new agent framework")).toBe(true);
    expect(isAiRelated("Hugging Face launches new inference API")).toBe(true);
  });

  it("rejects non-AI titles", () => {
    expect(isAiRelated("Building a Procedural Hex Map with Wave Function Collapse")).toBe(false);
    expect(isAiRelated("Fixfest is a global gathering of repairers and tinkerers")).toBe(false);
    expect(isAiRelated("Kuwaiti F/A-18's Triple Friendly Fire Shootdown")).toBe(false);
    expect(isAiRelated("So you want to write an app (2025)")).toBe(false);
    expect(isAiRelated("Show HN: The Mog Programming Language")).toBe(false);
  });
});
