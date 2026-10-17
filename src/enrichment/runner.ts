import { type NotionDiagnostic, NotionRequestError } from "../notion/request-policy.js";
import type { PendingPage } from "./backlog.js";
import type { EnrichmentRow } from "./processor.js";
import { type ProcessingState, eligible } from "./state.js";

export function finished(state: ProcessingState): boolean {
  return (
    (state.status !== "rate_limited" && state.attempts >= 3) ||
    ["ready", "excerpt", "non_ai", "insufficient_evidence", "invalid_response"].includes(
      state.status
    )
  );
}

export interface EnrichmentFailure {
  operation: "load" | "reserve" | "process" | "checkpoint" | "wait" | "model";
  httpStatus?: number;
}

/** Bounded FIFO processing. All I/O is injected so timeouts and replays are tested locally. */
export async function runEnrichment(
  pages: PendingPage[],
  deps: {
    load: (page: PendingPage) => Promise<EnrichmentRow | null>;
    reserve: (row: EnrichmentRow, state: ProcessingState) => Promise<void>;
    process: (
      row: EnrichmentRow
    ) => Promise<{ rateLimited: boolean; apiCalled: boolean; state: ProcessingState }>;
    checkpoint: (pages: PendingPage[]) => Promise<void>;
    wait: () => Promise<void>;
    now?: () => number;
    deadline: number;
  }
): Promise<{
  processed: number;
  pending: number;
  failed: boolean;
  rateLimited: boolean;
  failure?: EnrichmentFailure | NotionDiagnostic;
}> {
  const now = deps.now ?? Date.now;
  let pending = pages;
  let processed = 0;
  let failed = false;
  let rateLimited = false;
  let failure: EnrichmentFailure | NotionDiagnostic | undefined;
  let operation: EnrichmentFailure["operation"] = "load";
  const remove = async (page: PendingPage) => {
    operation = "checkpoint";
    const remaining = pending.filter((item) => item.pageId !== page.pageId);
    await deps.checkpoint(remaining);
    pending = remaining;
  };
  for (const page of pages) {
    // load + reserve + browser/body + model + two Notion writes + pacing/cleanup
    if (processed >= 10 || now() + 270_000 >= deps.deadline) break;
    try {
      operation = "load";
      const row = await deps.load(page);
      if (!row || finished(row.state)) {
        await remove(page); // unmanaged legacy pages are never rewritten
        continue;
      }
      if (!eligible(row.state, now())) continue;
      operation = "reserve";
      // Reserve a cooldown, not a failure attempt. If model throttling is followed
      // by a failed state write, a restart must not discard this article as exhausted.
      // Only the persisted processing result charges a completed failure attempt.
      await deps.reserve(row, {
        ...row.state,
        updatedAt: new Date(now()).toISOString(),
        nextAttemptAt: new Date(now() + 6 * 60 * 60_000).toISOString(),
      });
      processed++;
      operation = "process";
      const result = await deps.process(row);
      if (finished(result.state)) await remove(page);
      if (result.rateLimited) {
        failed = true;
        rateLimited = true;
        failure = { operation: "model", httpStatus: 429 };
        break;
      }
      if (result.apiCalled) {
        operation = "wait";
        await deps.wait();
      }
    } catch (error) {
      // A state write may have committed. Stop rather than generating more content
      // while persistence is unhealthy; the reserved cooldown bounds future runs.
      failed = true;
      failure = error instanceof NotionRequestError ? error.diagnostic : { operation };
      rateLimited = failure.httpStatus === 429;
      break;
    }
  }
  return { processed, pending: pending.length, failed, rateLimited, ...(failure && { failure }) };
}
