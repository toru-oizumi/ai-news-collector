import { describe, expect, it } from "vitest";
import { extractArticleUrl, reactionsToStatus } from "../reactions.js";

describe("reactionsToStatus", () => {
  it("maps star/bookmark to Starred", () => {
    expect(reactionsToStatus(["star"])).toBe("Starred");
    expect(reactionsToStatus(["bookmark"])).toBe("Starred");
  });

  it("maps read-type reactions to Read", () => {
    expect(reactionsToStatus(["white_check_mark"])).toBe("Read");
    expect(reactionsToStatus(["eyes"])).toBe("Read");
    expect(reactionsToStatus(["-1"])).toBe("Read");
  });

  it("prefers Starred when both star and read reactions are present", () => {
    expect(reactionsToStatus(["white_check_mark", "star"])).toBe("Starred");
  });

  it("returns null for unknown or no reactions", () => {
    expect(reactionsToStatus([])).toBeNull();
    expect(reactionsToStatus(["tada", "rocket"])).toBeNull();
  });
});

describe("extractArticleUrl", () => {
  it("extracts the first article link from a reply's mrkdwn", () => {
    const text =
      "*<https://openai.com/index/gpt-5-2|Introducing GPT-5.2>*\n`OpenAI` · score 120 · LLM · <https://www.notion.so/abc|Notion>\nbody";
    expect(extractArticleUrl(text)).toBe("https://openai.com/index/gpt-5-2");
  });

  it("returns null when there is no link", () => {
    expect(extractArticleUrl("no links here")).toBeNull();
  });

  it("does not pick up a bare (unlinked) URL", () => {
    expect(extractArticleUrl("see https://example.com for details")).toBeNull();
  });
});
