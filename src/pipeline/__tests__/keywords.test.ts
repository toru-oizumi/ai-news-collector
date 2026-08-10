import { describe, expect, it } from "vitest";
import { matchesKeyword } from "../keywords.js";

describe("matchesKeyword", () => {
  it("matches a long keyword as a substring", () => {
    expect(matchesKeyword("A new language model release", ["language model"])).toBe(true);
  });

  it("matches long keywords as prefixes so 'fine-tun' covers both spellings", () => {
    expect(matchesKeyword("Fine-tuning at scale", ["fine-tun"])).toBe(true);
    expect(matchesKeyword("Fine-tuned on 400 examples", ["fine-tun"])).toBe(true);
  });

  it("is case insensitive on both sides", () => {
    expect(matchesKeyword("ANTHROPIC ships MCP", ["anthropic"])).toBe(true);
    expect(matchesKeyword("anthropic ships mcp", ["Anthropic"])).toBe(true);
  });

  it("requires word boundaries for short keywords", () => {
    // These are the substring false positives the boundary check exists to stop.
    expect(matchesKeyword("Object storage pricing", ["rag"])).toBe(false);
    expect(matchesKeyword("Now available in Tokyo", ["ai"])).toBe(false);
    expect(matchesKeyword("How to maintain a monorepo", ["ai"])).toBe(false);
  });

  it("still matches short keywords standing alone", () => {
    expect(matchesKeyword("AI safety research", ["ai"])).toBe(true);
    expect(matchesKeyword("Improving RAG recall", ["rag"])).toBe(true);
    expect(matchesKeyword("gpt", ["gpt"])).toBe(true);
  });

  it("matches a short keyword at the very start or end of the text", () => {
    expect(matchesKeyword("AI", ["ai"])).toBe(true);
    expect(matchesKeyword("the future of ai", ["ai"])).toBe(true);
  });

  it("treats Japanese characters as boundaries for Latin keywords", () => {
    // JavaScript's \b is defined against [A-Za-z0-9_], so a Japanese character next
    // to a Latin keyword counts as a boundary. This is what lets short English terms
    // stay in AI_KEYWORDS_JA.
    expect(matchesKeyword("生成AIが変えた開発", ["ai"])).toBe(true);
    expect(matchesKeyword("LLMの量子化について", ["llm"])).toBe(true);
    expect(matchesKeyword("RAGを実装する", ["rag"])).toBe(true);
  });

  it("matches Japanese keywords", () => {
    expect(matchesKeyword("大規模言語モデルの評価", ["大規模言語モデル"])).toBe(true);
    expect(matchesKeyword("機械学習の基礎", ["深層学習", "機械学習"])).toBe(true);
    expect(matchesKeyword("営業職はいずれ消える", ["生成ai", "機械学習"])).toBe(false);
  });

  it("matches a keyword written with uppercase Latin inside Japanese text", () => {
    // AI_KEYWORDS_JA stores "生成ai"; real titles write "生成AI".
    expect(matchesKeyword("とんでもない動画生成AIが出てきた", ["生成ai"])).toBe(true);
  });

  it("returns false for an empty keyword list", () => {
    expect(matchesKeyword("anything", [])).toBe(false);
  });

  it("ignores empty keywords instead of matching everything", () => {
    expect(matchesKeyword("unrelated text", [""])).toBe(false);
  });

  it("does not let regex metacharacters in a short keyword corrupt the pattern", () => {
    // Without escaping, "c++" would be an invalid quantifier and throw.
    expect(() => matchesKeyword("some text", ["c++"])).not.toThrow();
    expect(matchesKeyword("writing c++ bindings", ["c++"])).toBe(true);
    expect(matchesKeyword("a.c", ["a.c"])).toBe(true);
    expect(matchesKeyword("abc", ["a.c"])).toBe(false);
  });
});
