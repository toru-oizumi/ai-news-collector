/** Allowlisted diagnostics only: never persist URLs, headers, response text or exceptions. */
export interface BodyFailure {
  stage: "body";
  reason:
    | "http_error"
    | "unsupported_content_type"
    | "missing_article"
    | "empty_article"
    | "timeout"
    | "network_error"
    | "browser_error";
  transport: "http" | "browser";
  httpStatus?: number;
}

export interface BodyFetchResult {
  paragraphs: string[];
  failure?: BodyFailure;
}

export interface ModelFailure {
  stage: "model";
  reason: "http_error" | "timeout" | "network_error" | "incomplete_response" | "invalid_response";
  httpStatus?: number;
  code?: string;
  retryAfterSeconds?: number;
}

export class MistralRequestError extends Error {
  constructor(public readonly diagnostic: ModelFailure) {
    super(
      diagnostic.httpStatus
        ? `Mistral HTTP ${diagnostic.httpStatus}`
        : `Mistral ${diagnostic.reason.replaceAll("_", " ")}`
    );
  }
}
