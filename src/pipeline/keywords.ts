/**
 * Shared keyword matching for source filters.
 *
 * Short keywords ("ai", "gpt", "rag", "mcp") are matched on word boundaries so they
 * don't fire on substrings — without this, "rag" matches "storage" and "ai" matches
 * "available", which is how general-interest feeds leak non-AI items through.
 * Longer keywords use plain substring matching so prefixes like "fine-tun" still work.
 *
 * Japanese text is unaffected by the boundary check: JavaScript's \b is defined against
 * [A-Za-z0-9_], so a Latin keyword sitting next to a Japanese character (e.g. "生成AIが")
 * still sees a boundary on both sides.
 */

/** Keywords at or below this length are matched as whole words. */
const BOUNDARY_MAX_LENGTH = 3;

/** Escape regex metacharacters so keywords like "c++" can't corrupt the pattern. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Test whether `text` matches any of `keywords`.
 * Both sides are lowercased, so callers may pass keywords in any case.
 */
export function matchesKeyword(text: string, keywords: readonly string[]): boolean {
  // Pad so a keyword at the very start or end of the string still has a boundary.
  const haystack = ` ${text.toLowerCase()} `;

  return keywords.some((keyword) => {
    const needle = keyword.toLowerCase();
    if (needle.length === 0) return false;
    if (needle.length > BOUNDARY_MAX_LENGTH) return haystack.includes(needle);

    // \b only exists between a word and a non-word character, so anchoring an edge
    // that isn't a word character can never match — "c++\b" would silently never fire.
    // Apply each boundary only on the side where the keyword actually ends in [\w].
    const leading = /^\w/.test(needle) ? "\\b" : "";
    const trailing = /\w$/.test(needle) ? "\\b" : "";
    return new RegExp(`${leading}${escapeRegex(needle)}${trailing}`).test(haystack);
  });
}
