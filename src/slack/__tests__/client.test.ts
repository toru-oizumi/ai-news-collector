import { describe, expect, it } from "vitest";
import type { Article } from "../../types.js";
import { type SlackBlock, buildDigestBlocks } from "../client.js";

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    title: "Introducing GPT-5.2",
    url: "https://openai.com/index/introducing-gpt-5-2",
    source: "OpenAI",
    category: ["LLM", "Agent"],
    score: 120,
    summary: "GPT-5.2 が公開されました。推論性能が向上しています。",
    publishedAt: null,
    fetchedAt: new Date(0),
    abstract: "OpenAI announced GPT-5.2 with improved reasoning.",
    ...overrides,
  };
}

/** Pull the mrkdwn text out of a section block. */
function sectionText(block: SlackBlock): string {
  const text = block.text as { text?: string } | undefined;
  return text?.text ?? "";
}

describe("buildDigestBlocks", () => {
  it("starts with a header, a context line, and a divider", () => {
    const blocks = buildDigestBlocks([makeArticle()], "2026-06-18", 1);
    expect(blocks[0].type).toBe("header");
    expect(blocks[1].type).toBe("context");
    expect(blocks[2].type).toBe("divider");
  });

  it("emits one section block per article", () => {
    const blocks = buildDigestBlocks([makeArticle(), makeArticle()], "2026-06-18", 2);
    const sections = blocks.filter((b) => b.type === "section");
    expect(sections).toHaveLength(2);
  });

  it("renders the title as a Slack link with source, score and summary", () => {
    const blocks = buildDigestBlocks([makeArticle()], "2026-06-18", 1);
    const text = sectionText(blocks[3]);
    expect(text).toContain("<https://openai.com/index/introducing-gpt-5-2|Introducing GPT-5.2>");
    expect(text).toContain("`OpenAI`");
    expect(text).toContain("score 120");
    expect(text).toContain("LLM / Agent");
    expect(text).toContain("GPT-5.2 が公開されました");
  });

  it("shows 'top N of total' in the context line when total exceeds the shown count", () => {
    const blocks = buildDigestBlocks([makeArticle()], "2026-06-18", 25);
    const ctx = blocks[1].elements as { text: string }[];
    expect(ctx[0].text).toBe("本日の新着 25 件から上位 1 件");
  });

  it("escapes mrkdwn special characters in the title and summary", () => {
    const blocks = buildDigestBlocks(
      [makeArticle({ title: "A <b> & <i> tag", summary: "x < y && y > z" })],
      "2026-06-18",
      1
    );
    const text = sectionText(blocks[3]);
    expect(text).toContain("A &lt;b&gt; &amp; &lt;i&gt; tag");
    expect(text).toContain("x &lt; y &amp;&amp; y &gt; z");
  });

  it("falls back to the abstract, then a placeholder, when there is no summary", () => {
    const withAbstract = buildDigestBlocks([makeArticle({ summary: "" })], "2026-06-18", 1);
    expect(sectionText(withAbstract[3])).toContain("OpenAI announced GPT-5.2");

    const withNothing = buildDigestBlocks(
      [makeArticle({ summary: "", abstract: "" })],
      "2026-06-18",
      1
    );
    expect(sectionText(withNothing[3])).toContain("(要約なし)");
  });

  it("handles an article with no categories", () => {
    const blocks = buildDigestBlocks([makeArticle({ category: [] })], "2026-06-18", 1);
    expect(sectionText(blocks[3])).toContain("· —");
  });
});
