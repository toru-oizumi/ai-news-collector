# Cloud collection and source-linked brief

The selected architecture is GitHub Actions collection and bounded enrichment, followed
by a source-linked brief that a separate parent-side reader can use for chat delivery.
No Mac, local CLI, Slack or ChatGPT direct-send API is required by the core workflow.
No live workflow, delivery, deployment, authentication or repository permission was
changed while implementing this branch.

## Workflow and defaults

`collect.yml` retains its existing six-hour schedule. It now runs:

1. Restore and validate the queue checkpoint, or stop if recovery is required.
2. Collect and save raw articles without waiting for a model.
3. Enrich at most ten saved pages within twelve minutes; stop at the first 429.
4. Build `brief.json`, `brief.md` and `manifest.json`, even after stage failures when
   the runner remains available. Upload `ai-news-brief-<run_attempt>` for thirty days.
5. The existing optional site publication includes the same brief files behind its
   existing Worker gate. No new hostname or authentication bypass is introduced.

The brief job is independent of site export/deployment and Slack. A failed build of the
site does not erase the brief artifact. A wholly cancelled runner may leave no brief;
the reader must treat missing output for the newest run as unavailable.

Slack remains opt-in. `slack-optional.yml` has **no schedule**. Its default operation
only prepares an outbox artifact. Posting and reaction-to-Notion updates require the
operator to select the operation and set `execute=true` for that run. The original
secrets alone never enable those writes. The existing explicit CLI commands remain.
Full translation is optional, produces a resumable local artifact, and cannot block
collection; automatic Notion translation appends remain disconnected.

## Output contract

The JSON schema is version 1. The bundle records:

| Field | Meaning |
| --- | --- |
| `run` | Repository, full ref, commit SHA, run ID, attempt, GitHub run URL |
| `generatedAt` / `validUntil` | UTC generation time and absolute expiry |
| `status` | `ok`, `partial`, `empty`, or `unavailable` |
| `deliveryAllowed` | Producer's eligibility decision; consumer must still verify freshness |
| `collection` / `enrichment` | Current stage reports, outcomes, timestamps and backlog counts |
| `sourceReadAt` | Time of the bounded live Notion read |
| `selection` | Maximum 3 articles, maximum 12 source candidates and sampling-limit flag |
| `articles[].id` | Stable hash of normalized source URL, for consumer delivery deduplication |
| `articles[].source` / `url` | Article attribution and direct source link |
| `publishedAt` / `collectedAt` | Publication value, when known, and precise collection time |
| `summaryKind` | `source_quoted`, `feed_excerpt`, or `none` |
| `summaryRecordedAt` / `model` | Recorded model result time/name when a source-quoted summary is used |

A source-quoted summary is shown only when the current Summary hash matches the owned
processing state, with the original body quotations retained. A manually changed or
legacy unprovenanced Summary is not silently used. Excerpts are labelled unverified;
missing summaries remain explicit. These checks do not establish semantic correctness.

The read is bounded to twelve high-scored recently created pages, not a complete global
ranking. Exact `created_time` and publication filters avoid old high-scoring rows filling
the entire day-wide `Fetched` window. Source metadata is still rechecked after reading;
old raw entries saved from a backlog can be excluded. A limited candidate window is
reported as partial. A rare mix of excluded or unmanaged candidates can yield fewer
than three results even if other valid articles exist outside that window.

### Freshness and failure rules

- Generation is valid for at most eight hours, collection for twenty-four hours, and
  known publication time for seven days. Expiry is the **earliest** of these limits.
- The consumer rechecks all limits at delivery time, including publication expiry.
  Invalid/future timestamps, repository/ref/SHA/run/attempt mismatches are rejected.
- Collection failure without a confirmed saved snapshot, invalid checkpoints, a failed
  source read, or a mismatched stage report emits diagnostic `unavailable` output with
  no articles. Zero fetched source items emits `empty`; cached items are not reused.
- Partial collection or enrichment can retain safe source-linked items, with reasons
  and backlog counts. A partial brief is never represented as full pipeline success.
- Overall workflow conclusion must be read from GitHub after completion: it can fail
  during later site publication even when the core brief is usable. Bundle stage
  status is not a claim about the later deployment outcome.
- Job summaries contain only status/count/timestamps, not the article content. The
  named artifact is the data output.

## Parent-side retrieval: real options and current blockers

### GitHub Actions artifact

The implemented output is the named artifact on the specific workflow run. Retrieval
uses existing GitHub access, for example:

```text
GET /repos/toru-oizumi/ai-news-collector/actions/workflows/collect.yml/runs?branch=develop&per_page=1
GET /repos/toru-oizumi/ai-news-collector/actions/runs/{run_id}/artifacts
GET /repos/toru-oizumi/ai-news-collector/actions/artifacts/{artifact_id}/zip
```

Select the **newest run, without a success filter**. Check that it is complete, inspect
its conclusion, and require artifact `ai-news-brief-<run_attempt>` from that same run.
Match JSON repository/ref/SHA/run/attempt against the API metadata, verify both file
hashes from the manifest, then enforce expiry and delivery eligibility. Do not fall
back to an older successful artifact if the newest run failed, was cancelled, has no
output, or cannot be read. A newest partial result can be labelled partial if its
current source data pass these checks.

The download endpoint redirects to a short-lived URL; that URL is not a permanent
feed address. GitHub authentication and suitable existing read access are required.
See [GitHub artifact API](https://docs.github.com/en/rest/actions/artifacts) and
[artifact downloads](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts).

This repository is public. Authentication to download an artifact does **not** make
that artifact private to the owner; repository readers may be able to download it.
Review the generated article/checkpoint visibility before production adoption. No
new public repository commit of generated news is made by this implementation.

**Unresolved integration check:** the available GitHub MCP tools do not expose Actions
artifact download, and this task did not verify an authenticated download from the
parent's scheduled cloud environment. A Mac's existing `gh` login cannot be assumed to
exist there. The parent must complete one harmless download test using an already
available authorized connection before scheduling chat delivery. This branch adds no
new long-lived token or expanded permission. Cross-run recovery and optional Slack
artifact operations also fail before writes if existing Actions read access is absent.

### Existing gated Workers site

After an authorized deployment to the existing host, the same files are available at:

```text
https://<existing-host>/brief/brief.json
https://<existing-host>/brief/brief.md
https://<existing-host>/brief/manifest.json
```

These are implementation paths, **not verified live URLs**. The repository contains
Worker name `ai-news-web`, but no actual hostname. All paths retain the existing
`SITE_TOKEN` cookie gate. No secret was read or saved, and no public route was added.
The parent must already have usable existing authentication and confirm it can read
these paths. A fixed site URL can retain an older deployment after a failed publish;
therefore it still requires newest-run comparison and expiry checks. Site-only access
without a way to verify the latest producer run is insufficient for the strict policy.

Committing a generated brief to the public repository would provide a different readable
URL, but would require publication and potentially write access. It is not implemented
or authorized as an automatic fallback.

### One-week morning trial

The parent will separately configure a one-week trial around 08:00 JST (23:00 UTC).
At that time, the normal newest scheduled collection is 18:00 UTC (03:00 JST), so its
brief normally remains within the eight-hour generation window. This has an offline
regression test; no schedule was enabled here. The existing six-hour cadence need not
change for that trial.

The parent should retain the last delivered run/attempt and article IDs, send at most
three unseen articles, and record delivery only after its chat operation succeeds.
Consumer state is separate from producer state; this repo does not assume an unseen
ChatGPT send API or an available acknowledgement store. If that state or the source
cannot be verified, report unavailability rather than resend guessed news. Stop after
the approved week; the parent controls that schedule and delivery destination.

## Checkpoint loss and recovery without a permanently connected Mac

Checkpoints contain a manifest of the exact JSON file set, hashes and repository/ref.
Each stage validates before work and seals after work before cache/artifact upload.
A cache miss is **not** an implicit fresh start anymore. The next scheduled run fails
closed, emits a diagnostic brief where possible, and requires recovery.

First adoption uses a separately authorized workflow-dispatch run with `bootstrap=true`.
This acknowledges that no unsaved legacy queue is available and creates a new queue.
The default is false on all later scheduled runs. It is an operation in Actions, not
an always-on local process.

For recovery, select the newest complete collection/enrichment checkpoint artifact in
the GitHub UI, then dispatch Collect with `recovery_run_id` and exact
`recovery_artifact`. This uses the existing GitHub job token to download that artifact,
clears the transient cache directory, and validates all files before processing. The
same-run enrichment handoff uses the artifact directly. Incomplete, wrong-ref, corrupt,
or unapproved missing checkpoints block work rather than silently losing queue state.

This is practical recovery, not a transactional message broker. An unsaved item can
still be lost if the runner disappears before any checkpoint upload and the source
feed drops it. An expired/deleted recovery artifact cannot reconstruct that item.
Notion URL lookup reconciles ambiguous creates, but external concurrent writers and
delayed visibility can still create duplicates. Cache loss, missing artifacts and
failed integrity checks must remain visible operational failures.

## Optional Slack in Actions

The separate `Optional Slack Operations` workflow is manual and independent of the core:

1. `prepare`: specify the source collection run and its brief artifact. It validates
   the newest run and freshness, then uploads `reviewed-slack-<run_id>` without posting.
2. Review the outbox and source files. `deliver` requires that exact artifact and
   `execute=true`. It rechecks the newest collection before posting and verifies the
   configured channel. No review file or cached credential is needed on a Mac.
3. Before posting, it uploads a durable intent artifact. Later retries must use the
   newest intent's result ledger; the original prepared copy is rejected. Known sent
   entries are skipped, while interrupted/uncertain sends require reconciliation.
4. `reactions` with `execute=true` invokes the preserved reaction sync, independently
   of collection. Higher ranked reading statuses are preserved.

There is no automatic Slack schedule and no Slack dependency for chat briefs. Intent
and result artifacts stay thirty days, longer than the brief's eight-hour lifetime.
If an intent exists but no trustworthy result survives, sending stops; it does not
recreate an empty delivery ledger from a cache miss. Repository artifact permissions
and user-approved artifact visibility still need to be verified before using this path.

## Adoption checklist and evidence

No production step below was performed:

1. Review and adopt the branch through the normal approved repository process.
2. Verify the Collect workflow is enabled. Read-only inspection on October 15 showed
   it as Disabled in the [Actions listing](https://github.com/toru-oizumi/ai-news-collector/actions).
3. Authorize the first explicit bootstrap (or restore a real checkpoint) and observe
   collection, bounded enrichment, brief artifact generation and status reports.
4. Confirm a harmless parent-side artifact download or existing-site read, with
   newest-run metadata checks. Do not solve access failures by publishing credentials,
   bypassing the site gate or assuming wider permissions.
5. Only then configure the separate one-week 08:00 JST chat trial and its deduplication
   state. Leave optional Slack off unless deliberately selected.

Local verification covers old/failed/newer-run refusal, publication/collection/brief
expiry, the morning window, file corruption, checkpoint provenance, source-summary
hash mismatch, stage failure reports, optional delivery replay guards, and the unchanged
Worker gate on all three brief assets. External APIs and messages are mocked in tests;
workflow timing, GitHub authorization and live retrieval remain unverified until adoption.

Verified locally: 175 core tests and 41 Worker tests pass, including the four new
brief gate cases. TypeScript, Biome, Markdown lint and Actionlint pass. Astro checks
report no errors or warnings; the fixture build produces nineteen pages and copies
all three brief assets while retaining `deliveryAllowed=false` for unavailable data.
