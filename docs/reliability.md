# Reliability and summary quality

The selected automatic cloud collection/enrichment/brief path and current adoption
requirements are documented in [Cloud brief](cloud-brief.md). The manual commands below
remain available for inspection and optional operations.

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
Explicit optional commands preserve manual delivery, reaction sync and local full
translation. The existing optional site publishing code remains, but was not executed.
No new schedule or external integration has been added.

## Collection and replay

- Every scored/filtered candidate enters `.runtime/pending.json` before a Notion write.
  The old English/Japanese model quotas no longer discard eligible candidates.
- Within each bounded save window, articles published in the last seven days run first,
  newest publication first, with score breaking ties. Old, unknown-date and future-date
  entries remain in FIFO order afterward; no backlog is discarded. When a rediscovered
  URL wins scoring, its original backlog collection time and known publication date
  are retained. Reprioritization
  does not make old news eligible for the brief or pad a short brief with old articles.
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
30-day recovery artifact. The called enrichment workflow also downloads the collector
artifact from the same run, so cache upload/lookup failure cannot silently substitute an
older queue during the collection-to-enrichment handoff. Missing handoff artifacts fail
enrichment; saved raw data can still reach the existing publish job. A failed handoff
does not republish an older restored checkpoint as a new enrichment checkpoint. No credentials are put in these files. The files do contain
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
| `excerpt` | Japanese feed excerpt retained in Summary with an unverified label | No model call |
| `ready` | Complete model response passed evidence checks | No |
| `body_unavailable` | Fetch, HTTP, content type or extraction failed | After 6 hours, at most 3 attempts |
| `rate_limited` | Mistral returned 429; the entire run stops | After 6 hours, at most 3 attempts |
| `model_failed` | Transport, timeout or incomplete model response | After 6 hours, at most 3 attempts |
| `insufficient_evidence` | Body too short to support a summary | No |
| `non_ai` | Title/body fails the AI-topic gate | No |
| `invalid_response` | Invalid JSON, abstention or unsupported output | No |

Processing state optionally includes a `failure` diagnostic. Body diagnostics distinguish
HTTP status, unsupported content type, missing article container, empty extracted text,
timeout, network failure and browser failure, with the HTTP/browser transport recorded.
They do not claim to identify the upstream reason behind an HTTP 403.

The [Mistral error format](https://docs.mistral.ai/resources/error-glossary) includes
a machine-readable code separately from its message. Model diagnostics record HTTP
status, a fixed allowlist of provider error codes
(other values become `unrecognized`) and valid `Retry-After` values as seconds.
Error-code parsing reads at most 8 KiB; messages, response text, raw headers, request
URLs and exception messages are neither logged nor added to the diagnostic. Invalid,
negative or greater-than-seven-day retry hints are omitted. These hints are diagnostic
only: the six-hour delay, three-attempt limit and immediate stop on 429 are unchanged.
Diagnostics replace the previous attempt's failure; successful recovery clears it.

The enrichment queue keeps its existing FIFO order in this change. Fresh raw saves
remain browsable without waiting for a model. Automatic chat briefs now require a
body-grounded summary; titles and unverified feed excerpts cannot fill their slots.
Fresh AI summaries may still wait behind managed enrichment backlog. Old/unmanaged pages are not migrated.

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
The topic gate now requires evidence in the body itself, not only an AI-related title.
These checks do not detect all reversed causality, wrong subjects or invented Japanese
claims. The conservative topic/term checks can reject valid articles and paraphrases.

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

## Compatibility and migration

This branch is **not a drop-in behavior-preserving replacement** for the previous
schedule. No live schedule was changed, but adopting it as-is would stop automatic
Slack parent/reply posts, Slack reaction-to-Status sync, full-translation page appends,
and automatic `Unread` to `Digested` transitions. Existing Slack/Mistral secrets alone
do not re-enable those paths. Historical messages, translations and Status values are
retained. Japanese excerpts remain visible in Summary with an unverified label.

The following explicit commands preserve manual use without reconnecting a schedule.
They were tested with mocks or local fixtures only. Commands containing `--execute`
perform external actions and require separate execution authorization; none were run
against live services during development.

```bash
# Local preparation only; review the generated file. Refuses to overwrite an outbox.
npm run optional:slack -- prepare snapshot.json outbox.json CHANNEL_ID

# Only when posting is authorized; checks channel against SLACK_CHANNEL_ID.
npm run optional:slack -- deliver outbox.json --execute

# Only when Notion Status writes are authorized; preserves higher ranked statuses.
npm run optional:reactions -- --execute

# Existing Mistral model; one chunk per call, resumable local output, no Notion append.
npm run optional:translate -- body.json translation.json --execute
```

`body.json` contains `title`, `url` and `paragraphs` (a string array). Repeat translation
with the same input/output after respecting Mistral pacing until `complete` is true.
All supplied input is chunked, including text beyond the old 8,000-character truncation.
Completion means all chunks were processed, not that semantic fidelity was verified.
Keep translation invocations serial. The old append-only Notion writer is deliberately
not reconnected: its multi-request append can duplicate sections after a partial failure.
**Automatic full translation into Notion is still unavailable in this branch.** The
local translation artifact is a manual alternative, not identical behavior.

Slack delivery retains parent plus per-article replies and source links in fallback
text so reactions can resolve the article. It locks the outbox locally, records intent
before each post, and persists confirmed timestamps. Replays skip confirmed posts;
only an explicit HTTP 429 rejection is automatically retryable on a later invocation.
Transport errors, server errors, malformed results, and interrupted `sending` records
require manual reconciliation with Slack history. Do not delete/reset the ledger or
create another file for the same batch to bypass this safeguard. The same retained
outbox provides replay protection; losing it or intentionally creating a second batch
can duplicate delivery. Exactly-once delivery is not claimed. Stored summaries in the
prepared batch are labelled unverified and should be reviewed before posting.

The selected policy is now automatic collection/enrichment/brief output in Actions,
with parent-side chat delivery configured separately after a successful retrieval test.
The optional Slack workflow preserves manual cloud use, with no schedule and an explicit
execution flag. Full Notion translation remains optional follow-up work; the unsafe
append-only writer is not reconnected. See [Cloud brief](cloud-brief.md) for these defaults.

Independent review identified the Japanese-Summary regression, missing fallback source
links for reaction sync, and ambiguous Slack responses incorrectly classed as retryable.
These were fixed with regression tests. The remaining automatic-delivery/Notion-translation
migration differences are product choices and must not be described as a permanent
feature removal requested by the user.

## Offline verification and review

Local validation passed: 26 Vitest files / 212 tests, TypeScript, Biome, Markdown lint,
`actionlint` for the pipeline and optional Slack workflows, YAML parsing and `git diff --check`.
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
updates. Added coverage saves a new article ahead of 3,502 old entries within a
one-save budget, retains original collection dates on duplicate rediscovery, refuses
to pad briefs with old backlog, and checks failure-reason separation and diagnostic
redaction. Model/Notion/fetch calls in these tests are mocked.

The supplied 6,827-row CSV is not present in this checkout. The reported 2,318 empty
summaries and overall semantic error rate have not been independently measured here.
Backfilling or correcting historical data is a separate reviewed operation. Throughput
and runtime under real service latency remain unmeasured. If collection exceeds ten
English articles per run on average, the bounded enrichment backlog will grow; raw
articles remain saved and can be browsed while enrichment is pending.
