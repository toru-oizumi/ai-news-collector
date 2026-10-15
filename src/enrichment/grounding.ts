import { AI_KEYWORDS, AI_KEYWORDS_JA } from "../config.js";
import { matchesKeyword } from "../pipeline/keywords.js";

export function evidenceStatus(
  _title: string,
  paragraphs: string[]
): "non_ai" | "insufficient_evidence" | null {
  const body = paragraphs.join("\n\n").trim();
  if (body.length < 120) return "insufficient_evidence";
  if (!matchesKeyword(body, [...AI_KEYWORDS, ...AI_KEYWORDS_JA])) return "non_ai";
  return null;
}

export interface GroundedSummary {
  summary: string;
  evidence: string[];
}

/** Reject malformed/truncated responses and citations absent from the supplied body.
 * Quotes are necessary evidence, not proof of semantic accuracy; human review remains useful. */
export function parseGroundedSummary(raw: string, body: string): GroundedSummary | null {
  try {
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")) as {
      relevant?: unknown;
      summary?: unknown;
      evidence?: unknown;
    };
    if (parsed.relevant !== true || typeof parsed.summary !== "string") return null;
    const summary = parsed.summary.trim();
    if (summary.length < 30 || summary.length > 500) return null;
    if (!Array.isArray(parsed.evidence) || parsed.evidence.length < 1 || parsed.evidence.length > 5)
      return null;
    const evidence = parsed.evidence;
    if (
      !evidence.every(
        (quote): quote is string =>
          typeof quote === "string" && quote.trim().length >= 20 && body.includes(quote)
      )
    )
      return null;
    // Conservative guard against invented model names and measurements even when
    // the model supplies an unrelated but real quotation alongside its claims.
    const supported = new Set(
      (body.match(/[A-Za-z][A-Za-z0-9]*(?:[-.][A-Za-z0-9]+)*|\d+(?:\.\d+)?/g) ?? []).map((term) =>
        term.toLowerCase()
      )
    );
    const terms = summary.match(/[A-Za-z][A-Za-z0-9]*(?:[-.][A-Za-z0-9]+)*|\d+(?:\.\d+)?/g) ?? [];
    if (terms.some((term) => !supported.has(term.toLowerCase()))) return null;
    return { summary, evidence };
  } catch {
    return null;
  }
}
