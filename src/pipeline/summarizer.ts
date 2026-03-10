import { MISTRAL_CONFIG, env } from "../config.js";
import type { Article } from "../types.js";

interface MistralResponse {
  choices?: {
    message?: {
      content?: string;
    };
  }[];
  error?: { message: string };
}

const SYSTEM_PROMPT = `You are an AI/ML news curator for a Japanese engineer.
Given an article title and abstract, respond with ONLY a JSON object (no markdown fences):
{
  "summary": "2-3 sentence summary in Japanese. Be concise and technical."
}

Rules:
- Write the summary in natural Japanese
- Focus on what's new, why it matters, and key numbers/results
- If the abstract is empty or too short, summarise based on the title alone
- Keep it under 200 characters`;

/**
 * Summarize a single article using Mistral API.
 * Sets article.summary in place. Silently skips on failure.
 * Includes rate-limit backoff and inter-request delay.
 */
export async function summarizeOne(article: Article): Promise<void> {
  if (!env.MISTRAL_API_KEY) return;

  try {
    const summary = await callMistral(article);
    if (summary) article.summary = summary;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes("429")) {
      console.warn("[Summarizer] Rate limited — pausing 60s...");
      await sleep(60_000);
      // Retry once after backoff
      try {
        const summary = await callMistral(article);
        if (summary) article.summary = summary;
      } catch {
        // Give up on this article — summary stays empty
      }
      return;
    }

    // Timeout / abort / network errors — log and continue without summary
    console.warn(`[Summarizer] Skipped "${article.title.slice(0, 60)}": ${msg}`);
  }

  // Respect RPM limit between requests
  await sleep(MISTRAL_CONFIG.delayMs);
}

async function callMistral(article: Article): Promise<string | null> {
  const userPrompt = `Title: ${article.title}\nAbstract: ${article.abstract || "(no abstract)"}`;

  const res = await fetch(MISTRAL_CONFIG.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: MISTRAL_CONFIG.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 300,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mistral API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as MistralResponse;
  const raw = data.choices?.[0]?.message?.content?.trim() ?? "";

  try {
    const cleaned = raw
      .replace(/^```json?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
    const parsed = JSON.parse(cleaned) as { summary?: string };
    return parsed.summary ?? null;
  } catch {
    return raw.length > 10 ? raw.slice(0, 300) : null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
