import { describe, expect, it } from "vitest";
import { type TrendingRepo, isAiRepo, parseTrendingHtml, toArticle } from "../github-trending.js";

// Minimal fixture mirroring the real GitHub Trending markup (two repos).
const FIXTURE_HTML = `
<div>
  <article class="Box-row">
    <h2 class="h3 lh-condensed"><a href="/acme/llm-agent">acme / llm-agent</a></h2>
    <p class="col-9">An autonomous LLM agent framework.</p>
    <span itemprop="programmingLanguage">Python</span>
    <a href="/acme/llm-agent/stargazers">5,332</a>
    <span class="d-inline-block float-sm-right">371 stars today</span>
  </article>
  <article class="Box-row">
    <h2 class="h3 lh-condensed"><a href="/foo/coffee-timer">foo / coffee-timer</a></h2>
    <p class="col-9">A minimalist espresso brewing timer.</p>
    <span itemprop="programmingLanguage">Rust</span>
    <a href="/foo/coffee-timer/stargazers">1,200</a>
    <span class="d-inline-block float-sm-right">42 stars today</span>
  </article>
</div>
`;

function makeRepo(overrides: Partial<TrendingRepo> = {}): TrendingRepo {
  return {
    fullName: "acme/llm-agent",
    url: "https://github.com/acme/llm-agent",
    description: "An autonomous LLM agent framework.",
    language: "Python",
    periodStars: 371,
    totalStars: 5332,
    ...overrides,
  };
}

describe("parseTrendingHtml", () => {
  it("extracts repos with name, url, stars, and description", () => {
    const repos = parseTrendingHtml(FIXTURE_HTML);
    expect(repos).toHaveLength(2);

    const [first] = repos;
    expect(first.fullName).toBe("acme/llm-agent");
    expect(first.url).toBe("https://github.com/acme/llm-agent");
    expect(first.description).toBe("An autonomous LLM agent framework.");
    expect(first.periodStars).toBe(371);
    expect(first.totalStars).toBe(5332);
  });

  it("returns an empty array for markup with no rows", () => {
    expect(parseTrendingHtml("<div>no rows here</div>")).toEqual([]);
  });
});

describe("isAiRepo", () => {
  it("keeps repos whose name or description matches an AI keyword", () => {
    expect(isAiRepo(makeRepo())).toBe(true);
  });

  it("rejects unrelated repos", () => {
    expect(
      isAiRepo(
        makeRepo({
          fullName: "foo/coffee-timer",
          description: "A minimalist espresso brewing timer.",
        })
      )
    ).toBe(false);
  });

  it("matches short keywords on word boundaries only", () => {
    // "ai" must not match inside "maintain"
    expect(
      isAiRepo(makeRepo({ fullName: "foo/maintainer", description: "Maintain your changelog." }))
    ).toBe(false);
  });
});

describe("toArticle", () => {
  it("maps stars-gained to crowdScore and has no publish date", () => {
    const article = toArticle(makeRepo());
    expect(article.source).toBe("GitHub Trending");
    expect(article.title).toBe("acme/llm-agent");
    expect(article.crowdScore).toBe(371);
    expect(article.publishedAt).toBeNull();
  });

  it("falls back to total stars when no period stars", () => {
    expect(toArticle(makeRepo({ periodStars: 0, totalStars: 900 })).crowdScore).toBe(900);
  });
});
