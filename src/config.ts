import type { RSSSourceConfig, Source } from "./types.js";

// ── Environment variables ──
export const env = {
  NOTION_API_KEY: process.env.NOTION_API_KEY ?? "",
  NOTION_DATABASE_ID: process.env.NOTION_DATABASE_ID ?? "",
  MISTRAL_API_KEY: process.env.MISTRAL_API_KEY ?? "",
  // Optional Slack delivery — when both are set, a digest is posted after the run.
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN ?? "",
  SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID ?? "",
  DRY_RUN: process.argv.includes("--dry-run"),
} as const;

// ── Shared AI/ML keyword list ──
// Used to filter general-interest sources (HN, Lobsters, Changelog, GitHub Trending)
// down to AI-relevant items. Keywords of 3 chars or fewer are matched as whole words.
export const AI_KEYWORDS = [
  "ai",
  "llm",
  "gpt",
  "claude",
  "gemini",
  "llama",
  "mistral",
  "qwen",
  "language model",
  "machine learning",
  "neural",
  "transformer",
  "diffusion",
  "open source model",
  "agent",
  "agentic",
  "mcp",
  "anthropic",
  "openai",
  "deepmind",
  "hugging face",
  "huggingface",
  "inference",
  "fine-tun",
  "rlhf",
  "embedding",
  "vector",
  "copilot",
  "prompt",
  "rag",
];

// ── RSS Sources (Tier 1 + Tier 2) ──
export const RSS_SOURCES: RSSSourceConfig[] = [
  // Tier 1: Major providers
  { name: "OpenAI", url: "https://openai.com/news/rss.xml" },
  { name: "DeepMind", url: "https://deepmind.google/blog/rss.xml" },
  { name: "Google AI", url: "https://blog.google/technology/ai/rss" },
  {
    name: "Meta AI",
    url: "https://research.facebook.com/feed/",
    keywords: ["ai", "llm", "language model", "machine learning", "neural", "transformer"],
  },
  { name: "arXiv", url: "https://rss.arxiv.org/rss/cs.AI" },
  { name: "arXiv", url: "https://rss.arxiv.org/rss/cs.CL" },
  { name: "arXiv", url: "https://rss.arxiv.org/rss/cs.LG" },

  // Tier 2: Infra / ecosystem
  {
    name: "NVIDIA",
    url: "https://blogs.nvidia.com/feed/",
    keywords: ["ai", "llm", "gpu", "inference", "training", "cuda", "tensor"],
  },
  { name: "AWS ML", url: "https://aws.amazon.com/blogs/ai/feed/" },

  // Tier 3: Model releases
  // Official Mistral AI blog feed (Phase 3 / TOR-42). Verified reachable again at
  // https://mistral.ai/rss.xml (the previously-removed /news/rss.xml and /feed.xml still 404).
  { name: "Mistral", url: "https://mistral.ai/rss.xml" },
  // xAI official x.ai blocks non-browser UAs (403), so we rely on the Olshansk mirror.
  {
    name: "xAI",
    url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_xainews.xml",
  },
  {
    name: "Ollama",
    url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_ollama.xml",
  },
  // NOTE: Pinned to QwenLM/Qwen3 repo. Update to the latest model repo
  // (e.g. Qwen4/releases.atom) when a new generation is released.
  { name: "Qwen", url: "https://github.com/QwenLM/Qwen3/releases.atom" },

  // Tier 3: AI coding tools
  {
    name: "Claude Code",
    url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_changelog_claude_code.xml",
  },
  {
    name: "Cursor",
    url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_cursor.xml",
  },
  {
    name: "Windsurf",
    url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_windsurf_blog.xml",
  },
  {
    name: "GitHub Blog",
    url: "https://github.blog/feed/",
    keywords: ["copilot", "ai", "code", "agent"],
  },

  // Tier 3: AI dev ecosystem
  { name: "LangChain", url: "https://blog.langchain.dev/rss/" },
  {
    name: "Vercel",
    url: "https://vercel.com/atom",
    keywords: ["ai", "v0", "sdk"],
  },

  // Tier 4: Practitioner / curation (added in Phase 1 to counter academic bias)
  // Personal blog of Simon Willison — high-signal LLM + dev tooling commentary.
  { name: "Simon Willison", url: "https://simonwillison.net/atom/everything/" },
  // Jack Clark's weekly AI newsletter (Substack standard feed).
  { name: "Import AI", url: "https://importai.substack.com/feed" },
  // AI engineering podcast/newsletter (Substack). NOTE: RSS may truncate body — verify in prod.
  { name: "Latent Space", url: "https://www.latent.space/feed" },
  // General dev/OSS — keyword-filtered to AI-relevant items. Feed URL to verify in first prod run.
  { name: "Changelog", url: "https://changelog.com/feed", keywords: AI_KEYWORDS },
  // NOTE: GitHub Trending moved to a dedicated scraper (githubTrendingFetcher / Phase 2),
  // replacing the unofficial gh-pages RSS generator. See GITHUB_TRENDING_CONFIG below.
];

// ── GitHub Trending (official site scrape — Phase 2, replaces unofficial gh-pages RSS) ──
export const GITHUB_TRENDING_CONFIG = {
  baseUrl: "https://github.com/trending",
  /** Languages to scan; "" = all languages. AI work concentrates in Python/TypeScript. */
  languages: ["", "python", "typescript"],
  /** Trending window. */
  since: "daily" as "daily" | "weekly" | "monthly",
  /** Max repos kept per language scan (before cross-language dedup). */
  maxItems: 20,
  /** Keep a repo only if its name/description matches a shared AI keyword. */
  keywords: AI_KEYWORDS,
};

// ── Anthropic (no official RSS — scrape from news + engineering pages) ──
export const ANTHROPIC_URLS = [
  "https://www.anthropic.com/news",
  "https://www.anthropic.com/engineering",
];

// ── Hacker News ──
export const HN_CONFIG = {
  /** Algolia HN Search API — filter AI/ML stories from the past 24h */
  searchUrl: "https://hn.algolia.com/api/v1/search",
  queries: ["LLM", "GPT", "Claude", "Gemini", "AI model", "transformer", "open source AI"],
  minScore: 50,
  maxItems: 30,
  /** Post-fetch title filter — article must contain at least one of these.
   *  Keywords of 3 chars or fewer are matched as whole words (\b boundary). */
  titleKeywords: AI_KEYWORDS,
};

// ── Lobsters ──
export const LOBSTERS_CONFIG = {
  /** Front-page "hottest" stories as JSON. Each story exposes a `score` (votes). */
  url: "https://lobste.rs/hottest.json",
  /** Keep only stories with at least this many votes. */
  minScore: 5,
  maxItems: 20,
  /** Lobsters tags that are inherently AI-relevant — story is kept if it carries any of these,
   *  OR if its title/description matches AI_KEYWORDS. */
  aiTags: ["ai", "ml", "nlp"],
};

// ── HuggingFace Daily Papers ──
export const HF_PAPERS_URL = "https://huggingface.co/api/daily_papers";

// ── Scoring weights ──
export const SCORE_CONFIG = {
  /** Base score per source */
  sourceWeights: {
    OpenAI: 80,
    Anthropic: 80,
    DeepMind: 70,
    "Google AI": 70,
    "Meta AI": 70,
    NVIDIA: 50,
    // Academic sources lowered in Phase 1 to counter research/SOTA bias.
    arXiv: 25,
    HuggingFace: 35,
    // Crowd-scored sources get a modest base; the crowd bonus does the ranking.
    "Hacker News": 20,
    Lobsters: 30,
    "GitHub Trending": 50,
    Mistral: 70,
    xAI: 60,
    "AWS ML": 40,
    Ollama: 50,
    Qwen: 60,
    "Claude Code": 70,
    Cursor: 60,
    Windsurf: 50,
    "GitHub Blog": 50,
    LangChain: 50,
    Vercel: 40,
    // Practitioner / curation sources (Phase 1)
    "Simon Willison": 65,
    "Latent Space": 60,
    "Import AI": 55,
    Changelog: 50,
  } satisfies Record<Source, number>,

  /** Bonus keywords (additive) */
  keywordBonus: [
    { keywords: ["gpt-5", "gpt-6", "claude", "gemini", "llama"], bonus: 20 },
    { keywords: ["agent", "agentic", "tool use", "function calling", "mcp"], bonus: 15 },
    { keywords: ["open source", "open-source", "weights released"], bonus: 15 },
    // Practitioner / dev-tooling signal (Phase 1) — lifts hands-on content.
    {
      keywords: ["dev tool", "developer", "productivity", "observability", "workers", "d1", "r2"],
      bonus: 12,
    },
    { keywords: ["rag", "retrieval"], bonus: 10 },
    { keywords: ["safety", "alignment", "red team"], bonus: 10 },
    // De-emphasize pure benchmark/SOTA framing (Phase 1: was +10, now neutral-ish).
    { keywords: ["benchmark", "sota", "state-of-the-art"], bonus: 5 },
  ],

  /** Crowd-signal normalization (Phase 1).
   *  crowdBonus = min(maxBonus, round(weight * log10(crowdScore * scale + 1)))
   *  Sources are on very different vote scales, so `scale` aligns them before the log. */
  crowd: {
    weight: 18,
    maxBonus: 60,
    /** Per-source multiplier applied before the log. Lobsters votes are ~1/5 of HN points;
     *  GitHub daily-star counts run larger than upvotes, so scale them down to stay comparable. */
    scale: {
      "Hacker News": 1,
      Lobsters: 5,
      "GitHub Trending": 0.5,
    } as Partial<Record<Source, number>>,
    defaultScale: 1,
  },

  /** Minimum score to keep an article */
  minScore: 30,

  /** Max articles kept per source in the final selection (Phase 1).
   *  Prevents a single high-volume, high-base source (e.g. OpenAI returns ~1000 items,
   *  all scoring 100+) from monopolizing the limited summarize slots and burying
   *  crowd-validated / practitioner content that scores just below it. */
  maxPerSource: 8,
};

// ── Mistral ──
export const MISTRAL_CONFIG = {
  model: "mistral-small-latest",
  apiUrl: "https://api.mistral.ai/v1/chat/completions",
  /** Max articles to summarise per run (50 x ~32s = ~27min, fits in 45min timeout) */
  maxSummarize: 50,
  /** Delay between requests (ms) — free tier is 2 RPM, so 31s interval */
  delayMs: 31_000, // ~1.9 RPM, safe under 2 RPM limit
};

// ── Slack (optional digest delivery via chat.postMessage) ──
export const SLACK_CONFIG = {
  apiUrl: "https://slack.com/api/chat.postMessage",
  /** Max articles included in the digest message (kept well under Slack's 50-block limit). */
  topN: 10,
};
