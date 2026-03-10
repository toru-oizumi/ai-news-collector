# AI News Collector

Automatically collects the latest AI/ML news and stores it in a Notion Database.

AI/ML 関連の最新ニュースを自動収集して Notion Database に蓄積するツール。

## Architecture / アーキテクチャ

```
GitHub Actions (cron: daily 09:00 JST)
├─ Fetch (parallel)
│  ├─ RSS: OpenAI, DeepMind, Google AI, Meta AI, NVIDIA, AWS, arXiv
│  ├─ HTML Scrape: Anthropic (news + engineering)
│  ├─ API: Hacker News (Algolia), HuggingFace Daily Papers
│  └─ (extensible: GitHub Trending, Mistral, xAI, etc.)
├─ Dedup (URL normalization)
├─ Score & Categorize (source weight + keyword bonus)
├─ Notion Dedup (exclude existing URLs)
├─ Summarize (Gemini 2.5 Flash-Lite → Japanese summary)
└─ Push to Notion Database
```

## Setup / セットアップ

### 1. Notion

1. Create a [Notion Integration](https://www.notion.so/my-integrations) and get the API Key
   / [Notion Integration](https://www.notion.so/my-integrations) を作成し、API Key を取得
2. Create a new Notion Database with the following properties / 以下のプロパティで Database を作成:

| Property / プロパティ | Type / 型 | Notes / 備考 |
|---|---|---|
| Title | Title | Default title column / デフォルトタイトル列 |
| URL | URL | |
| Source | Select | |
| Category | Multi-select | |
| Score | Number | |
| Summary | Rich text | |
| Published | Date | |
| Fetched | Date | |
| Status | Select | Unread / Read / Starred |

3. Connect the Integration to the Database (••• → Connections → add your Integration)
   / Database ページで Integration を接続（右上 ••• → Connections → 作成した Integration を追加）
4. Copy the Database ID from the URL: `https://www.notion.so/<DATABASE_ID>?v=...`

### 2. Gemini API

1. Get a free API Key from [Google AI Studio](https://aistudio.google.com/apikey) (no credit card required)
   / [Google AI Studio](https://aistudio.google.com/apikey) で無料 API Key を取得（クレカ不要）

### 3. GitHub

1. Fork this repo (or create a private repo) / このリポジトリを Fork
2. Set the following secrets under Settings → Secrets and variables → Actions:
   / Settings → Secrets and variables → Actions で以下を設定:
   - `NOTION_API_KEY`
   - `NOTION_DATABASE_ID`
   - `GEMINI_API_KEY`

### 4. Local Setup / ローカルセットアップ

```bash
# Install Node.js 24 via mise
mise install

# Install dependencies
npm install

# Copy env file and fill in your credentials
cp .env.example .env

# Dry run (no Notion/Gemini calls)
npm run collect:dry

# Full run
npm run collect
```

## Development / 開発

```bash
npm test            # vitest watch mode
npm run test:run    # run once
npm run check:fix   # lint + format (Biome)
npm run typecheck   # TypeScript type check
```

VS Code: open **Run and Debug** (⇧⌘D) and select `collect: dry-run` to debug with breakpoints.

## Customization / カスタマイズ

### Adding / Removing Sources / ソースの追加・削除

Edit `RSS_SOURCES` in `src/config.ts`. You can add keyword filters:
/ `src/config.ts` の `RSS_SOURCES` を編集。keyword フィルタ付きで追加可能:

```ts
{ name: "NVIDIA", url: "https://blogs.nvidia.com/feed/", keywords: ["ai", "llm"] }
```

### Scoring / スコアリング調整

Edit `SCORE_CONFIG` in `src/config.ts`:
/ `src/config.ts` の `SCORE_CONFIG` で:
- `sourceWeights`: base score per source / ソースごとの基本スコア
- `keywordBonus`: bonus on keyword match / キーワードマッチ時のボーナス
- `minScore`: filter threshold / フィルタ閾値

### Category Rules / カテゴリルール

Edit `CATEGORY_RULES` in `src/pipeline/scorer.ts`.

## Cost / コスト

All within free tiers / すべて無料枠内:

| Service | Free Tier | Usage |
|---|---|---|
| GitHub Actions | 2,000 min/month (private) | ~150 min/month |
| Gemini API | 1,000 RPD | ~80 articles/day |
| Notion API | Free plan | — |

## License

MIT
