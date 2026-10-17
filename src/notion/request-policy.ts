/** One serial queue for reads and idempotent updates on a Notion client. */
export type NotionOperation =
  | "enrichment_load"
  | "enrichment_reserve"
  | "summary_update"
  | "state_update"
  | "brief_query"
  | "brief_state";
export interface NotionDiagnostic {
  stage: "notion";
  operation: NotionOperation;
  reason: "request_failed" | "rate_limited" | "budget_exhausted";
  httpStatus?: number;
  attempts: number;
  retries: number;
  retryAfterSeconds?: number;
}
export class NotionRequestError extends Error {
  constructor(public readonly diagnostic: NotionDiagnostic) {
    super(`Notion ${diagnostic.operation}: ${diagnostic.reason}`);
  }
}

function failure(error: unknown, now: number): { httpStatus?: number; retryAfterSeconds?: number } {
  if (!error || typeof error !== "object") return {};
  const e = error as {
    status?: unknown;
    headers?: { get?: (key: string) => unknown; [key: string]: unknown };
  };
  const httpStatus =
    typeof e.status === "number" && Number.isInteger(e.status) && e.status >= 100 && e.status <= 599
      ? e.status
      : undefined;
  const raw =
    typeof e.headers?.get === "function"
      ? e.headers.get("retry-after")
      : e.headers?.["retry-after"];
  let seconds: number | undefined;
  if (typeof raw === "string" && raw.trim()) {
    const numeric = Number(raw);
    const parsed = Number.isFinite(numeric) ? numeric : (Date.parse(raw) - now) / 1000;
    if (Number.isFinite(parsed) && parsed >= 0) seconds = Math.ceil(parsed);
  }
  return { httpStatus, retryAfterSeconds: seconds };
}

export class NotionRequestPolicy {
  private tail: Promise<unknown> = Promise.resolve();
  private nextStart = 0;
  constructor(
    private readonly options: {
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
      deadline?: number;
      diagnostic?: (diagnostic: NotionDiagnostic) => void;
    } = {}
  ) {}

  request<T>(
    operation: NotionOperation,
    action: () => Promise<T>,
    deadline = Number.POSITIVE_INFINITY
  ): Promise<T> {
    const task = this.tail.then(() => this.execute(operation, action, deadline));
    this.tail = task.catch(() => undefined);
    return task;
  }

  private async execute<T>(
    operation: NotionOperation,
    action: () => Promise<T>,
    deadline: number
  ): Promise<T> {
    const now = this.options.now ?? Date.now;
    const sleep =
      this.options.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    // SDK requests use a 10s timeout. Do not start one without enough remaining budget.
    const end = Math.min(
      deadline,
      this.options.deadline ?? Number.POSITIVE_INFINITY,
      now() + 30_000
    );
    let attempts = 0;
    let last: ReturnType<typeof failure> = {};
    const diagnostic = (reason: NotionDiagnostic["reason"]): NotionDiagnostic => ({
      stage: "notion",
      operation,
      reason,
      ...last,
      attempts,
      retries: Math.max(0, attempts - 1),
    });
    const stop = (reason: NotionDiagnostic["reason"]): never => {
      const detail = diagnostic(reason);
      this.options.diagnostic?.(detail);
      throw new NotionRequestError(detail);
    };
    while (attempts < 3) {
      const wait = Math.max(0, this.nextStart - now());
      if (now() + wait + 10_000 > end) stop("budget_exhausted");
      if (wait) await sleep(wait);
      if (now() + 10_000 > end) stop("budget_exhausted");
      this.nextStart = now() + 400; // Below Notion's average 3 requests/second, including skipped rows.
      attempts++;
      try {
        return await action();
      } catch (error) {
        last = failure(error, now());
        if (last.httpStatus !== 429) stop("request_failed");
        // Honor the server even when too long to retry in this run; never clamp and retry early.
        this.nextStart = Math.max(
          this.nextStart,
          now() + (last.retryAfterSeconds ?? 2 ** (attempts - 1)) * 1000
        );
        if (attempts >= 3) stop("rate_limited");
        this.options.diagnostic?.(diagnostic("rate_limited"));
      }
    }
    return stop("rate_limited");
  }
}

const policies = new WeakMap<object, NotionRequestPolicy>();
export function notionPolicy(client: object): NotionRequestPolicy {
  let policy = policies.get(client);
  if (!policy) {
    policy = new NotionRequestPolicy();
    policies.set(client, policy);
  }
  return policy;
}
