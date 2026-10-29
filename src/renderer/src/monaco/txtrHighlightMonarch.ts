import type * as monaco from "monaco-editor";
import type { HighlightWordsByIndex } from "../stores/fileMetaStore";

/** 与装饰方案一致：更长词优先，同长则更小的高亮色索引优先 */
export type TxtrMonarchHighlightOptions = {
  enabled: boolean;
  /** 合法高亮色索引上界（与 `highlightColors.length` 一致） */
  highlightColorsLength: number;
  highlightWordsByIndex: HighlightWordsByIndex | undefined;
};

function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 生成自定义高亮词的 Monarch 规则（每条一词一类 token：`txtr.customHighlight.{index}`）。
 * 与原先 `findMatches` 一致：大小写不敏感。
 */
export function buildTxtrCustomHighlightMonarchRules(
  opts: TxtrMonarchHighlightOptions,
): monaco.languages.IMonarchLanguageRule[] {
  if (
    !opts.enabled ||
    opts.highlightColorsLength <= 0 ||
    !opts.highlightWordsByIndex
  ) {
    return [];
  }

  type Entry = { phrase: string; colorIndex: number; len: number };
  const entries: Entry[] = [];

  for (const [key, groups] of Object.entries(opts.highlightWordsByIndex)) {
    const idx = Number.parseInt(key, 10);
    if (
      !Number.isFinite(idx) ||
      idx < 0 ||
      idx >= opts.highlightColorsLength
    ) {
      continue;
    }
    for (const group of groups) {
      for (const phrase of group) {
        if (!phrase) continue;
        entries.push({ phrase, colorIndex: idx, len: phrase.length });
      }
    }
  }

  const seen = new Set<string>();
  const unique: Entry[] = [];
  for (const e of entries) {
    const k = `${e.colorIndex}\0${e.phrase}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(e);
  }

  unique.sort((a, b) => {
    if (b.len !== a.len) return b.len - a.len;
    return a.colorIndex - b.colorIndex;
  });

  return unique.map((e) => [
    new RegExp(escapeRegExpLiteral(e.phrase), "iu"),
    `txtr.customHighlight.${e.colorIndex}`,
  ]);
}
