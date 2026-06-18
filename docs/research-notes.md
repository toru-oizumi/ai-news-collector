# Research Notes — Source Expansion & Crowd Signal (Phase 0)

各ソース / API の実在とスキーマを確認した結果。実装はこの結論に基づく。
推測で埋めた箇所・未検証箇所は明示する。

> **検証環境の制約**: 開発サンドボックスのネットワークは allowlist 制
> （`npm` / `github.com` / `raw.githubusercontent.com` のみ）で、外部フィード /
> API への直接アクセスは 403 になる。よってスキーマは WebSearch + 既知の公開
> 仕様で確認し、**実フィードの到達性は本番（GitHub Actions, 全外部アクセス可）
> の初回実行で検証する**ことを前提とする。フィード URL が万一 404 でも
> `Promise.allSettled` で握り潰され、そのソースが空になるだけでパイプライン
> 全体は壊れない（後方互換）。

---

## 採用するソース一覧

| ソース | 種別 | エンドポイント | crowd score | 採否 | 備考 |
|--------|------|----------------|-------------|------|------|
| **Lobsters** | JSON API | `https://lobste.rs/hottest.json` | ✅ `score` | 採用 | 専用 fetcher。AI 関連 tag/keyword で絞る |
| **Hacker News** | JSON API | `https://hn.algolia.com/api/v1/search` (既存) | ✅ `points` | 既存を crowd 化 | `num_comments` も取得済み |
| **Simon Willison** | Atom | `https://simonwillison.net/atom/everything/` | ❌ | 採用 | practitioner 価値が高い。全件取り込み |
| **Import AI** | RSS (Substack) | `https://importai.substack.com/feed` | ❌ | 採用 | Jack Clark の週刊。標準 Substack feed |
| **Latent Space** | RSS (Substack) | `https://www.latent.space/feed` | ❌ | 採用（注意） | RSS が truncate されがちとの報告あり。要本番検証 |
| **Changelog** | RSS | `https://changelog.com/feed` | ❌ | 採用 | 一般 dev 寄りなので AI キーワードで絞る。feed URL は本番検証 |
| **GitHub Trending** | RSS (3rd party) | `https://mshibanami.github.io/GitHubTrendingRSS/daily/{lang}.xml` | ❌（記述に star 数はあるが構造化されない） | 採用（best-effort） | Go / TypeScript / Python。非公式・gh-pages 依存。AI キーワードで絞る |
| **Console.dev** | — | （クリーンな RSS URL を確証できず） | — | **見送り** | 仕様未確証。タスク方針どおりスコープ外 |

---

## 各ソースの調査詳細

### Lobsters (`hottest.json`)

- レスポンスは story オブジェクトの JSON 配列。
- 確認できた主なフィールド: `short_id`, `short_id_url`, `created_at`, `title`,
  `url`, **`score`**（票数）, `flags`, **`comment_count`**, `description`,
  `description_plain`, `comments_url`, `submitter_user`, **`tags`**（配列）。
- crowd score は `score` フィールドで取得可能。
- 一般 dev ニュースも混ざるため、`tags` に `ai`/`ml` を含むか、タイトル/説明が
  AI キーワードにマッチするもののみ採用する（HN と同じ方針）。

### Hacker News (Algolia) — 既存

- `src/sources/hackernews.ts` を確認。レスポンスの各 hit は `points` と
  `num_comments` を**既に取得済み**。現状は `score = points` を直接スコアに使用。
- `Show HN` 絞り込み: Algolia は `tags=show_hn`（または `tags=story,show_hn`）で
  絞れる。今回は AI 全般を拾いたいので `tags=story` のまま据え置き。
- → Phase 1 では `points` を共通 `crowdScore` に載せ替え、スコア合成を統一する。

### Simon Willison

- `https://simonwillison.net/atom/everything/` が Atom フィード（rss/タグ参照で確認）。
- LLM / dev tooling / 実務トピックの宝庫。crowd score は無い。全件取り込み。

### Import AI / Latent Space (Substack)

- Substack は `<base>/feed` で標準 RSS を提供。
  - Import AI: `https://importai.substack.com/feed`
  - Latent Space: `https://www.latent.space/feed`
- Latent Space は「RSS friendly でない（本文が途切れる）」という報告が HN にある。
  タイトル + 取れる範囲の本文で運用し、本番初回で内容量を確認する。

### Changelog

- `https://changelog.com/feed` を採用。master/news 等の派生フィードが存在するため、
  本番初回で取得件数を確認し、必要なら `news/feed` 等へ差し替える（**要検証**）。
- 一般 dev 寄りなので AI キーワードフィルタを付与してノイズを抑える。

### GitHub Trending

- 公式 API は無い（前提どおり）。
- 非公式 RSS ジェネレータ **mshibanami/GitHubTrendingRSS**（2025 年も更新あり）を採用。
  - URL パターン: `https://mshibanami.github.io/GitHubTrendingRSS/daily/{language}.xml`
    （`{language}` は `all` / `go` / `typescript` / `python` 等のスラッグ）。
  - 言語フィルタ可。今回は Go / TypeScript / Python の daily を採用。
- gh-pages 依存で停止リスクがあるため best-effort 扱い。star 数は description 文中に
  あるが構造化フィールドではないため crowd score には使わない（RSS 扱い）。
- AI キーワードフィルタを付与（trending 全件は AI 以外も多いため）。

### Console.dev

- RSS 提供自体はある旨の記述はあるが、安定した機械可読フィード URL を確証できず。
- タスク方針（「無ければ今回は見送り」）に従い **スコープ外**。

---

## crowd score の正規化方針

ソース間で票数スケールが大きく異なる（HN points ~50–1000、Lobsters score ~5–100）。
そのまま足すと HN が支配的になるため、対数 + ソース別スケールで圧縮する。

```text
crowdBonus = min(maxBonus, round(weight * log10(crowdScore * scale[source] + 1)))
```

- `weight` / `maxBonus` / `scale` は `SCORE_CONFIG.crowd` で調整可能。
- crowd score を持たないソース（RSS 系）は `crowdBonus = 0`。

最終スコア合成（Phase 1）:

```text
score = sourceWeight + keywordBonus + crowdBonus
```

これに伴い、学術偏りを抑えるため **arXiv / HuggingFace の sourceWeight を引き下げる**。

---

## Phase 1 で変更するファイル

- `src/types.ts`: `Article.crowdScore?: number` 追加、`Source` に新ソース追加。
- `src/config.ts`: 新 RSS ソース、`LOBSTERS_CONFIG`、`SCORE_CONFIG.crowd`、
  sourceWeights 調整（arXiv/HF 引き下げ）。
- `src/sources/lobsters.ts`: 新規 fetcher（crowd score 取得）。
- `src/sources/hackernews.ts`: `points` → `crowdScore` に載せ替え。
- `src/pipeline/scorer.ts`: スコア合成を統一（crowdBonus 追加）。
- `src/pipeline/dedup.ts`: 重複時に crowdScore も考慮して残す方を選ぶ。
- `src/main.ts`: `lobstersFetcher` を追加。
- テスト追加: scorer の crowd 正規化、lobsters パース、dedup の crowd 優先。

---

## ドライラン検証で判明した点（要対応）と追加対応

初回ドライラン（本環境では外部フィードに到達できた）で、スコアリング自体は
意図どおり機能することを確認した。ソース別トップスコアは以下のとおり、実務者/
クラウド系も競争力のある値になっていた:

```text
OpenAI 135 / Anthropic 127 / DeepMind 105 / Google AI 105 /
GitHub Trending 102 / Ollama 100 / Lobsters 99 / Vercel 97 / Changelog 97 /
arXiv 90 / ... / Latent Space 87 / Hacker News 87 / Simon Willison 85
```

ところが**処理対象の上位 50 件（`maxSummarize`）が OpenAI 45 件 + Anthropic 5 件で
占有**され、それ以外（arXiv/HF/実務者/クラウド系すべて）が 1 件も残らなかった。

- 原因: OpenAI フィードが ~1000 件を返し、その大半が base 80 + キーワード加点で
  100 点超。スコア降順で上位 50 を取ると OpenAI が埋め尽くす。
- これは Phase 1 のスコア調整（arXiv/HF 引き下げ）では解決しない、別軸の
  **ボリューム独占**問題。

### 追加対応: ソース別上限（diversity cap）

`SCORE_CONFIG.maxPerSource`（初期値 8）を追加し、`scorer.ts` の `selectDiverse()`
で最終選抜時に 1 ソースあたりの採用件数を上限で抑える。スロットが余る場合は
スコア順で overflow から補充して取りこぼさない。

結果（同条件の再ドライラン, cap=8）: 上位 50 が OpenAI/DeepMind/Anthropic 各 8 +
GitHub Trending 6 / Google AI 5 / Vercel 4 / Changelog 2 / arXiv 1 / … と多様化。

### crowd 表示（Lobsters / HN）の可視性は票数依存

`crowdScore` を持つ HN / Lobsters のスコア上限は概ね 85〜99（base 20〜30 +
crowdBonus 最大 60）で、ちょうど 90〜100 帯の RSS 系と競合する。その日の票数が
高ければ上位 50 に入る（Lobsters が 99 に達した実測あり）が、票が低い日は
入らないこともある。cap を 6 に下げても入るのは中位 RSS（Vercel 等）で、
HN/Lobsters の可視性は本質的に票数次第。確実に常時表示したい場合は
crowd 系への予約枠が必要だが、Phase 1 のスコープ外とする（運用しながら判断）。

---

## Phase 3: model release 系一次ソース追加 (TOR-42)

`Mistral / xAI 等` の model release 系一次ソースを追加するにあたり、候補フィードの
到達性を再確認した（Phase 0 同様、追加前の疎通検証）。実測 (2026-06):

| 候補 | URL | 結果 | 判断 |
|------|-----|------|------|
| Mistral 公式 | `https://mistral.ai/rss.xml` | 200 / FEED / 73 items | **採用**（"Mistral AI Blog"。Medium 3.5 等のモデルリリースが流れる） |
| Mistral 公式(旧) | `/news/rss.xml`, `/feed.xml` | 404 | 不採用（過去に削除した URL。現在も404） |
| Mistral ミラー | Olshansk `feed_mistral.xml` | 200 / 54 items | 公式が復活したため不使用（一次ソース優先） |
| xAI 公式 | `https://x.ai/news/rss.xml` 等 | 403 | 非ブラウザ UA をブロック。既存の Olshansk ミラーを維持 |
| DeepSeek 公式 | `api-docs.deepseek.com/news/rss.xml` | 404 | 安定フィード無し。GitHub `releases.atom` は 1 item のみで不採用 |
| Cohere | `cohere.com/blog/rss.xml` | 307→HTML | フィード実体なし、不採用 |
| Stability AI | `stability.ai/news?format=rss` | 301→HTML | フィード実体なし、不採用 |
| Together AI | `together.ai/blog/rss.xml` | 200 / 100 items | 稼働。ただし推論基盤寄り（model release 一次ソースではない）→ 将来のエコシステム拡充候補として保留 |

### 対応

- **Mistral 公式フィードを `RSS_SOURCES` に追加**（`Source` 型・`sourceWeights` は既存定義を流用、weight 70）。
- xAI は公式が 403 のため Olshansk ミラーを維持（コメントに理由を明記）。
- DeepSeek/Cohere/Stability は安定フィードが無く Phase 3 では不採用。

---

## ソース追加: smol.ai AINews — X/Twitter AI ニュースのキュレーション (TOR-47)

X(Twitter) 生データは玉石混交で直接利用に不適なため、AI Twitter をキュレーション/
要約しているサイトの RSS を取り込む方針とした。候補の到達性を実測 (2026-06):

| 候補 | URL | 結果 | 判断 |
|------|-----|------|------|
| smol.ai AINews | `https://news.smol.ai/rss.xml` | 200 / FEED / 651 items / 全文あり | **採用**。"Weekday recaps of top News for AI Engineers"。AI Twitter+Discord+Reddit の日次キュレーション。公式 RSS で安定。 |
| TLDR AI | `https://tldr.tech/api/rss/ai` | 200 / 20 items | 稼働。別編集視点の日刊。補完候補だが今回は見送り。 |
| Last Week in AI | `https://lastweekin.ai/feed` | 200 / 週次 | 稼働だが週次で頻度低め。候補。 |
| Techmeme | `https://www.techmeme.com/feed.xml` | 200 | テック全般で AI 専用でない（X ランキング由来）。対象外。 |
| Ben's Bites | `https://bensbites.beehiiv.com/feed` | 404 | 安定フィードなし、不採用。 |
| The Rundown AI | `https://www.therundown.ai/feed` | 404 | 安定フィードなし、不採用。 |

### 対応（今回は smol.ai のみ）

- `RSS_SOURCES` に `{ name: "smol.ai", url: "https://news.smol.ai/rss.xml" }` を追加。元から
  AI 特化のため `keywords` フィルタ不要。`sourceWeights["smol.ai"] = 60`（キュレーション系）。
- 留意点: 粒度は日次ダイジェスト1件（"not much happened today" の日もある）。元が要約のため
  Mistral 再要約は「要約の要約」になる点、社外公開時は編集著作物として出典明記・類似性に注意。
