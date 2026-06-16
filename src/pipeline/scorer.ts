import { SCORE_CONFIG } from "../config.js";
import type { Article, Category } from "../types.js";

/**
 * Score and categorize articles.
 * Mutates the article objects in place and returns only those above threshold.
 */
export function scoreAndFilter(articles: Article[]): Article[] {
  for (const article of articles) {
    // Unified composition: base source weight + keyword bonus + normalized crowd signal.
    const base = SCORE_CONFIG.sourceWeights[article.source] ?? 30;
    const bonus = calcKeywordBonus(article);
    const crowd = calcCrowdBonus(article);
    article.score = base + bonus + crowd;

    // Auto-categorize
    article.category = categorize(article);
  }

  return articles.filter((a) => a.score >= SCORE_CONFIG.minScore).sort((a, b) => b.score - a.score);
}

/**
 * Pick up to `limit` articles for downstream processing while keeping source variety.
 * Caps each source to `maxPerSource` so one high-volume source (e.g. OpenAI's ~1000
 * items, all scoring 100+) can't fill every slot and bury crowd/practitioner content
 * that scores just below it. Falls back to filling remaining slots ignoring the cap
 * if too few sources are present. Input is assumed already sorted by score descending.
 */
export function selectDiverse(
  articles: Article[],
  limit: number,
  maxPerSource = SCORE_CONFIG.maxPerSource
): Article[] {
  const perSource = new Map<string, number>();
  const picked: Article[] = [];
  const overflow: Article[] = [];

  for (const article of articles) {
    if (picked.length >= limit) break;
    const count = perSource.get(article.source) ?? 0;
    if (count < maxPerSource) {
      perSource.set(article.source, count + 1);
      picked.push(article);
    } else {
      overflow.push(article);
    }
  }

  // If the per-source cap left us short of `limit`, top up with the highest-scoring
  // leftovers (still in score order) so we never under-fill the available slots.
  for (const article of overflow) {
    if (picked.length >= limit) break;
    picked.push(article);
  }

  return picked.sort((a, b) => b.score - a.score);
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

/**
 * Normalize a source's crowd signal (votes/points) into score points.
 * Uses a log scale so a 10x vote difference does not 10x the score, and a
 * per-source scale so HN points and Lobsters scores are comparable.
 */
export function calcCrowdBonus(article: Article): number {
  const raw = article.crowdScore;
  if (raw === undefined || raw <= 0) return 0;

  const { weight, maxBonus, scale, defaultScale } = SCORE_CONFIG.crowd;
  const sourceScale = scale[article.source] ?? defaultScale;
  const bonus = Math.round(weight * Math.log10(raw * sourceScale + 1));
  return Math.min(maxBonus, bonus);
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
