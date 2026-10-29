/**
 * Lookup candidates: trim, case variants, strip trailing punctuation.
 */

const TRAILING_PUNCT_RE = /[\s\p{P}\p{S}]+$/u;

function stripTrailingPunctuation(s: string): string {
  let out = s;
  for (let i = 0; i < 8; i++) {
    const next = out.replace(TRAILING_PUNCT_RE, "");
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

/**
 * Ordered unique variants: original, lower, Title, then stripped forms.
 * Returns [] for blank input.
 */
export function buildLookupCandidates(word: string): string[] {
  const trimmed = word.trim();
  if (!trimmed) return [];

  const lower = trimmed.toLowerCase();
  const title =
    trimmed.length > 0
      ? trimmed.charAt(0).toUpperCase() + lower.slice(1)
      : trimmed;
  const stripped = stripTrailingPunctuation(trimmed);
  const strippedLower = stripped.toLowerCase();
  const strippedTitle =
    stripped.length > 0
      ? stripped.charAt(0).toUpperCase() + strippedLower.slice(1)
      : stripped;

  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of [
    trimmed,
    lower,
    title,
    stripped,
    strippedLower,
    strippedTitle,
  ]) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}
