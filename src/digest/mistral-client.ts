import { MISTRAL_CONFIG, env } from "../config.js";

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

  const res = await fetch(MISTRAL_CONFIG.apiUrl, {
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

  if (!res.ok) {
    throw new Error(`Mistral HTTP ${res.status}`);
  }

  const data = (await res.json()) as MistralResponse;
  if (data.choices?.[0]?.finish_reason !== "stop") throw new Error("Mistral incomplete response");
  return {
    text: data.choices?.[0]?.message?.content?.trim() ?? "",
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
  };
}
