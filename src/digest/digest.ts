import { callMistral } from "./mistral-client.js";

const DIGEST_PROMPT = `You are an AI/ML news analyst writing for a senior Japanese engineer.
Given an article's title and body text, produce a JSON object (no markdown fences):
{
  "digest": "Detailed summary in Japanese, 400-600 characters. Cover what was announced, why it matters, technical details, and impact.",
  "key_points": ["point1 in Japanese", "point2", "point3"]
}

Rules:
- Write entirely in natural Japanese
- 3-5 key points
- If body is short, do your best with available info`;

export interface DigestResult {
  digest: string;
  keyPoints: string[];
  tokens: number;
}

export async function generateDigest(
  title: string,
  bodyParagraphs: string[]
): Promise<DigestResult | null> {
  const bodyText = bodyParagraphs.join("\n\n").slice(0, 6000);
  const userPrompt = `Title: ${title}\n\nBody:\n${bodyText}`;

  try {
    const { text, totalTokens } = await callMistral(DIGEST_PROMPT, userPrompt, 1500);
    const cleaned = text
      .replace(/^```json?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
    const parsed = JSON.parse(cleaned) as { digest?: string; key_points?: string[] };
    return {
      digest: parsed.digest ?? "",
      keyPoints: parsed.key_points ?? [],
      tokens: totalTokens,
    };
  } catch (err) {
    console.warn(`[Digest] Failed for "${title}":`, err);
    return null;
  }
}
