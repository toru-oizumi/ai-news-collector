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
│   │   ├── rss-fetcher.ts       # RSS フィード汎用取得
│   │   ├── anthropic-scraper.ts # Anthropic サイト HTML スクレイピング
│   │   ├── hackernews.ts        # HN Algolia Search API
│   │   └── huggingface.ts       # HuggingFace Daily Papers API
│   ├── pipeline/            # 処理パイプライン
│   │   ├── dedup.ts             # URL 正規化・重複排除
│   │   ├── scorer.ts            # スコアリング・カテゴリ自動分類
│   │   ├── summarizer.ts        # Gemini API 日本語要約
│   │   └── __tests__/           # Vitest テスト
│   │       ├── dedup.test.ts
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
npm run collect            # 本番実行 (Notion + Gemini 使用)
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
 └── (拡張可能: GitHub Trending, Mistral, xAI など)
      ↓
Dedup (URL 正規化: www除去・末尾スラッシュ・クエリパラム)
      ↓
Score & Categorize (sourceWeights + keywordBonus → minScore フィルタ)
      ↓
Notion Dedup (本番のみ: 既存 URL を DB から取得して除外)
      ↓
Summarize (Gemini 2.5 Flash-Lite: 最大 80 件, 7s 間隔で RPM 制限回避)
      ↓
Push to Notion Database
```

---

## Key Files

### `src/config.ts`

全設定の中心。変更頻度が高い:

- `RSS_SOURCES`: ソース追加/削除・keyword フィルタ設定
- `SCORE_CONFIG.sourceWeights`: ソースごとの基本スコア
- `SCORE_CONFIG.keywordBonus`: キーワードマッチ時のボーナス
- `SCORE_CONFIG.minScore`: フィルタ閾値 (デフォルト 30)
- `GEMINI_CONFIG`: モデル名・RPM 制限設定

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
2. `src/main.ts` の `fetchers` 配列に追加
3. `src/types.ts` の `Source` 型に追加
4. `src/config.ts` の `SCORE_CONFIG.sourceWeights` に追加

---

## Environment Variables

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `NOTION_API_KEY` | 本番のみ | Notion Integration の API Key |
| `NOTION_DATABASE_ID` | 本番のみ | 対象 Database の ID |
| `GEMINI_API_KEY` | 本番のみ | Google AI Studio の API Key |

ローカル開発では `.env` ファイルに記述 (`.gitignore` 済み)。
ドライラン (`--dry-run`) では環境変数不要。

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
| Gemini API | 1,000 RPD | 日次 80 件以下なら余裕 |
| Notion API | 無料プラン対応 | — |
