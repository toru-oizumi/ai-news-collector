import { MISTRAL_CONFIG, env } from "../config.js";
import type { Article } from "../types.js";

interface MistralResponse {
  choices?: {
    message?: {
      content?: string;
    };
    finish_reason?: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: { message: string };
}

const SYSTEM_PROMPT = `You are an AI/ML news curator writing for a busy Japanese software engineer.
Given an article's source, title, and abstract, respond with ONLY a JSON object (no markdown, no code fences):
{"summary": "..."}

The summary must:
- Be written in natural, technical Japanese (です・ます調).
- Be 2-3 sentences, roughly 100-250 characters.
- Lead with what is new, then why it matters, then key specifics (model names, numbers, benchmarks) when present.
- Keep product names, model names, and technical terms in their original form (e.g. GPT-5.2, Claude Code, RAG, MCP) — do not translate or transliterate them.
- Use ONLY information present in the title and abstract. If the abstract is empty, truncated, or paywalled, summarize from the title alone and never invent numbers, results, or features.
- Avoid marketing language and filler.`;

/**
 * Summarize a single article using Mistral API.
 * Sets article.summary in place. Returns total tokens used (0 on failure).
 * Includes rate-limit backoff and inter-request delay.
 */
export async function summarizeOne(article: Article): Promise<number> {
  if (!env.MISTRAL_API_KEY) return 0;

  try {
    const { summary, tokens } = await callMistral(article);
    if (summary) article.summary = summary;
    await sleep(MISTRAL_CONFIG.delayMs);
    return tokens;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes("429")) {
      console.warn("[Summarizer] Rate limited — pausing 60s...");
      await sleep(60_000);
      // Retry once after backoff
      try {
        const { summary, tokens } = await callMistral(article);
        if (summary) article.summary = summary;
        await sleep(MISTRAL_CONFIG.delayMs);
        return tokens;
      } catch {
        // Give up on this article — summary stays empty
        await sleep(MISTRAL_CONFIG.delayMs);
        return 0;
      }
    }

    // Timeout / abort / network errors — log and continue without summary
    console.warn(`[Summarizer] Skipped "${article.title.slice(0, 60)}": ${msg}`);
    await sleep(MISTRAL_CONFIG.delayMs);
    return 0;
  }
}

async function callMistral(article: Article): Promise<{ summary: string | null; tokens: number }> {
  const userPrompt = `Source: ${article.source}\nTitle: ${article.title}\nAbstract: ${article.abstract || "(no abstract provided)"}`;

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
      // ~250 JP chars can exceed 300 tokens; give headroom so the JSON isn't truncated mid-string.
      max_tokens: 400,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mistral API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as MistralResponse;
  const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
  const tokens = data.usage?.total_tokens ?? 0;

  if (data.choices?.[0]?.finish_reason === "length") {
    console.warn(`[Summarizer] Response truncated (max_tokens) for "${article.title.slice(0, 60)}"`);
  }

  return { summary: extractSummary(raw), tokens };
}

/**
 * Extract the summary text from the model's raw response.
 * Handles: bare JSON, JSON wrapped in ``` or ```json fences, JSON surrounded by
 * prose, JSON truncated mid-string (recovers the partial value), and a non-JSON
 * plain-text fallback. Exported for unit testing.
 */
export function extractSummary(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Strip a leading code fence (``` optionally followed by a language tag) and a trailing one.
  const unfenced = trimmed
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/\s*```$/, "")
    .trim();

  // 1. A complete JSON object is authoritative: if it parses, trust its summary field
  //    (or null if empty) rather than treating the braces as plain text.
  const jsonMatch = unfenced.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { summary?: unknown };
      const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
      return summary.length > 0 ? summary : null;
    } catch {
      // Malformed JSON (often truncated mid-string) — try to recover below.
    }
  }

  // 2. Recover the "summary" value even when the JSON is truncated (no closing quote/brace),
  //    so a cut-off completion yields the real text instead of leaking `{"summary": "...`.
  const partial = unfenced.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (partial) {
    const recovered = partial[1]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, " ")
      .replace(/\\\\/g, "\\")
      .trim();
    return recovered.length > 0 ? recovered.slice(0, 500) : null;
  }

  // 3. Plain-text fallback — but never return JSON-like scaffolding as the summary.
  if (unfenced.startsWith("{")) return null;
  return unfenced.length > 10 ? unfenced.slice(0, 500) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
