// ── Normalized article schema ──
export interface Article {
  title: string;
  url: string;
  source: Source;
  category: Category[];
  score: number;
  summary: string; // Gemini-generated Japanese summary (empty if skipped)
  publishedAt: Date | null;
  fetchedAt: Date;
  abstract: string; // original abstract / description
}

export type Source =
  | "OpenAI"
  | "Anthropic"
  | "DeepMind"
  | "Google AI"
  | "Meta AI"
  | "NVIDIA"
  | "arXiv"
  | "HuggingFace"
  | "Hacker News"
  | "GitHub Trending"
  | "Mistral"
  | "xAI"
  | "AWS ML";

export type Category =
  | "LLM"
  | "Agent"
  | "RAG"
  | "Vision"
  | "RL"
  | "Multimodal"
  | "Code"
  | "Safety"
  | "Infrastructure"
  | "Open Source"
  | "Product"
  | "Research"
  | "Other";

// ── Fetcher interface ──
export interface Fetcher {
  name: string;
  fetch(): Promise<Article[]>;
}

// ── Config ──
export interface RSSSourceConfig {
  name: Source;
  url: string;
  /** Optional keyword filter — only include items matching any of these */
  keywords?: string[];
}
