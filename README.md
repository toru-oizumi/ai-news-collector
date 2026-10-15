# AI News Collector

Automatically collects the latest AI/ML news and stores it in a Notion Database.
Runs a collection workflow every six hours. Collection saves raw articles first;
a separate, bounded enrichment job produces evidence-checked summaries.

## Architecture

```text
collect (8-minute processing budget; 15-minute job timeout)
  Fetch sources in parallel → URL dedup → score/filter
  Checkpoint every eligible raw article locally (no model quota)
  Skip locally confirmed URLs; check Notion before each remaining create
  Save raw metadata + original excerpt + processing marker in one Notion request
  Checkpoint unfinished saves and an enrichment queue

digest (10 articles / 12-minute processing budget; 20-minute job timeout)
  Read saved page references, oldest pending first
  Fetch article body → reject missing/short/non-AI evidence
  One Mistral request → validate complete JSON + verbatim quotes + names/numbers
  Replace Summary and the owned processing block; preserve user Status
  Stop the run at the first 429; retry transient failures in later runs (max 3)

brief
  Read bounded recent Notion candidates → source-linked JSON/Markdown + provenance manifest
  Emit explicit diagnostic output on failure; never reuse stale news

publish
  Include the same brief under the existing site gate
  Export saved Notion properties → Astro build → existing optional deployment
  May proceed when collection is partial or enrichment fails
```

Automatic Slack posting, reaction sync, and full translation are suspended in this
proposed pipeline. Explicit optional commands preserve manual use; scheduled entry
points do not call them.
This prevents raw saves and publication from depending on model waits or a partially
posted Slack thread. No new delivery integration is enabled.

The selected cloud path now also builds a timestamped three-item brief artifact and
optionally includes it in the existing gated site. See [Cloud brief and adoption](docs/cloud-brief.md)
for the output contract, recovery, real retrieval options and the parent-side trial.

See [Reliability and recovery](docs/reliability.md) for processing states, checkpoint
recovery, behavior changes, limitations, and offline review commands.

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
| Summary | Rich text | Grounded summary (enrichment); empty on abstention |
| Published | Date | |
| Fetched | Date | |
| Status | Select | **Unread** / **Digested** / Read / Starred |
| Lang | Select | **en** / **ja** — content language |
| Kind | Select | **primary** / **secondary** — original announcement vs. commentary |

1. Connect the Integration to the Database (••• → Connections → add your Integration).
1. Copy the Database ID from the URL: `https://www.notion.so/<DATABASE_ID>?v=...`

Enrichment state is stored in a collector-owned JSON code block on each new page.
No new database property is required. Enrichment does not change the reading Status.

### 2. Mistral API

Get a free API Key from [Mistral AI Console](https://console.mistral.ai/) → API Keys (no credit card required).

### 3. GitHub

1. Fork this repo (or create a private repo).
2. Add the following secrets under Settings → Secrets and variables → Actions:
   - `NOTION_API_KEY`
   - `NOTION_DATABASE_ID`
   - `MISTRAL_API_KEY`

### 4. Slack (suspended)

The collector no longer calls Slack. Existing secrets alone do not restore automatic
posting or reaction sync. Use the reviewed outbox commands in
[Compatibility and migration](docs/reliability.md#compatibility-and-migration), or choose
to reconnect separate scheduled jobs before adopting this branch.

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

# Bounded summaries of saved pages (requires the local enrichment checkpoint)
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

Hatena / Zenn / Qiita are classified `lang: "ja"` in `SOURCE_META`. They skip Mistral.
The original feed excerpt is preserved in the processing block with status `excerpt`
and in Summary with an explicit unverified-excerpt label. Collection quotas no longer depend on language
or model capacity; the deadline leaves unsaved candidates checkpointed for replay.

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
- `maxPerSource`: retained for the `selectDiverse` helper; raw collection no longer
  truncates eligible articles to a summarization quota

Crowd-scored sources (Hacker News, Lobsters, Hatena, Qiita) expose `crowdScore` on each
article; academic sources (arXiv, HuggingFace) carry a deliberately lower base weight so
practitioner and crowd-validated content ranks higher.

Zenn is the exception that needs a base weight above `minScore`: its topic feeds carry no
crowd signal, so base weight is the only score a Zenn article is guaranteed. Below the
threshold, every Zenn item would be filtered out and the source would contribute nothing.

### Category Rules

Edit `CATEGORY_RULES` in `src/pipeline/scorer.ts`.

## Processing limits

The existing Mistral model is unchanged. Enrichment makes at most one request per
processed article, at most ten articles per run, with a 31-second inter-request delay.
Full translation no longer doubles the request count. A 429 stops that run immediately.
The 12-minute processing budget may reduce throughput further; pending count is printed
on every run. Collection makes no model requests.

## License

MIT
