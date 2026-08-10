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
│  ├─ API: Hacker News (Algolia), HuggingFace Daily Papers, Lobsters (hottest.json)
│  └─ Japanese: Hatena Bookmark (search RSS), Zenn (topic feeds), Qiita (API v2)
├─ Dedup (URL normalization; crowd-backed duplicate wins)
├─ Score & Categorize (source weight + keyword bonus + normalized crowd score)
│     └─ Stamp Lang (en/ja) + Kind (primary/secondary) from SOURCE_META
├─ Notion Dedup (exclude existing URLs)
├─ Select (per-source cap; Japanese gets its own quota, separate from the Mistral budget)
├─ Summarize (Mistral Small → short Japanese summary, 2-3 sentences)
│     └─ Skipped for Japanese articles — the feed excerpt is used instead
├─ Push to Notion Database (Status: "Unread")
└─ Post digest to Slack (parent message + one threaded reply per article)

[Job 2: digest]  chained after each successful collect run (same workflow)
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

[Job 3: publish]  chained after digest (same workflow)
├─ Export Notion → web/src/data/articles.json (properties only, one snapshot)
├─ Astro SSG build (output: "static", no adapter)
└─ wrangler deploy → Cloudflare Workers Static Assets
```

The site is a read-only view; Notion stays the place you edit (and the Slack reactions
still drive Status). See [Browsing site](#browsing-site).

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
| Lang | Select | **en** / **ja** — content language |
| Kind | Select | **primary** / **secondary** — original announcement vs. commentary |

1. Connect the Integration to the Database (••• → Connections → add your Integration).
1. Copy the Database ID from the URL: `https://www.notion.so/<DATABASE_ID>?v=...`

> **Note:** Add **"Digested"** as a Status option so Job 2 can update processed articles.
>
> **Required for Job 2:** the **Lang** property must exist. Job 2 filters on it to skip
> Japanese articles, and Notion rejects a query that filters on a missing property — so
> the digest job fails outright without it. Job 1 tolerates its absence (it omits the field).

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

  | Reaction (any of) | Notion Status |
  |---|---|
  | ⭐🌟✨🔥💯❤️😍🎉👏🙌🔖📌💡 (`star`, `fire`, `100`, `heart`, `tada`, `bookmark`, …) | **Starred** |
  | ✅☑️✔️👀👍👎🆗🙏 (`white_check_mark`, `eyes`, `+1`, `-1`, `ok_hand`, …) | **Read** |

  See `SLACK_CONFIG.reactions` in `src/config.ts` for the full list; add your own aliases there.

  Reactions only advance status forward (`Unread`/`Digested` → `Read` → `Starred`); a status you
  set manually is never overwritten.

### 5. Qiita (optional)

The Qiita API v2 works unauthenticated at 60 requests/hour, and the collector uses one
request per configured tag — so no token is needed. Set `QIITA_TOKEN` to raise the limit
to 1000 requests/hour if you add many tags.

### 6. Cloudflare (optional)

Needed only to publish the browsing site. Add two GitHub secrets; without them the publish
job still builds the site (so a broken build fails loudly) but skips the deploy.

- `CLOUDFLARE_API_TOKEN` — **an API token, not an OAuth token.** `wrangler login` uses
  OAuth interactively and cannot work in CI. Create the token at Cloudflare dashboard →
  **My Profile → API Tokens → Create Token**, and under **Permission policies** open the
  **Custom** dropdown and pick the **Edit Cloudflare Workers** template. Leave **client IP
  filtering empty** — GitHub Actions runner IPs are dynamic, and restricting them breaks CI.
- `CLOUDFLARE_ACCOUNT_ID` — from the dashboard URL (`dash.cloudflare.com/<id>/workers`) or
  `npx wrangler whoami`.

Then set the site's access token, once, directly on the Worker:

```bash
cd web
npx wrangler secret put SITE_TOKEN     # paste a long random string, e.g. openssl rand -base64 24 | tr -d '/+='
```

`SITE_TOKEN` is a Worker secret, not a GitHub secret: CI never needs to see it, and it
survives every `wrangler deploy`. Deploy order is safe either way — a Worker with no
`SITE_TOKEN` serves 404 to everyone, so the site is closed from its very first deploy.

To read the site, visit `https://<worker>.<subdomain>.workers.dev/?k=<SITE_TOKEN>` once.
The Worker exchanges the token for a long-lived `HttpOnly; Secure` cookie and redirects to
the same page without it, so the token stops appearing in history and `Referer` headers.

> **Why not Cloudflare Access?** Access can only protect hostnames in a zone you own, and
> this site is served from `*.workers.dev`. If you do have a domain on Cloudflare, prefer
> Access: add `"routes": [{"pattern": "news.example.com", "custom_domain": true}]` and
> `"workers_dev": false` to `web/wrangler.jsonc`, then create a self-hosted application at
> **Zero Trust → Access controls → Applications**. See `web/worker/auth.ts` for what the
> shared-secret approach gives up (no identity provider, no audit log, no per-user
> revocation).
>
> **Check it before trusting it.** In a logged-out or private browser window, open the
> site's root URL with no `?k=` and confirm you get a 404 — and do the same for an asset
> path such as `/_astro/`. Until you have seen that, you have no evidence the archive
> isn't public.

### 7. Local Setup

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

The npm scripts read credentials from the environment, not from `.env` — only the VS Code
launch configs load that file. To run a script against `.env` from a shell, pass it to Node:

```bash
node --env-file=.env --import tsx src/export/articles-json.ts
```

## Browsing site

A static site under [`web/`](web/) renders the Notion database as a fast, searchable feed.
It is a separate npm package; the root package owns Notion access.

```bash
npm run export:web              # Notion → web/src/data/articles.json (needs credentials)
cd web && npm install
npm run use-fixture             # or skip, if you ran export:web above
npm run dev                     # http://localhost:4321 — no gate in the Astro dev server
npm run check:worker && npm test # type-check and test the access gate
npm run build && npx wrangler dev   # serve the build through the gate (see below)
npx wrangler deploy             # first deploy, by hand
```

To exercise the gate locally, put a token in `web/.dev.vars` (gitignored) before
`wrangler dev`:

```bash
echo "SITE_TOKEN=$(openssl rand -base64 24 | tr -d '/+=')" > .dev.vars
```

Then `http://localhost:8787/` returns 404 and `http://localhost:8787/?k=<token>` lets you
in. `npm run dev` (the Astro dev server) bypasses the Worker entirely, so use `wrangler
dev` whenever you touch `worker/`.

Layout:

| Route | Contents |
|---|---|
| `/` … `/4/` | The most recent 200 articles, grouped by collection date |
| `/archive/` | Every month, with a bar per month's volume |
| `/archive/2026-07/` | That month in collection order |
| `/source/<name>/` | Top 200 from that source by score |
| `/category/<name>/` | Top 200 in that category by score |
| `/search-index.json` | Titles, sources and categories for the last 90 days |

Everything above is behind the access gate in [`web/worker/`](web/worker/) — see step 6.

Design notes worth knowing before changing it:

- **The site orders by collection date, not publish date.** Aggregators resurface old
  material — around 2,800 rows collected in the last 90 days were published earlier than
  that, some years earlier. Rows display the publish date, so the date group headers state
  the real ordering key; without them the sequence looks arbitrary.
- **The month archive exists to keep deploys incremental.** Numbered pages over the whole
  archive would all shift whenever an article arrives, so every page would re-upload.
  Grouping by month means only the current month changes, and wrangler skips the rest.
- **The per-source and per-category views are capped** (`FACET_LIMIT`). Uncapped, the
  category listings alone expanded 21,020 articles into 82,661 rows across 1,659 pages —
  they were 110 MB of the build. They are "best of", not archives.
- **Search covers titles, not summaries.** Including even a 90-character excerpt tripled
  the index (~370 KB → ~1.1 MB gzipped). The placeholder text says so rather than implying
  full-text search.

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

Edit `RSS_SOURCES` in `src/config.ts` (or `JP_RSS_SOURCES` for Japanese sources).
You can add keyword filters, a freshness cap, and a crowd-signal floor:

```ts
{ name: "NVIDIA", url: "https://blogs.nvidia.com/feed/", keywords: ["ai", "llm"] }
```

```ts
// Reads an RSS extension element as the crowd signal and drops items below the floor.
{
  name: "Hatena",
  url: "https://b.hatena.ne.jp/q/LLM?sort=recent&mode=rss",
  keywords: AI_KEYWORDS_JA,
  crowdField: "hatena:bookmarkcount",
  minCrowd: 10,
  maxAgeDays: 7,
}
```

Every new `Source` also needs an entry in `SOURCE_META` (language + tier) and in
`SCORE_CONFIG.sourceWeights` — both use `satisfies Record<Source, …>`, so a missing
entry is a compile error rather than a silent default.

### Japanese sources

Hatena / Zenn / Qiita are classified `lang: "ja"` in `SOURCE_META`, which changes two things:

- **They skip Mistral summarization.** A Japanese-to-Japanese round trip would burn a 31s
  rate-limit slot to reproduce the feed excerpt, so `abstract` is used as the summary.
  They get their own quota (`JP_CONFIG.maxPerRun`), independent of the Mistral budget.
- **Job 2 skips them** for the same reason — see the Notion `Lang` property note above.

Because `keywordBonus` is matched against Japanese text too, Japanese equivalents are
folded into the existing rules (e.g. `"エージェント"` alongside `"agent"`). Without them,
Japanese articles would score on base weight plus crowd signal alone.

### Scoring

Edit `SCORE_CONFIG` in `src/config.ts`:

- `sourceWeights`: base score per source
- `keywordBonus`: bonus on keyword match
- `crowd`: how vote counts (HN points, Lobsters score, Hatena bookmarks, Qiita LGTMs)
  are normalized into the score
  (`crowdBonus = min(maxBonus, weight × log10(crowdScore × scale + 1))`).
  `scale` aligns the different vote scales before the log — tune it per source.
- `minScore`: filter threshold
- `maxPerSource`: cap on how many articles a single source contributes to the
  final summarize set, so a high-volume source (e.g. OpenAI returns ~1000 items)
  can't monopolize every slot and bury lower-scoring practitioner/crowd content

Crowd-scored sources (Hacker News, Lobsters, Hatena, Qiita) expose `crowdScore` on each
article; academic sources (arXiv, HuggingFace) carry a deliberately lower base weight so
practitioner and crowd-validated content ranks higher.

Zenn is the exception that needs a base weight above `minScore`: its topic feeds carry no
crowd signal, so base weight is the only score a Zenn article is guaranteed. Below the
threshold, every Zenn item would be filtered out and the source would contribute nothing.

### Category Rules

Edit `CATEGORY_RULES` in `src/pipeline/scorer.ts`.

## Cost

All within free tiers:

| Service | Free Tier | Notes |
|---|---|---|
| GitHub Actions | Unlimited for public repos | collect ~28 min + digest (rate-limited) run 4×/day |
| Mistral API | 1B tokens/month, 2 RPM | well under the free tier at the current volume |
| Notion API | Free plan | — |

Actions minutes are free because this repo is **public** (private repos get 2,000 min/month,
which the 4×/day cadence would exceed). The 2 RPM Mistral limit is the real pacing constraint:
the digest job processes ~30 articles/run at ~62s each (digest + full translation).

## License

MIT
