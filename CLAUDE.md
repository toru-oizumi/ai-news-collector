# AI News Collector — Claude Instructions

## Project Overview

AI/ML ニュースを各種ソースから自動収集し Notion Database に蓄積するツール。
GitHub Actions で 6 時間ごとに収集する。運用と復旧手順は [docs/reliability.md](docs/reliability.md) を参照する。

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
│   │   └── __tests__/           # Vitest テスト
│   │       ├── dedup.test.ts
│   │       ├── keywords.test.ts
│   │       └── scorer.test.ts
│   ├── collection/          # 未保存キュー・保存済み URL 台帳
│   ├── enrichment/          # 本文根拠の検査・処理状態・再試行・Notion 更新
│   ├── brief/               # 保存済みスナップショットから最大 3 件を表示
│   ├── notion/
│   │   └── client.ts        # Notion API クライアント (読み書き・重複確認・全件エクスポート)
│   └── export/
│       └── articles-json.ts # Notion → web/src/data/articles.json スナップショット
├── web/                     # 閲覧サイト (Astro SSG / 独立パッケージ)
│   ├── src/
│   │   ├── content.config.ts    # file() loader + zod スキーマ (ビルド時の契約)
│   │   ├── lib/articles.ts      # 並び順・グルーピング・各種上限
│   │   ├── components/          # ArticleRow / Feed / Toolbar / Pager
│   │   ├── layouts/Base.astro
│   │   ├── pages/               # 新着 / archive / source / category / search-index.json
│   │   └── styles/global.css    # デザイントークン
│   ├── worker/              # アクセスゲート (共有シークレット)
│   │   ├── auth.ts              # 判定ロジック (純粋関数)
│   │   ├── index.ts             # エントリ。認可されたら env.ASSETS.fetch へ
│   │   └── tsconfig.json        # workers-types。Astro の tsconfig からは除外
│   └── wrangler.jsonc       # Workers Static Assets + main (ゲート)
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
npm run collect            # 本番実行 (Notion 保存のみ、Mistral / Slack は呼ばない)
npm run collect:dry        # フィードは取得する。Notion / Mistral / Slack への書き込みなし
npm run digest:dry         # 外部 API 呼び出しなし
npm run brief -- <JSON>    # ローカルのサイト用スナップショットから表示

# 閲覧サイト (web/ は独立パッケージ)
npm run export:web         # Notion → web/src/data/articles.json
cd web && npm run use-fixture  # 認証情報なしで触る場合の代替データ
cd web && npm run dev      # Astro 単体 (localhost:4321)。ゲートは通らない
cd web && npm run build    # SSG ビルド → web/dist
cd web && npm run check:worker && npm test  # ゲートの型チェックとテスト
cd web && npx wrangler dev # ゲート込みで配信 (要 web/.dev.vars の SITE_TOKEN)
cd web && npx wrangler deploy  # Cloudflare Workers へデプロイ

# .env は npm script では読まれない (VS Code の launch.json のみ)。CLI から使う場合:
node --env-file=.env --import tsx src/export/articles-json.ts

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
Checkpoint (全候補を .runtime/pending.json に保存)
      ↓
Notion URL 照合 → 元の抜粋と処理状態を保存 (要約 API を呼ばない)
      ↓
Enrichment Queue (保存済みページを .runtime/enrichment.json に記録)
      ↓
別ジョブで本文取得 → 関連性・根拠の検査 → Mistral 要約 → Summary と管理ブロックの置換
```

収集と要約の上限、処理状態、復旧手順は [docs/reliability.md](docs/reliability.md) が正典。
ローカルでも同じ DB と `.runtime/` に対して並行実行しない。
重複確認の失敗時は作成せず、応答不明の作成を直ちに再試行しない。
本文取得に失敗した場合、タイトルだけから要約を作らない。
既存の Summary や閲覧 Status を移行・修正する処理は自動実行しない。

日本語記事は要約 API を使わず、元の抜粋を管理ブロックに `excerpt` として残し、Summary に未検証ラベル付きで保存する。
要約待ち時間のために未保存記事を切り捨てない。
全文翻訳、Slack 投稿、リアクション同期は収集・要約の自動経路では呼ばない。
任意実行コマンドと移行上の非互換性は [docs/reliability.md](docs/reliability.md) を参照する。

## 閲覧サイト (web/)

Notion → JSON スナップショット → Astro SSG の 3 段。Astro から Notion を直接読まない
(Notion アクセスをルートパッケージの実装に一本化し、サイトのビルドに秘密情報を要らなくする)。

変更する前に把握しておくべき設計判断:

- **並び順は `fetched`（収集日）で、表示は `published`。** アグリゲータは古い記事を再浮上
  させるため、直近90日に収集した約2,800件は published が90日より古い。日付グループ見出しで
  実際の並び順キーを明示しないと、順序が無根拠に見える。
- **月別アーカイブは差分デプロイのため。** 全archiveを連番ページにすると記事追加で全ページの
  内容がずれ、毎回全ページを再アップロードすることになる。月別なら当月以外は byte 一致。
- **source / category ビューは `FACET_LIMIT` で上限。** 無制限だとカテゴリ一覧だけで
  21,020記事が82,661行・1,659ページに展開され、ビルドの110MBを占めた。
- **`getAllArticles()` は日付で窓を切って遡る。** Notion の `databases.query` は単一カーソル
  チェーンで約10,000件を超えると `has_more` が false になり、素朴なページングでは古い履歴が
  黙って欠落する（実測: DB に21,020件あるのに10,000件で打ち切られた）。
- **検索対象はタイトル・ソース・カテゴリのみ**（要約は含めない）。90字の抜粋を入れるだけで
  インデックスが約370KB→約1.1MB (gzip) に膨らんだ。入力欄の placeholder にその旨を明記。

### アクセスゲート (web/worker/)

サイトは `*.workers.dev` で配信しており、**Cloudflare Access は自分が保有する zone の
ホスト名にしか適用できない**ため、Access は使えない。代わりに Worker を前段に置き、
共有シークレット (`SITE_TOKEN`) を HttpOnly Cookie で検証している。

- `SITE_TOKEN` は **Worker のシークレット**（`wrangler secret put SITE_TOKEN`）。
  GitHub Secrets ではない（CI は知る必要がない）し、`wrangler.jsonc` にも書かない。
  `wrangler deploy` をしてもシークレットは保持される。
- **フェイルクローズ。** `SITE_TOKEN` が未設定・24文字未満・Cookie に使えない文字を含む
  場合は全リクエストを 404 にする。初回デプロイ時点では誰にも見えない状態から始まる。
- `run_worker_first: true` が必須。これがないと静的アセットがエッジから直接返り、
  `/_astro/*.css` などがゲートを通らずに漏れる。
- 通す応答には `Cache-Control: private` を付ける。これがないと CDN や社内プロキシが
  URL だけをキーにページを保持し、Cookie を持たないリクエストに渡しうる。
- 初回は `/?k=<SITE_TOKEN>` で Cookie を発行し、**トークンを外した URL へリダイレクト**
  する（履歴・`Referer`・アクセスログに残らないようにするため）。
- これは ID 基盤ではない（個別ユーザー・監査ログ・部分失効なし）。ドメインを用意できる
  なら Access に移行するほうが強い。`web/worker/auth.ts` 冒頭に判断を記録済み。
- 判定ロジックは純粋関数として `auth.ts` に切り出し、37 ケースのユニットテストがある。
  ここはアーカイブと公開インターネットの間に立つ唯一の防壁なので、CI でも独立に検査する。

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
- `QIITA_CONFIG`: Qiita のタグ・取得件数
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
| `MISTRAL_API_KEY` | 要約ジョブのみ | Mistral AI Console の API Key |
| `SLACK_BOT_TOKEN` | ヘルパー用 | 現行の収集・要約ジョブでは未使用 |
| `SLACK_CHANNEL_ID` | ヘルパー用 | 現行の収集・要約ジョブでは未使用 |
| `QIITA_TOKEN` | 任意 | Qiita API のレート上限を 60→1000 req/h に引き上げ。未設定でも動作 |
| `CLOUDFLARE_API_TOKEN` | 任意 | 閲覧サイトのデプロイ用 (Workers Scripts: Edit)。未設定ならビルドのみ |
| `CLOUDFLARE_ACCOUNT_ID` | 任意 | 同上 |

ローカル開発では `.env` ファイルに記述 (`.gitignore` 済み)。
ドライラン (`--dry-run`) では環境変数不要。収集のドライランはフィード取得を行う。
外部通信を避ける検証にはモック、fixture、`digest:dry`、`brief` を使う。

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

## Runtime budgets

収集・要約の実行上限とレート制限時の挙動は [docs/reliability.md](docs/reliability.md) を参照する。
本番レイテンシでの処理能力や要約の意味的正確性は、ユニットテストの合格だけでは判断しない。
