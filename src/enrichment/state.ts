import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints.js";
import type { BodyFailure, ModelFailure } from "../digest/failures.js";
import type { Article } from "../types.js";

export const STATE_MARKER = "ai-news-processing:v1";
export type ProcessingStatus =
  | "pending"
  | "ready"
  | "excerpt"
  | "body_unavailable"
  | "insufficient_evidence"
  | "non_ai"
  | "rate_limited"
  | "model_failed"
  | "invalid_response";

/** Stored in a single collector-owned code block: no database schema migration. */
export interface ProcessingState {
  marker: typeof STATE_MARKER;
  status: ProcessingStatus;
  attempts: number;
  abstract: string;
  updatedAt: string;
  nextAttemptAt?: string;
  evidence?: string[];
  input?: "article_body";
  model?: string;
  collectedAt?: string;
  summaryHash?: string;
  failure?: BodyFailure | ModelFailure;
}

export function initialState(article: Article): ProcessingState {
  return {
    marker: STATE_MARKER,
    collectedAt: article.fetchedAt.toISOString(),
    status:
      article.lang === "ja"
        ? article.abstract.trim()
          ? "excerpt"
          : "insufficient_evidence"
        : "pending",
    attempts: 0,
    abstract: article.abstract.slice(0, 1000),
    updatedAt: article.fetchedAt.toISOString(),
  };
}

export function processingBlock(state: ProcessingState): BlockObjectRequest {
  // Rich text fragments respect Notion's 2,000 character limit.
  const text = JSON.stringify(state);
  return {
    object: "block",
    type: "code",
    code: {
      language: "json",
      rich_text: Array.from({ length: Math.ceil(text.length / 2000) }, (_, i) => ({
        type: "text" as const,
        text: { content: text.slice(i * 2000, (i + 1) * 2000) },
      })),
    },
  };
}

export function readState(text: string): ProcessingState | null {
  try {
    const state = JSON.parse(text) as ProcessingState;
    return state.marker === STATE_MARKER && typeof state.attempts === "number" ? state : null;
  } catch {
    return null;
  }
}

export function eligible(state: ProcessingState, now: number): boolean {
  return (
    ["pending", "body_unavailable", "rate_limited", "model_failed"].includes(state.status) &&
    state.attempts < 3 &&
    (!state.nextAttemptAt || Date.parse(state.nextAttemptAt) <= now)
  );
}
