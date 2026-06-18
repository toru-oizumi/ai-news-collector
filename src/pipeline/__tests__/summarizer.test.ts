import { describe, expect, it } from "vitest";
import { extractSummary } from "../summarizer.js";

describe("extractSummary", () => {
  it("parses a bare JSON object", () => {
    expect(extractSummary('{"summary": "新しいモデルが公開されました。"}')).toBe(
      "新しいモデルが公開されました。"
    );
  });

  it("strips a ```json code fence", () => {
    const raw = '```json\n{"summary": "要約テキスト。"}\n```';
    expect(extractSummary(raw)).toBe("要約テキスト。");
  });

  it("strips a bare ``` fence (regression: old regex only matched ```json)", () => {
    const raw = '```\n{"summary": "フェンス付きの要約。"}\n```';
    expect(extractSummary(raw)).toBe("フェンス付きの要約。");
  });

  it("extracts JSON even when surrounded by stray prose", () => {
    const raw = 'Here is the summary:\n{"summary": "本文。"}\nHope this helps!';
    expect(extractSummary(raw)).toBe("本文。");
  });

  it("trims whitespace inside the summary value", () => {
    expect(extractSummary('{"summary": "  前後の空白  "}')).toBe("前後の空白");
  });

  it("falls back to plain text when the response is not JSON", () => {
    const raw = "これはJSONではない通常の要約文です。";
    expect(extractSummary(raw)).toBe("これはJSONではない通常の要約文です。");
  });

  it("returns null for empty or too-short responses", () => {
    expect(extractSummary("")).toBeNull();
    expect(extractSummary("   ")).toBeNull();
    expect(extractSummary("短い")).toBeNull();
  });

  it("returns null when JSON has an empty summary field", () => {
    expect(extractSummary('{"summary": ""}')).toBeNull();
  });

  it("recovers the text from a JSON response truncated mid-string", () => {
    // max_tokens cut the completion off before the closing quote/brace.
    const raw = '{"summary": "新モデルが公開され、推論速度が向上しました。詳細は';
    expect(extractSummary(raw)).toBe("新モデルが公開され、推論速度が向上しました。詳細は");
  });

  it("unescapes quotes when recovering a truncated summary", () => {
    const raw = '{"summary": "\\"Vibe\\" が登場';
    expect(extractSummary(raw)).toBe('"Vibe" が登場');
  });

  it("never leaks JSON scaffolding as the summary", () => {
    // Broken JSON-like text with no recoverable summary field → null, not the braces.
    expect(extractSummary('{"foo": "bar"')).toBeNull();
  });

  it("caps an overly long plain-text fallback at 500 chars", () => {
    const long = "あ".repeat(800);
    expect(extractSummary(long)?.length).toBe(500);
  });
});
