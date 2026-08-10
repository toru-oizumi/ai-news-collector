# AI News Collector — Claude Instructions

## Project Overview

AI/ML ニュースを各種ソースから自動収集し Notion Database に蓄積するツール。
GitHub Actions で毎朝 09:00 JST (00:00 UTC) に実行される。

### 技術スタック

| ツール | 用途 |
|--------|------|
| Node.js 24 | ランタイム (mise 管理) |
| TypeScript 5 (strict) | 言語 |
| Biome | Lint / Format |
| Vitest | テスト |
| tsx | TS 直接実行 (開発・本番) |
| npm | パッケージ管理 |

---

## Directory Structure

```text
.
├── src/
│   ├── main.ts              # エントリポイント・パイプライン全体の制御
│   ├── config.ts            # 環境変数・ソース設定・スコア設定
│   ├── types.ts             # 共通型定義 (Article, Source, Category, Fetcher)
│   ├── sources/             # データ取得レイヤー
│   │   ├── rss-fetcher.ts       # RSS フィード汎用取得 (crowdField/minCrowd 対応)
│   │   ├── anthropic-scraper.ts # Anthropic サイト HTML スクレイピング
│   │   ├── hackernews.ts        # HN Algolia Search API
│   │   ├── huggingface.ts       # HuggingFace Daily Papers API
│   │   └── qiita.ts             # Qiita API v2 (タグ検索)
│   ├── pipeline/            # 処理パイプライン
│   │   ├── dedup.ts             # URL 正規化・重複排除
│   │   ├── keywords.ts          # キーワード照合 (短語は単語境界マッチ)
│   │   ├── scorer.ts            # スコアリング・カテゴリ自動分類・lang/kind 付与
│   │   ├── summarizer.ts        # Mistral API 日本語要約
│   │   └── __tests__/           # Vitest テスト
│   │       ├── dedup.test.ts
│   │       ├── keywords.test.ts
│   │       └── scorer.test.ts
│   └── notion/
│       └── client.ts        # Notion API クライアント (読み書き・重複確認)
├── .github/
│   └── workflows/
│       └── collect.yml      # GitHub Actions ワークフロー
├── .mise.toml               # Node.js バージョン管理
├── biome.json               # Lint / Format 設定
├── vitest.config.ts         # テスト設定
├── tsconfig.json            # TypeScript 設定
└── package.json
```

---

## Commands

```bash
# 環境セットアップ
mise install               # Node.js 24 をインストール

# 実行
npm run collect            # 本番実行 (Notion + Mistral 使用)
npm run collect:dry        # ドライラン (外部 API 呼び出しなし)

# テスト
npm test                   # vitest watch モード
npm run test:run           # vitest 1 回実行

# コード品質
npm run lint               # biome lint チェック (エラー表示のみ)
npm run lint:fix           # biome lint 自動修正
npm run format             # biome format チェック (差分表示のみ)
npm run format:fix         # biome format 自動修正
npm run check              # biome check (lint + format 両方チェック)
npm run check:fix          # biome check 自動修正
npm run typecheck          # TypeScript 型チェック (tsc --noEmit)
```

---

## Pipeline Architecture

```text
Fetch (並列)
 ├── RSS: OpenAI, DeepMind, Google AI, Meta AI, NVIDIA, AWS ML, arXiv (cs.AI/cs.CL/cs.LG)
 ├── HTML Scrape: Anthropic (news + engineering)
 ├── API: Hacker News (Algolia), HuggingFace Daily Papers
 ├── 日本語: はてブ (検索 RSS), Zenn (topic feed), Qiita (API v2)
 └── (拡張可能: GitHub Trending, Mistral, xAI など)
      ↓
Dedup (URL 正規化: www除去・末尾スラッシュ・クエリパラム)
      ↓
Score & Categorize (sourceWeights + keywordBonus + crowdBonus → minScore フィルタ)
 └── SOURCE_META から lang (en/ja) と kind (primary/secondary) を付与
      ↓
Notion Dedup (本番のみ: 既存 URL を DB から取得して除外)
      ↓
Select (英語は maxSummarize 枠, 日本語は JP_CONFIG.maxPerRun 枠で別建て)
      ↓
Summarize (Mistral Small: 31s 間隔で 2 RPM 制限回避)
 └── lang === "ja" はスキップし abstract を summary に流用 (トークン消費 0)
      ↓
Push to Notion Database
```

### 日本語ソースの扱い

`SOURCE_META` で `lang: "ja"` に分類されたソース (はてブ / Zenn / Qiita) は 2 点が変わる。

- **Mistral 要約をスキップ** — 日本語→日本語の往復は 31s のレート制限枠を消費して
  フィード抜粋とほぼ同じものを作るだけなので、`abstract` をそのまま `summary` に使う。
  要約枠とは独立した `JP_CONFIG.maxPerRun` 枠を持つ。
- **digest ジョブ (Job 2) の対象外** — 同じ理由。Notion の `Lang` プロパティで除外する。

`keywordBonus` は日本語テキストにも適用されるため、日本語相当語を既存ルールに
同居させている (`"agent"` の隣に `"エージェント"` など)。これがないと日本語記事は
base + crowd だけで並び、深い検証記事と雑記が区別できなくなる。

---

## Key Files

### `src/config.ts`

全設定の中心。変更頻度が高い:

- `RSS_SOURCES` / `JP_RSS_SOURCES`: ソース追加/削除・keyword フィルタ設定
- `AI_KEYWORDS` / `AI_KEYWORDS_JA`: 汎用ソースを AI 関連に絞る共有キーワード
- `SOURCE_META`: ソースごとの `lang` / `kind` 分類 (`satisfies Record<Source, …>`)
- `SCORE_CONFIG.sourceWeights`: ソースごとの基本スコア
- `SCORE_CONFIG.keywordBonus`: キーワードマッチ時のボーナス
- `SCORE_CONFIG.crowd.scale`: ソース間で票の桁を揃える係数
- `SCORE_CONFIG.minScore`: フィルタ閾値 (デフォルト 30)
- `QIITA_CONFIG` / `JP_CONFIG`: Qiita のタグ・日本語記事の 1 実行あたり件数
- `MISTRAL_CONFIG`: モデル名・RPM 制限設定

新しい `Source` を追加したら `SOURCE_META` と `SCORE_CONFIG.sourceWeights` の両方に
エントリが必要 (どちらも `satisfies` で網羅性を強制しているのでコンパイルエラーになる)。

### `src/types.ts`

- `Article`: 正規化済み記事スキーマ (全パイプラインで使用)
- `Source`: 許容ソース名の Union Type
- `Fetcher`: フェッチャーのインターフェース (`name` + `fetch()`)

### `src/pipeline/scorer.ts`

- `CATEGORY_RULES`: カテゴリ分類ルール (キーワードマッチ)
- `scoreAndFilter()`: スコア計算 + フィルタ + ソート

---

## Adding a New Source

### RSS の場合

`src/config.ts` の `RSS_SOURCES` に追加:

```ts
{ name: "Mistral", url: "https://mistral.ai/feed.xml", keywords: ["model", "release"] }
```

`src/types.ts` の `Source` 型にも追加する。

### スクレイパー / API の場合

1. `src/sources/` に新しいファイルを作成し `Fetcher` インターフェースを実装
   (純粋関数を export してユニットテスト対象にするのが既存の作法)
2. `src/main.ts` の `fetchers` 配列に追加
3. `src/types.ts` の `Source` 型に追加
4. `src/config.ts` の `SCORE_CONFIG.sourceWeights` と `SOURCE_META` に追加
5. 票数を持つソースなら `crowdScore` に入れ、`SCORE_CONFIG.crowd.scale` を調整

---

## Environment Variables

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `NOTION_API_KEY` | 本番のみ | Notion Integration の API Key |
| `NOTION_DATABASE_ID` | 本番のみ | 対象 Database の ID |
| `MISTRAL_API_KEY` | 本番のみ | Mistral AI Console の API Key |
| `SLACK_BOT_TOKEN` | 任意 | Slack Bot Token (`xoxb-…`, `chat:write` 権限)。設定時のみ収集後にダイジェスト投稿 |
| `SLACK_CHANNEL_ID` | 任意 | 投稿先チャンネル ID。Bot を事前に招待しておく必要あり |
| `QIITA_TOKEN` | 任意 | Qiita API のレート上限を 60→1000 req/h に引き上げ。未設定でも動作 |

ローカル開発では `.env` ファイルに記述 (`.gitignore` 済み)。
ドライラン (`--dry-run`) では環境変数不要。
Slack 連携は `SLACK_BOT_TOKEN` と `SLACK_CHANNEL_ID` が両方設定されている場合のみ有効 (best-effort: 失敗しても収集処理は継続)。

---

## Code Style

- **Biome** を使用 (ESLint/Prettier の代替)
- インデント: スペース 2 つ
- クォート: ダブルクォート
- Trailing comma: ES5 スタイル
- `npm run check:fix` で一括修正可能

## Testing

- **Vitest** を使用
- テストファイル: `src/**/__tests__/*.test.ts`
- 外部 API に依存しないユニットテストのみ
- モック不要な純粋関数 (dedup, scorer) を中心にテスト

---

## Cost (Free Tier)

| サービス | 無料枠 | 使用量 |
|---------|--------|--------|
| GitHub Actions | 月 2,000 分 (private repo) | 1 回 3-5 分 × 30 日 ≈ 150 分 |
| Mistral API | 1B tokens/month, 2 RPM (free Experiment) | 日次 80 件以下なら余裕 |
| Notion API | 無料プラン対応 | — |
