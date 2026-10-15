import { MISTRAL_CONFIG, env } from "../config.js";
import { MistralRequestError } from "./failures.js";

const SAFE_CODES = new Set([
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

/** Convert only bounded, valid Retry-After values; never retain the raw header. */
export function retryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value || value.length > 128) return undefined;
  const raw = value.trim();
  const seconds = /^\d+$/.test(raw)
    ? Number(raw)
    : /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw)
      ? Math.max(0, Math.ceil((Date.parse(raw) - now) / 1000))
      : Number.NaN;
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 7 * 24 * 60 * 60
    ? seconds
    : undefined;
}

async function errorCode(response: Response): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 8192) return undefined;
      chunks.push(next.value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const code = data?.error?.code ?? data?.code;
    if (code === undefined) return undefined;
    return typeof code === "string" && SAFE_CODES.has(code) ? code : "unrecognized";
  } catch {
    return undefined;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

interface MistralResponse {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string;
    };
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: { message: string };
}

export interface MistralResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export async function callMistral(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<MistralResult> {
  if (!env.MISTRAL_API_KEY) {
    throw new Error("MISTRAL_API_KEY is not set");
  }

  let res: Response;
  try {
    res = await fetch(MISTRAL_CONFIG.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: MISTRAL_CONFIG.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    throw new MistralRequestError({
      stage: "model",
      reason:
        error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
          ? "timeout"
          : "network_error",
    });
  }

  if (!res.ok) {
    throw new MistralRequestError({
      stage: "model",
      reason: "http_error",
      httpStatus: res.status,
      code: await errorCode(res),
      retryAfterSeconds: retryAfterSeconds(res.headers.get("retry-after")),
    });
  }

  let data: MistralResponse;
  try {
    data = (await res.json()) as MistralResponse;
  } catch {
    throw new MistralRequestError({ stage: "model", reason: "invalid_response" });
  }
  if (data?.choices?.[0]?.finish_reason !== "stop")
    throw new MistralRequestError({ stage: "model", reason: "incomplete_response" });
  return {
    text: data.choices?.[0]?.message?.content?.trim() ?? "",
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
  };
}
