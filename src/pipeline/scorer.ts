import { SCORE_CONFIG } from "../config.js";
import type { Article, Category } from "../types.js";

/**
 * Score and categorize articles.
 * Mutates the article objects in place and returns only those above threshold.
 */
export function scoreAndFilter(articles: Article[]): Article[] {
  for (const article of articles) {
    // HN articles already have a meaningful score (points)
    if (article.source === "Hacker News") {
      article.score = Math.min(article.score, 200); // cap
    } else {
      const base = SCORE_CONFIG.sourceWeights[article.source] ?? 30;
      const bonus = calcKeywordBonus(article);
      article.score = base + bonus;
    }

    // Auto-categorize
    article.category = categorize(article);
  }

  return articles.filter((a) => a.score >= SCORE_CONFIG.minScore).sort((a, b) => b.score - a.score);
}

function calcKeywordBonus(article: Article): number {
  const text = `${article.title} ${article.abstract}`.toLowerCase();
  let bonus = 0;

  for (const rule of SCORE_CONFIG.keywordBonus) {
    if (rule.keywords.some((kw) => text.includes(kw))) {
      bonus += rule.bonus;
    }
  }

  return bonus;
}

const CATEGORY_RULES: { keywords: string[]; category: Category }[] = [
  {
    keywords: ["llm", "language model", "gpt", "claude", "gemini", "llama", "mistral", "chatgpt"],
    category: "LLM",
  },
  { keywords: ["agent", "agentic", "tool use", "function calling", "mcp"], category: "Agent" },
  {
    keywords: ["rag", "retrieval augmented", "retrieval-augmented", "vector search", "embedding"],
    category: "RAG",
  },
  {
    keywords: ["vision", "image", "visual", "multimodal", "video", "diffusion"],
    category: "Vision",
  },
  { keywords: ["multimodal", "multi-modal", "audio", "speech", "voice"], category: "Multimodal" },
  { keywords: ["reinforcement learning", "rlhf", "reward model", "ppo", "dpo"], category: "RL" },
  {
    keywords: [
      "code",
      "coding",
      "copilot",
      "ide",
      "programming",
      "swe-bench",
      "cursor",
      "windsurf",
      "claude code",
      "codex",
      "qwen-coder",
    ],
    category: "Code",
  },
  {
    keywords: ["safety", "alignment", "red team", "jailbreak", "guardrail", "constitutional"],
    category: "Safety",
  },
  {
    keywords: ["inference", "gpu", "tpu", "quantization", "serving", "kubernetes", "deploy"],
    category: "Infrastructure",
  },
  {
    keywords: ["open source", "open-source", "weights", "apache", "mit license", "hugging face"],
    category: "Open Source",
  },
  {
    keywords: ["launch", "release", "announce", "available", "introducing", "new feature"],
    category: "Product",
  },
  {
    keywords: ["paper", "arxiv", "research", "study", "findings", "experiment"],
    category: "Research",
  },
];

function categorize(article: Article): Category[] {
  const text = `${article.title} ${article.abstract}`.toLowerCase();
  const cats = CATEGORY_RULES.filter((rule) => rule.keywords.some((kw) => text.includes(kw))).map(
    (rule) => rule.category
  );

  return cats.length > 0 ? [...new Set(cats)] : ["Other"];
}
