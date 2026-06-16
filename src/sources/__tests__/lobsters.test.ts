import { describe, expect, it } from "vitest";
import { type LobstersStory, isAiStory, toArticle } from "../lobsters.js";

function makeStory(overrides: Partial<LobstersStory> = {}): LobstersStory {
  return {
    title: "Some story",
    url: "https://example.com/story",
    score: 10,
    comment_count: 3,
    description_plain: "",
    created_at: "2026-06-01T00:00:00.000-07:00",
    tags: [],
    ...overrides,
  };
}

describe("Lobsters isAiStory", () => {
  it("keeps stories with an AI tag", () => {
    expect(isAiStory(makeStory({ title: "Rewriting our parser", tags: ["ai", "compilers"] }))).toBe(
      true
    );
  });

  it("keeps stories whose title matches an AI keyword", () => {
    expect(isAiStory(makeStory({ title: "Building an LLM agent in Go", tags: ["go"] }))).toBe(true);
  });

  it("matches short keywords on word boundaries only", () => {
    // "ai" should not match inside "chain" / "maintain"
    expect(
      isAiStory(makeStory({ title: "Maintaining a chain of plugins", tags: ["devops"] }))
    ).toBe(false);
  });

  it("rejects unrelated stories", () => {
    expect(isAiStory(makeStory({ title: "A new espresso brewing method", tags: ["food"] }))).toBe(
      false
    );
  });
});

describe("Lobsters toArticle", () => {
  it("maps vote count onto crowdScore", () => {
    const a = toArticle(makeStory({ score: 42 }));
    expect(a.crowdScore).toBe(42);
    expect(a.source).toBe("Lobsters");
  });

  it("parses created_at into publishedAt and tolerates bad dates", () => {
    expect(toArticle(makeStory()).publishedAt).toBeInstanceOf(Date);
    expect(toArticle(makeStory({ created_at: "not-a-date" })).publishedAt).toBeNull();
  });
});
