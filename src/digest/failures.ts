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
  codeStatus?: "present" | "missing" | "no_body" | "oversized" | "invalid_json" | "read_failed";
  retryAfterStatus?: "valid" | "missing" | "invalid";
  codeKind?: "number" | "numeric_string" | "string" | "null" | "other";
  providerType?:
    | "invalid_request_error"
    | "authentication_error"
    | "rate_limit_error"
    | "server_error"
    | "unrecognized";
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

/** Retain the same finite fields at report/checkpoint boundaries, including restored JSON. */
export function safeModelFailure(value: unknown): ModelFailure | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as ModelFailure;
  if (
    input.stage !== "model" ||
    !["http_error", "timeout", "network_error", "incomplete_response", "invalid_response"].includes(
      input.reason
    )
  )
    return undefined;
  const result: ModelFailure = { stage: "model", reason: input.reason };
  if (
    typeof input.httpStatus === "number" &&
    Number.isInteger(input.httpStatus) &&
    input.httpStatus >= 100 &&
    input.httpStatus <= 599
  )
    result.httpStatus = input.httpStatus;
  if (input.code !== undefined) result.code = modelCodeDetails(input.code).code;
  // Do not infer the original kind from a previously redacted `unrecognized` string.
  if (["number", "numeric_string", "string", "null", "other"].includes(input.codeKind ?? ""))
    result.codeKind = input.codeKind;
  if (input.providerType !== undefined) result.providerType = safeProviderType(input.providerType);
  if (
    typeof input.retryAfterSeconds === "number" &&
    Number.isSafeInteger(input.retryAfterSeconds) &&
    input.retryAfterSeconds >= 0 &&
    input.retryAfterSeconds <= 7 * 86400
  )
    result.retryAfterSeconds = input.retryAfterSeconds;
  if (
    ["present", "missing", "no_body", "oversized", "invalid_json", "read_failed"].includes(
      input.codeStatus ?? ""
    )
  )
    result.codeStatus = input.codeStatus;
  if (["valid", "missing", "invalid"].includes(input.retryAfterStatus ?? ""))
    result.retryAfterStatus = input.retryAfterStatus;
  return result;
}

export const SAFE_MODEL_CODES = new Set([
  "rate_limit_exceeded",
  "rate_limited",
  "too_many_requests",
  "insufficient_quota",
  "quota_exceeded",
  "invalid_api_key",
  "unauthorized",
  "invalid_request_error",
  "invalid_request",
  "model_not_found",
  "unknown_model",
  "server_error",
  "overloaded",
  "context_length_exceeded",
]);

/** Only finite classification labels are retained for unknown raw codes. */
export function modelCodeDetails(value: unknown): Pick<ModelFailure, "code" | "codeKind"> {
  const codeKind =
    typeof value === "number"
      ? "number"
      : typeof value === "string"
        ? /^\d+$/.test(value)
          ? "numeric_string"
          : "string"
        : value === null
          ? "null"
          : "other";
  return {
    code: typeof value === "string" && SAFE_MODEL_CODES.has(value) ? value : "unrecognized",
    codeKind,
  };
}

// Official error response categories: https://docs.mistral.ai/resources/error-glossary
export function safeProviderType(value: unknown): NonNullable<ModelFailure["providerType"]> {
  return typeof value === "string" &&
    ["invalid_request_error", "authentication_error", "rate_limit_error", "server_error"].includes(
      value
    )
    ? (value as NonNullable<ModelFailure["providerType"]>)
    : "unrecognized";
}
