import { describe, expect, it } from "vitest";
import type { Article } from "../../types.js";
import { type SlackBlock, buildArticleReplyBlocks, buildDigestHeaderBlocks } from "../client.js";

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

describe("buildDigestHeaderBlocks", () => {
  it("emits a header followed by a context line", () => {
    const blocks = buildDigestHeaderBlocks("2026-06-18", 1, 1);
    expect(blocks[0].type).toBe("header");
    expect(blocks[1].type).toBe("context");
  });

  it("shows 'top N of total' in the context line when total exceeds the shown count", () => {
    const blocks = buildDigestHeaderBlocks("2026-06-18", 1, 25);
    const ctx = blocks[1].elements as { text: string }[];
    expect(ctx[0].text).toContain("本日の新着 25 件から上位 1 件");
  });

  it("shows a plain count when total equals the shown count", () => {
    const blocks = buildDigestHeaderBlocks("2026-06-18", 3, 3);
    const ctx = blocks[1].elements as { text: string }[];
    expect(ctx[0].text).toContain("本日の新着 3 件");
    expect(ctx[0].text).not.toContain("上位");
  });
});

describe("buildArticleReplyBlocks", () => {
  it("renders one section with the title as a link, source, score and summary", () => {
    const blocks = buildArticleReplyBlocks(makeArticle());
    expect(blocks).toHaveLength(1);
    const text = sectionText(blocks[0]);
    expect(text).toContain("<https://openai.com/index/introducing-gpt-5-2|Introducing GPT-5.2>");
    expect(text).toContain("`OpenAI`");
    expect(text).toContain("score 120");
    expect(text).toContain("LLM / Agent");
    expect(text).toContain("GPT-5.2 が公開されました");
  });

  it("puts the article URL first so it can be parsed back out for reaction matching", () => {
    const blocks = buildArticleReplyBlocks(
      makeArticle({ notionUrl: "https://www.notion.so/abc123" })
    );
    const text = sectionText(blocks[0]);
    // The first <...|...> link must be the article URL, not the Notion link.
    const first = text.match(/<(https?:\/\/[^|>]+)\|/);
    expect(first?.[1]).toBe("https://openai.com/index/introducing-gpt-5-2");
  });

  it("escapes mrkdwn special characters in the title and summary", () => {
    const blocks = buildArticleReplyBlocks(
      makeArticle({ title: "A <b> & <i> tag", summary: "x < y && y > z" })
    );
    const text = sectionText(blocks[0]);
    expect(text).toContain("A &lt;b&gt; &amp; &lt;i&gt; tag");
    expect(text).toContain("x &lt; y &amp;&amp; y &gt; z");
  });

  it("falls back to the abstract, then a placeholder, when there is no summary", () => {
    expect(sectionText(buildArticleReplyBlocks(makeArticle({ summary: "" }))[0])).toContain(
      "OpenAI announced GPT-5.2"
    );
    expect(
      sectionText(buildArticleReplyBlocks(makeArticle({ summary: "", abstract: "" }))[0])
    ).toContain("(要約なし)");
  });

  it("appends a Notion link when present and omits it otherwise", () => {
    expect(
      sectionText(
        buildArticleReplyBlocks(makeArticle({ notionUrl: "https://www.notion.so/abc" }))[0]
      )
    ).toContain("· <https://www.notion.so/abc|Notion>");
    expect(sectionText(buildArticleReplyBlocks(makeArticle())[0])).not.toContain("|Notion>");
  });

  it("handles an article with no categories", () => {
    expect(sectionText(buildArticleReplyBlocks(makeArticle({ category: [] }))[0])).toContain("· —");
  });
});
