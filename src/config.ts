import type { RSSSourceConfig, Source, SourceMeta } from "./types.js";

// ── Environment variables ──
export const env = {
  NOTION_API_KEY: process.env.NOTION_API_KEY ?? "",
  NOTION_DATABASE_ID: process.env.NOTION_DATABASE_ID ?? "",
  MISTRAL_API_KEY: process.env.MISTRAL_API_KEY ?? "",
  // Optional Slack delivery — when both are set, a digest is posted after the run.
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN ?? "",
  SLACK_CHANNEL_ID: process.env.SLACK_CHANNEL_ID ?? "",
  // Optional Qiita token — raises the API v2 rate limit from 60 to 1000 requests/hour.
  // The collector stays well under 60, so this is a safety margin, not a requirement.
  QIITA_TOKEN: process.env.QIITA_TOKEN ?? "",
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

// ── Japanese AI/ML keyword list (Phase A) ──
// Used to filter Japanese-language sources whose feeds carry general tech news.
// Matching lowercases both sides, so "生成AI" written here also matches "生成ai";
// Japanese has no case distinction, so no special normalization is needed.
// Short English terms are safe here because the \b word-boundary check in the
// shared matcher treats Japanese characters as non-word characters.
export const AI_KEYWORDS_JA = [
  "生成ai",
  "大規模言語モデル",
  "言語モデル",
  "機械学習",
  "深層学習",
  "ディープラーニング",
  "ニューラル",
  "拡散モデル",
  "画像生成",
  "動画生成",
  "音声認識",
  "マルチモーダル",
  "強化学習",
  "ファインチューニング",
  "埋め込み",
  "ベクトル検索",
  "エージェント",
  "プロンプト",
  "推論",
  // Terms that stay in Latin script even inside Japanese prose.
  "llm",
  "rag",
  "mcp",
  "claude",
  "gpt",
  "gemini",
  "transformer",
  "copilot",
  "openai",
  "anthropic",
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
  // smol.ai AINews — curated daily recap of AI Twitter/Discord/Reddit (TOR-47). Already
  // AI-focused (no keyword filter needed); one digest item per day, full-text descriptions.
  // The feed exposes 600+ historical recaps, so cap freshness to avoid surfacing stale items
  // (the collector runs daily; 7 days covers weekends / the occasional missed run).
  { name: "smol.ai", url: "https://news.smol.ai/rss.xml", maxAgeDays: 7 },
  // NOTE: GitHub Trending moved to a dedicated scraper (githubTrendingFetcher / Phase 2),
  // replacing the unofficial gh-pages RSS generator. See GITHUB_TRENDING_CONFIG below.
];

// ── Japanese sources (Phase A) ──
// Hatena Bookmark search feeds. /search/tag and /search/text both 301 to /q/, so we
// point at the redirect target directly (rss-parser follows one redirect by default,
// but relying on that is an unnecessary dependency). Feeds are RSS 1.0 (RDF): items
// expose bookmark counts via the hatena:bookmarkcount extension element and carry
// dc:date rather than pubDate.
export const HATENA_QUERIES = ["生成AI", "LLM", "Claude Code", "機械学習"];

/** Minimum bookmarks for a Hatena entry. Tag search is human-curated but still lets
 *  unrelated entries through, so the bookmark floor is the second filter after keywords. */
export const HATENA_MIN_BOOKMARKS = 10;

// Zenn topic feeds. Verified reachable: ai, llm, 生成ai, claudecode, machinelearning,
// nlp, chatgpt. These carry no like count — the unofficial /api/articles?order=daily
// endpoint exposes liked_count but is undocumented, so it is deliberately not used.
export const ZENN_TOPICS = ["llm", "生成ai", "claudecode", "ai"];

export const JP_RSS_SOURCES: RSSSourceConfig[] = [
  ...HATENA_QUERIES.map(
    (query): RSSSourceConfig => ({
      name: "Hatena",
      url: `https://b.hatena.ne.jp/q/${encodeURIComponent(query)}?sort=recent&mode=rss`,
      keywords: AI_KEYWORDS_JA,
      crowdField: "hatena:bookmarkcount",
      minCrowd: HATENA_MIN_BOOKMARKS,
      maxAgeDays: 7,
    })
  ),
  ...ZENN_TOPICS.map(
    (topic): RSSSourceConfig => ({
      name: "Zenn",
      url: `https://zenn.dev/topics/${encodeURIComponent(topic)}/feed`,
      maxAgeDays: 7,
    })
  ),
];

// ── Qiita (official API v2) ──
export const QIITA_CONFIG = {
  apiUrl: "https://qiita.com/api/v2/items",
  /** Tag queries. One request each, so keep the list short — the unauthenticated
   *  limit is 60 requests/hour (1000/hour with QIITA_TOKEN set).
   *  Tags were picked by measured yield within the freshness + LGTM filters:
   *  AIエージェント/生成AI/ClaudeCode/LLM/Gemini all produce hits, whereas
   *  MachineLearning and 自然言語処理 yielded zero (low traffic, stale backlog). */
  tags: ["AIエージェント", "生成AI", "ClaudeCode", "LLM", "Gemini"],
  /** 100 is the API maximum. The busy tags publish so fast that per_page=20 only
   *  reaches back a day or two — and posts that new have no LGTMs yet, so the
   *  minLikes floor rejected nearly everything. A wider window fixes that. */
  perPage: 100,
  /** Minimum LGTM count. Qiita has a long tail of near-zero-engagement posts. */
  minLikes: 3,
  /** Max articles kept across all tag queries (after dedup). */
  maxItems: 20,
  maxAgeDays: 7,
};

/** How many Japanese articles to push per run. They skip Mistral summarization, so this
 *  is independent of MISTRAL_CONFIG.maxSummarize and does not affect the token budget. */
export const JP_CONFIG = {
  maxPerRun: 15,
};

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

// ── Source classification (Phase A) ──
// Language and information tier per source, applied centrally by the scorer so fetchers
// stay unchanged. `satisfies Record<Source, SourceMeta>` makes a missing entry a compile
// error the moment a new Source is added — same guarantee as sourceWeights below.
//
// "primary"   = the lab / vendor / author publishing their own work (announcements, papers)
// "secondary" = someone writing about a primary source (commentary, tutorials, aggregation)
export const SOURCE_META = {
  OpenAI: { lang: "en", kind: "primary" },
  Anthropic: { lang: "en", kind: "primary" },
  DeepMind: { lang: "en", kind: "primary" },
  "Google AI": { lang: "en", kind: "primary" },
  "Meta AI": { lang: "en", kind: "primary" },
  NVIDIA: { lang: "en", kind: "primary" },
  arXiv: { lang: "en", kind: "primary" },
  HuggingFace: { lang: "en", kind: "primary" },
  Mistral: { lang: "en", kind: "primary" },
  xAI: { lang: "en", kind: "primary" },
  "AWS ML": { lang: "en", kind: "primary" },
  Ollama: { lang: "en", kind: "primary" },
  Qwen: { lang: "en", kind: "primary" },
  "Claude Code": { lang: "en", kind: "primary" },
  Cursor: { lang: "en", kind: "primary" },
  Windsurf: { lang: "en", kind: "primary" },
  "GitHub Blog": { lang: "en", kind: "primary" },
  LangChain: { lang: "en", kind: "primary" },
  Vercel: { lang: "en", kind: "primary" },
  // Aggregators and commentary — these point at primary sources rather than being one.
  "Hacker News": { lang: "en", kind: "secondary" },
  Lobsters: { lang: "en", kind: "secondary" },
  "GitHub Trending": { lang: "en", kind: "secondary" },
  "Simon Willison": { lang: "en", kind: "secondary" },
  "Latent Space": { lang: "en", kind: "secondary" },
  "Import AI": { lang: "en", kind: "secondary" },
  Changelog: { lang: "en", kind: "secondary" },
  "smol.ai": { lang: "en", kind: "secondary" },
  Hatena: { lang: "ja", kind: "secondary" },
  Qiita: { lang: "ja", kind: "secondary" },
  Zenn: { lang: "ja", kind: "secondary" },
} satisfies Record<Source, SourceMeta>;

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
    // Curated AI-Twitter/Discord recap (TOR-47) — practitioner-tier signal.
    "smol.ai": 60,
    // Japanese secondary sources (Phase A). Deliberately low: these are commentary on
    // primary announcements, so the crowd bonus — not the base weight — should decide
    // whether one outranks an arXiv paper or a vendor release note.
    Hatena: 25,
    Qiita: 20,
    // Zenn sits above minScore (30) on purpose: its topic feeds carry no crowd signal,
    // so base weight is the only score a Zenn article gets unless a bonus keyword hits.
    // At 25 every Zenn item would be filtered out and the source would be dead weight.
    // The topic feed itself is the relevance filter — an article in /topics/llm is on-topic.
    Zenn: 35,
  } satisfies Record<Source, number>,

  /** Bonus keywords (additive).
   *  Japanese equivalents are folded into the same rules as their English counterparts:
   *  without them, Japanese articles would collect no bonuses at all and rank purely on
   *  base weight plus crowd signal, leaving no way to tell a deep write-up from a tweet. */
  keywordBonus: [
    { keywords: ["gpt-5", "gpt-6", "claude", "gemini", "llama"], bonus: 20 },
    {
      keywords: ["agent", "agentic", "tool use", "function calling", "mcp", "エージェント"],
      bonus: 15,
    },
    {
      keywords: ["open source", "open-source", "weights released", "オープンソース", "重み公開"],
      bonus: 15,
    },
    // Practitioner / dev-tooling signal (Phase 1) — lifts hands-on content.
    {
      keywords: [
        "dev tool",
        "developer",
        "productivity",
        "observability",
        "workers",
        "d1",
        "r2",
        "実装",
        "検証",
        "試し",
        "入門",
        "解説",
        "開発",
      ],
      bonus: 12,
    },
    { keywords: ["rag", "retrieval", "検索拡張"], bonus: 10 },
    { keywords: ["safety", "alignment", "red team", "アライメント", "脆弱性"], bonus: 10 },
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
      // Hatena bookmark counts run a little below HN points for comparable reach;
      // Qiita LGTMs are smaller again, so both are scaled up before the log.
      Hatena: 1.5,
      Qiita: 4,
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
  /** conversations.history — list recent channel messages (find our digest parents). */
  historyUrl: "https://slack.com/api/conversations.history",
  /** conversations.replies — list a thread's replies (per-article messages + reactions). */
  repliesUrl: "https://slack.com/api/conversations.replies",
  /** Max articles included in the digest (posted as one threaded reply each). */
  topN: 10,
  /** Delay between per-article thread replies (ms) — chat.postMessage is ~1 msg/sec/channel. */
  replyDelayMs: 1_200,
  /** Prefix of the parent digest message's fallback text — used to recognize our own
   *  digests when scanning channel history for reactions. Keep in sync with postSlackDigest. */
  parentTextPrefix: "AI News Digest",
  /** How many days of channel history to scan for reactions (bounds the API calls). */
  reactionLookbackDays: 3,
  /** Emoji → article action mapping (Phase 5B). Checked "starred" first, then "read",
   *  so any strong-positive stamp wins over a plain "seen" stamp on the same message.
   *  Names are Slack reaction shortcodes without colons (aliases included generously so
   *  reactions aren't missed just because a different-but-equivalent emoji was used). */
  reactions: {
    // Strong positive / worth keeping → Starred.
    starred: [
      "star",
      "star2",
      "glowing_star",
      "stars",
      "sparkles",
      "fire",
      "100",
      "heart",
      "heart_eyes",
      "heartpulse",
      "tada",
      "clap",
      "raised_hands",
      "bookmark",
      "pushpin",
      "bulb",
    ],
    // Seen / acknowledged / processed → Read.
    read: [
      "white_check_mark",
      "heavy_check_mark",
      "ballot_box_with_check",
      "eyes",
      "eye",
      "+1",
      "thumbsup",
      "-1",
      "thumbsdown",
      "ok_hand",
      "ok",
      "pray",
    ],
  },
};
