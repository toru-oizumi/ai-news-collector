import { callMistral } from "./mistral-client.js";

const TRANSLATE_PROMPT = `You are a professional translator specializing in AI/ML technical content.
Translate the following English article into natural, fluent Japanese.

Rules:
- Maintain all technical terms accurately (keep proper nouns, model names, company names in English)
- Preserve paragraph structure — output one paragraph per input paragraph, separated by blank lines
- Do NOT add any commentary, headers, or explanations — just the translation
- Keep the technical depth intact for senior engineers`;

export interface TranslateResult {
  paragraphs: string[];
  tokens: number;
}

/**
 * Translate article body to Japanese.
 * Returns translated paragraphs and token usage.
 */
export async function translateArticle(
  title: string,
  bodyParagraphs: string[]
): Promise<TranslateResult> {
  const bodyText = bodyParagraphs.join("\n\n").slice(0, 8000);
  const userPrompt = `Title: ${title}\n\n---\n\n${bodyText}`;

  try {
    const { text, totalTokens } = await callMistral(TRANSLATE_PROMPT, userPrompt, 8000);

    const paragraphs = text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    return {
      paragraphs: paragraphs.length > 0 ? paragraphs : [text],
      tokens: totalTokens,
    };
  } catch (err) {
    console.warn(`[Translator] Failed for "${title}":`, err);
    return { paragraphs: [], tokens: 0 };
  }
}
