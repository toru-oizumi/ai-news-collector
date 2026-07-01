# AI News Collector

Automatically collects the latest AI/ML news and stores it in a Notion Database.
Runs two daily jobs: **collect** (fetch & summarize) and **digest** (detailed analysis + full translation).

## Architecture

```text
[Job 1: collect]  every 6h (00:00 / 06:00 / 12:00 / 18:00 UTC)
├─ Sync Slack reactions → Notion Status (⭐→Starred, ✅/👀/👎→Read; best-effort)
├─ Fetch (parallel)
│  ├─ RSS: OpenAI, DeepMind, Google AI, Meta AI, NVIDIA, AWS, arXiv,
│  │        + practitioner: Simon Willison, Import AI, Latent Space, Changelog, GitHub Trending
│  ├─ HTML Scrape: Anthropic (news + engineering)
│  └─ API: Hacker News (Algolia), HuggingFace Daily Papers, Lobsters (hottest.json)
├─ Dedup (URL normalization; crowd-backed duplicate wins)
├─ Score & Categorize (source weight + keyword bonus + normalized crowd score)
├─ Notion Dedup (exclude existing URLs)
├─ Select (per-source cap so one high-volume source can't fill every slot)
├─ Summarize (Mistral Small → short Japanese summary, 2-3 sentences)
├─ Push to Notion Database (Status: "Unread")
└─ Post digest to Slack (parent message + one threaded reply per article)

[Job 2: digest]  2h after each collect run
├─ Query Notion (Status="Unread", top 30 by Score)
├─ Fetch article body (cheerio HTML scraper)
├─ Generate Digest (Mistral → Japanese summary 400-600 chars + Key Points)
├─ Translate (Mistral → full Japanese translation)
├─ Write to Notion page body:
│     📝 Digest
│     ■ Key Points
│     ─────────
│     🇯🇵 日本語全文訳
└─ Update Status: "Unread" → "Digested"
```

## Setup

### 1. Notion

1. Create a [Notion Integration](https://www.notion.so/my-integrations) and copy the API Key.
2. Create a new Notion Database with the following properties:

| Property | Type | Notes |
|---|---|---|
| Title | Title | Default title column |
| URL | URL | |
| Source | Select | |
| Category | Multi-select | |
| Score | Number | |
| Summary | Rich text | Short 2-3 sentence summary (Job 1) |
| Published | Date | |
| Fetched | Date | |
| Status | Select | **Unread** / **Digested** / Read / Starred |

1. Connect the Integration to the Database (••• → Connections → add your Integration).
1. Copy the Database ID from the URL: `https://www.notion.so/<DATABASE_ID>?v=...`

> **Note:** Add **"Digested"** as a Status option so Job 2 can update processed articles.

### 2. Mistral API

Get a free API Key from [Mistral AI Console](https://console.mistral.ai/) → API Keys (no credit card required).

### 3. GitHub

1. Fork this repo (or create a private repo).
2. Add the following secrets under Settings → Secrets and variables → Actions:
   - `NOTION_API_KEY`
   - `NOTION_DATABASE_ID`
   - `MISTRAL_API_KEY`

### 4. Slack (optional)

Set `SLACK_BOT_TOKEN` and `SLACK_CHANNEL_ID` (both) to post a digest after each collect run
and to sync reactions back to Notion. Leave them unset to disable.

- **Bot Token Scopes**: `chat:write` (post), `channels:history` (or `groups:history` for a
  private channel), `reactions:read` (read reactions). Invite the bot to the target channel.
- The digest is posted as a **parent message + one threaded reply per article**, so reactions
  land on individual articles.
- **React to curate** — the next collect run reflects reactions into Notion Status:

  | Reaction | Notion Status |
  |---|---|
  | ⭐ `:star:` / 🔖 `:bookmark:` | **Starred** |
  | ✅ `:white_check_mark:` / 👀 `:eyes:` / 👎 `:-1:` | **Read** |

  Reactions only advance status forward (`Unread`/`Digested` → `Read` → `Starred`); a status you
  set manually is never overwritten.

### 5. Local Setup

```bash
# Install Node.js 24 via mise
mise install

# Install dependencies
npm install

# Copy env file and fill in your credentials
cp .env.example .env

# Dry run (no Notion/Mistral calls)
npm run collect:dry

# Full collect run
npm run collect

# Digest + translate run (requires Notion articles with Status="Unread")
npm run digest
```

## Development

```bash
npm test            # vitest watch mode
npm run test:run    # run once
npm run check:fix   # lint + format (Biome)
npm run typecheck   # TypeScript type check
```

VS Code: open **Run and Debug** (⇧⌘D) and select `collect: dry-run` to debug with breakpoints.

## Customization

### Adding / Removing Sources

Edit `RSS_SOURCES` in `src/config.ts`. You can add keyword filters:

```ts
{ name: "NVIDIA", url: "https://blogs.nvidia.com/feed/", keywords: ["ai", "llm"] }
```

### Scoring

Edit `SCORE_CONFIG` in `src/config.ts`:

- `sourceWeights`: base score per source
- `keywordBonus`: bonus on keyword match
- `crowd`: how vote counts (HN points, Lobsters score) are normalized into the score
  (`crowdBonus = min(maxBonus, weight × log10(crowdScore × scale + 1))`)
- `minScore`: filter threshold
- `maxPerSource`: cap on how many articles a single source contributes to the
  final summarize set, so a high-volume source (e.g. OpenAI returns ~1000 items)
  can't monopolize every slot and bury lower-scoring practitioner/crowd content

Crowd-scored sources (Hacker News, Lobsters) expose `crowdScore` on each article;
academic sources (arXiv, HuggingFace) carry a deliberately lower base weight so
practitioner and crowd-validated content ranks higher.

### Category Rules

Edit `CATEGORY_RULES` in `src/pipeline/scorer.ts`.

## Cost

All within free tiers:

| Service | Free Tier | Job 1 usage | Job 2 usage |
|---|---|---|---|
| GitHub Actions | 2,000 min/month (private) | ~150 min/month | ~180 min/month |
| Mistral API | 1B tokens/month, 2 RPM | ~1.2M tokens/month | ~16M tokens/month |
| Notion API | Free plan | — | — |

**Total Mistral: ~17M tokens/month ≈ 1.7% of the 1B free tier.**

## License

MIT
