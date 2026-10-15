import type { PendingPage } from "./backlog.js";
import type { EnrichmentRow } from "./processor.js";
import { type ProcessingState, eligible } from "./state.js";

export function finished(state: ProcessingState): boolean {
  return (
    state.attempts >= 3 ||
    ["ready", "excerpt", "non_ai", "insufficient_evidence", "invalid_response"].includes(
      state.status
    )
  );
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
): Promise<{ processed: number; pending: number; failed: boolean }> {
  const now = deps.now ?? Date.now;
  let pending = pages;
  let processed = 0;
  let failed = false;
  const remove = async (page: PendingPage) => {
    pending = pending.filter((item) => item.pageId !== page.pageId);
    await deps.checkpoint(pending);
  };
  for (const page of pages) {
    // load + reserve + browser/body + model + two Notion writes + pacing/cleanup
    if (processed >= 10 || now() + 210_000 >= deps.deadline) break;
    try {
      const row = await deps.load(page);
      if (!row || finished(row.state)) {
        await remove(page); // unmanaged legacy pages are never rewritten
        continue;
      }
      if (!eligible(row.state, now())) continue;
      await deps.reserve(row, {
        ...row.state,
        attempts: row.state.attempts + 1,
        updatedAt: new Date(now()).toISOString(),
        nextAttemptAt: new Date(now() + 6 * 60 * 60_000).toISOString(),
      });
      processed++;
      const result = await deps.process(row);
      if (finished(result.state)) await remove(page);
      if (result.rateLimited) break;
      if (result.apiCalled) await deps.wait();
    } catch {
      // A state write may have committed. Stop rather than generating more content
      // while persistence is unhealthy; the saved attempt count bounds future runs.
      failed = true;
      break;
    }
  }
  return { processed, pending: pending.length, failed };
}
