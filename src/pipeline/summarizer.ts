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
 * Summarize articles using Mistral API (free tier).
 * Gracefully degrades: if API fails or quota exceeded, articles keep empty summary.
 */
export async function summarizeArticles(articles: Article[]): Promise<void> {
  if (!env.MISTRAL_API_KEY) {
    console.log("[Summarizer] No MISTRAL_API_KEY set — skipping summarization");
    return;
  }

  const toProcess = articles.slice(0, MISTRAL_CONFIG.maxSummarize);
  console.log(
    `[Summarizer] Processing ${toProcess.length} articles with ${MISTRAL_CONFIG.model}...`
  );

  let successCount = 0;
  let failCount = 0;

  for (const article of toProcess) {
    try {
      const summary = await callMistral(article);
      if (summary) {
        article.summary = summary;
        successCount++;
      } else {
        failCount++;
      }
    } catch (err: unknown) {
      failCount++;
      // If rate limited (429), back off and continue
      if (err instanceof Error && err.message.includes("429")) {
        console.warn("[Summarizer] Rate limited — pausing 60s...");
        await sleep(60_000);
        continue;
      }
      console.warn(`[Summarizer] Failed for "${article.title}":`, err);
    }

    // Respect RPM limit
    await sleep(MISTRAL_CONFIG.delayMs);
  }

  console.log(`[Summarizer] Done: ${successCount} success, ${failCount} failed`);
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

  // Parse JSON response
  try {
    const cleaned = raw
      .replace(/^```json?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
    const parsed = JSON.parse(cleaned) as { summary?: string };
    return parsed.summary ?? null;
  } catch {
    // If not valid JSON, use raw text as summary
    return raw.length > 10 ? raw.slice(0, 300) : null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
