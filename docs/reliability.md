# Reliability and summary quality

This change is based on `2b38902` (the default `develop` branch at checkout).
No live collector, Notion mutation, Slack message, workflow dispatch, deployment,
permission change, or model/service change was performed during development.

## Problem and first-stage scope

Collection previously summarized before saving each article. A 429 could consume a
60-second retry plus 31-second pacing delay for every article. The scheduled job had
45 minutes, while delivery and dependent workflows waited for the loop to finish.
A failed duplicate lookup was ignored and a failed create was retried blindly.
The supplied incident reports 39 of 65 saved before cancellation.

Collection now saves raw evidence without Mistral. English summaries run afterward;
full translation and Slack posting/reaction sync are suspended in the entry points.
The existing optional site publishing code remains, but was not executed for this work.
No new schedule or external integration has been added.

## Collection and replay

- Every scored/filtered candidate enters `.runtime/pending.json` before a Notion write.
  The old English/Japanese model quotas no longer discard eligible candidates.
- `.runtime/confirmed.json` remembers successful saves so a large, mostly unchanged
  feed does not require thousands of Notion lookups every six hours.
- Before an unconfirmed save, the collector queries Notion for URL spellings covering
  HTTP/HTTPS, `www`, and trailing slashes. A query failure prevents creation.
- Create is attempted once. If its response is lost, the raw entry stays pending;
  the next run queries by URL before considering another create. New page properties
  and the raw-evidence processing block are created together.
- A confirmed page is added to `.runtime/enrichment.json` before its URL is marked
  confirmed and its raw pending entry is removed. A crash between these writes can
  replay safely and repair a missing enrichment enqueue.
- JSON checkpoints use write-to-temp plus rename. Invalid JSON fails visibly.
  Do not run concurrent local collectors against the same database/checkpoint directory.
- Collection checks an eight-minute deadline before each save, reserving 90 seconds
  for final requests and checkpointing. It checkpoints unfinished work instead of
  waiting for a 45-minute cancellation. Individual requests have a 20-second timeout.
  Query/create calls are paced at 350 ms; creates are not automatically retried.

Workflow and job concurrency groups serialize the pipeline and checkpoint writers,
including standalone manual enrichment. Each stage restores the latest branch-scoped
checkpoint, saves it under a unique run/attempt key even after failure, and uploads a
30-day recovery artifact. No credentials are put in these files. The files do contain
article excerpts and URLs, so keep recovery artifacts within the repository's access
boundary.

The collector publishes its `ready` output as soon as it confirms a saved page, before
later checkpoint/save work can fail. Dependent jobs use this output with an explicit
status condition. A partial collection can therefore proceed to enrichment and site
export, and an enrichment failure does not suppress publication of raw saved articles.
A wholly failed save attempt is reported as a failed collector, with its pending queue
retained. A partial run emits a warning with the pending count.

## Enrichment and abstention

New pages carry a JSON code block marked `ai-news-processing:v1`. It stores the original
feed excerpt, attempts, retry time, result state, model name and supporting body quotes.
It uses existing page blocks, so no database schema migration is needed.

| State | Meaning | Automatic retry |
| --- | --- | --- |
| `pending` | Raw article saved; summary not generated | Yes |
| `excerpt` | Japanese feed excerpt preserved as source material | No model call |
| `ready` | Complete model response passed evidence checks | No |
| `body_unavailable` | Fetch, HTTP, content type or extraction failed | After 6 hours, at most 3 attempts |
| `rate_limited` | Mistral returned 429; the entire run stops | After 6 hours, at most 3 attempts |
| `model_failed` | Transport, timeout or incomplete model response | After 6 hours, at most 3 attempts |
| `insufficient_evidence` | Body too short to support a summary | No |
| `non_ai` | Title/body fails the AI-topic gate | No |
| `invalid_response` | Invalid JSON, abstention or unsupported output | No |

A run handles at most ten eligible pages within a twelve-minute processing budget.
It reserves an attempt in the page block before generating content. An interrupted run
therefore cannot retry one poison article indefinitely. Three attempts exhaust the
automatic retry allowance, even when the last attempt was interrupted. A persistence
failure stops enrichment with a failed job; saved collection can still be published.

Only recognizable `article`, `main`, or `[role=main]` content is extracted; page-wide
navigation is not a substitute for article text. HTTP failures, non-HTML responses,
missing bodies and short text never fall back to title-only generation. The mixed Simon
Willison feed now has an AI keyword filter. The Northern Gannet regression fixture is a
synthetic bird-observation example based on the supplied incident, not a fetched copy
of the source article.

There is one Mistral call per eligible article, using the existing model. Responses must
finish normally, parse as complete JSON, include exact body quotations, and contain no
Latin terms or numbers absent from the supplied body. Plain prose and truncated JSON
are rejected. Prompt text treats article content as untrusted source data. These checks
reduce unsupported content; matching quotations do not prove semantic correctness.
The conservative topic/term checks can reject valid articles and paraphrases.

Successful enrichment replaces the same `Summary` property and owned code block.
It never appends digest/translation blocks and never changes user reading `Status`.
Historical pages without the marker are ignored. Their old summaries and page bodies
are not automatically rewritten or certified as correct.

## Local brief and checkpoint recovery

A short source-linked preview can be produced from an existing local site snapshot:

```bash
npm run brief -- path/to/articles.json
npm run brief -- path/to/articles.json --include-unverified-summaries
```

It shows at most three distinct articles, newest collection day then score. The default
uses titles and direct source links, since historical `Summary` fields lack trustworthy
provenance. The explicit summary flag labels and truncates them as unverified. It makes
no network call and sends nothing to Slack or ChatGPT. The committed site fixture is
synthetic and can be used to review the format without credentials:

```bash
node --no-deprecation --import tsx src/brief-main.ts web/src/data/articles.fixture.json
```

For an ordinary replay, retain `.runtime/` and rerun the appropriate entry point only
when live execution is authorized. After cache loss, download the latest collection
and enrichment checkpoint artifacts, compare their timestamps, and restore all JSON
files from the latest complete stage into `.runtime/`. An incomplete restore can
reintroduce stale queue entries; Notion lookup and managed state checks reconcile them.
If no checkpoint artifact remains, saved pages can be re-enqueued from an existing local
site export, without an API call:

```bash
npm run recover:enrichment -- path/to/articles.json
```

This command changes only the local queue. Later enrichment reads each page's marker;
legacy pages without a marker are skipped. Unsaved raw candidates require the pending
checkpoint or a source refetch. Cache eviction and artifact expiry are not a durable
message queue. A runner loss before any checkpoint upload can lose unsaved candidates
that disappear from their feeds; this implementation cannot guarantee recovery of those
articles. Notion has no unique URL constraint or create idempotency key. Concurrent
external writers or delayed visibility after an ambiguous create can still defeat URL
reconciliation. These limitations need a durable transactional store for stronger
exactly-once guarantees; this change does not introduce one.

## Offline verification and review

Local validation passed: 19 Vitest files / 144 tests, TypeScript, Biome, Markdown lint,
`actionlint` for all three pipeline workflows, YAML parsing and `git diff --check`.
The digest dry run and fixture brief also completed without API calls. The installed
`actionlint` binary was invoked directly to avoid changing the local mise trust setting.

```bash
npm ci --ignore-scripts
npm run check
npm run typecheck
npm run test:run
npm run lint:md
node --no-deprecation --import tsx src/digest-main.ts --dry-run
node --no-deprecation --import tsx src/brief-main.ts web/src/data/articles.fixture.json
git diff --check
```

`collect:dry` still fetches real news feeds; it was deliberately not used for these
checks. The direct Node commands avoid the tsx CLI's IPC listener, which is prohibited
by the local execution sandbox. They use the same TypeScript loader.

Regression coverage includes 65 raw saves, partial-save replay, ambiguous committed
creates, failed duplicate queries, semantic URL query parameters, atomic checkpoints,
missing/non-HTML bodies, mixed-feed bird sightings, fabricated metrics, truncated model
responses, the first-429 circuit, the ten-page/time budgets and idempotent Summary/state
updates. Model/Notion/fetch calls in these tests are mocked.

The supplied 6,827-row CSV is not present in this checkout. The reported 2,318 empty
summaries and overall semantic error rate have not been independently measured here.
Backfilling or correcting historical data is a separate reviewed operation. Throughput
and runtime under real service latency remain unmeasured. If collection exceeds ten
English articles per run on average, the bounded enrichment backlog will grow; raw
articles remain saved and can be browsed while enrichment is pending.
