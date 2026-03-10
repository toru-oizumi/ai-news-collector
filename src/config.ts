import type { RSSSourceConfig } from "./types.js";

// ── Environment variables ──
export const env = {
  NOTION_API_KEY: process.env.NOTION_API_KEY ?? "",
  NOTION_DATABASE_ID: process.env.NOTION_DATABASE_ID ?? "",
  MISTRAL_API_KEY: process.env.MISTRAL_API_KEY ?? "",
  DRY_RUN: process.argv.includes("--dry-run"),
} as const;

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
];

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
  titleKeywords: [
    "ai",
    "llm",
    "gpt",
    "claude",
    "gemini",
    "llama",
    "mistral",
    "language model",
    "machine learning",
    "neural",
    "transformer",
    "diffusion",
    "open source model",
    "agent",
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
  ],
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
    arXiv: 40,
    HuggingFace: 60,
    "Hacker News": 0, // uses HN score directly
    "GitHub Trending": 50,
    Mistral: 60,
    xAI: 60,
    "AWS ML": 40,
  } satisfies Record<string, number>,

  /** Bonus keywords (additive) */
  keywordBonus: [
    { keywords: ["gpt-5", "gpt-6", "claude", "gemini", "llama"], bonus: 20 },
    { keywords: ["agent", "agentic", "tool use", "function calling"], bonus: 15 },
    { keywords: ["open source", "open-source", "weights released"], bonus: 15 },
    { keywords: ["benchmark", "sota", "state-of-the-art"], bonus: 10 },
    { keywords: ["rag", "retrieval"], bonus: 10 },
    { keywords: ["safety", "alignment", "red team"], bonus: 10 },
  ],

  /** Minimum score to keep an article */
  minScore: 30,
};

// ── Mistral ──
export const MISTRAL_CONFIG = {
  model: "mistral-small-latest",
  apiUrl: "https://api.mistral.ai/v1/chat/completions",
  /** Max articles to summarise per run */
  maxSummarize: 80,
  /** Delay between requests (ms) — free tier is 2 RPM, so 31s interval */
  delayMs: 31_000, // ~1.9 RPM, safe under 2 RPM limit
};
