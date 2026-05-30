import type { AIWordcloudMode, AIWordcloudToolResult } from "@shared/aiTypes";

export type UiWordcloudAttachment = {
  title: string;
  mode: AIWordcloudMode;
  semanticQuery?: string;
  words: Array<{ text: string; weight: number }>;
  layoutSeed?: number;
  stats?: AIWordcloudToolResult["stats"];
};

export function normalizeWordcloudLayoutSeed(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  const n = Math.trunc(raw);
  return n >= 0 ? n : 0;
}

export function patchWordcloudToolResultLayoutSeed(
  full: string,
  layoutSeed: number,
): string | null {
  const raw = full.trim();
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    if (r.type !== "wordcloud") return null;
    const seed = normalizeWordcloudLayoutSeed(layoutSeed);
    return JSON.stringify({ ...r, layoutSeed: seed });
  } catch {
    return null;
  }
}

export function parseWordcloudToolResult(
  full: string,
): UiWordcloudAttachment | null {
  const raw = full.trim();
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    if (r.type !== "wordcloud") return null;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    const mode = r.mode === "semantic" ? "semantic" : "general";
    if (!title) return null;
    if (!Array.isArray(r.words) || r.words.length === 0) return null;
    const words: Array<{ text: string; weight: number }> = [];
    for (const item of r.words) {
      if (!item || typeof item !== "object") continue;
      const w = item as Record<string, unknown>;
      const text = typeof w.text === "string" ? w.text.trim() : "";
      const weight = typeof w.weight === "number" ? w.weight : 0;
      if (text && weight > 0) words.push({ text, weight });
    }
    if (words.length === 0) return null;
    let stats: UiWordcloudAttachment["stats"];
    if (r.stats && typeof r.stats === "object") {
      const s = r.stats as Record<string, unknown>;
      if (
        typeof s.totalChars === "number" &&
        typeof s.uniqueTerms === "number" &&
        typeof s.cacheHits === "number"
      ) {
        stats = {
          totalChars: s.totalChars,
          uniqueTerms: s.uniqueTerms,
          cacheHits: s.cacheHits,
          ...(typeof s.termsExtracted === "number"
            ? { termsExtracted: s.termsExtracted }
            : {}),
        };
      }
    }
    const semanticQuery =
      typeof r.semanticQuery === "string" ? r.semanticQuery.trim() : undefined;
    const layoutSeed = normalizeWordcloudLayoutSeed(r.layoutSeed);
    return {
      title,
      mode,
      ...(semanticQuery ? { semanticQuery } : {}),
      words,
      ...(layoutSeed > 0 ? { layoutSeed } : {}),
      stats,
    };
  } catch {
    return null;
  }
}
