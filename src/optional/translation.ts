import { createHash } from "node:crypto";

export interface TranslationInput {
  title: string;
  url: string;
  paragraphs: string[];
}
export interface TranslationCheckpoint {
  version: 1;
  sourceHash: string;
  next: number;
  paragraphs: string[];
  complete: boolean;
}

/** Split the ENTIRE supplied body, rather than silently dropping everything after 8k. */
export function translationChunks(input: TranslationInput): string[] {
  const text = input.paragraphs.join("\n\n");
  if (!text.trim()) throw new Error("Article body is required for translation");
  return Array.from({ length: Math.ceil(text.length / 3000) }, (_, index) =>
    text.slice(index * 3000, (index + 1) * 3000)
  );
}
export async function translateNext(
  input: TranslationInput,
  checkpoint: TranslationCheckpoint | null,
  translate: (title: string, paragraphs: string[]) => Promise<{ paragraphs: string[] }>
): Promise<TranslationCheckpoint> {
  const chunks = translationChunks(input);
  const sourceHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const state: TranslationCheckpoint = checkpoint ?? {
    version: 1,
    sourceHash,
    next: 0,
    paragraphs: [],
    complete: false,
  };
  if (
    state.version !== 1 ||
    state.sourceHash !== sourceHash ||
    state.next < 0 ||
    state.next > chunks.length
  )
    throw new Error("Translation checkpoint does not match this input");
  if (state.next === chunks.length) return state;
  const translated = await translate(input.title, [chunks[state.next]]);
  if (!translated.paragraphs.length || !translated.paragraphs.join("").trim())
    throw new Error("Translation failed; checkpoint unchanged");
  return {
    ...state,
    next: state.next + 1,
    paragraphs: [...state.paragraphs, ...translated.paragraphs],
    complete: state.next + 1 === chunks.length,
  };
}
