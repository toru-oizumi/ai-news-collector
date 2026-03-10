import { GEMINI_CONFIG, env } from "../config.js";
import type { Article } from "../types.js";

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
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
 * Summarize articles using Gemini API (free tier).
 * Gracefully degrades: if API fails or quota exceeded, articles keep empty summary.
 */
export async function summarizeArticles(articles: Article[]): Promise<void> {
  if (!env.GEMINI_API_KEY) {
    console.log("[Summarizer] No GEMINI_API_KEY set — skipping summarization");
    return;
  }

  const toProcess = articles.slice(0, GEMINI_CONFIG.maxSummarize);
  console.log(
    `[Summarizer] Processing ${toProcess.length} articles with ${GEMINI_CONFIG.model}...`
  );

  let successCount = 0;
  let failCount = 0;

  for (const article of toProcess) {
    try {
      const summary = await callGemini(article);
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
    await sleep(GEMINI_CONFIG.delayMs);
  }

  console.log(`[Summarizer] Done: ${successCount} success, ${failCount} failed`);
}

async function callGemini(article: Article): Promise<string | null> {
  const userPrompt = `Title: ${article.title}\nAbstract: ${article.abstract || "(no abstract)"}`;

  const url = `${GEMINI_CONFIG.apiUrl}/${GEMINI_CONFIG.model}:generateContent?key=${env.GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 300,
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

  // Parse JSON response
  try {
    // Strip markdown fences if present
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
