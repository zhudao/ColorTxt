/**
 * EPUB 转换：在 spine 节内按标题匹配行，供嵌入目录 / 内链锚点注入共用。
 */

import { chapterTitleForDisplay } from "../../chapter";
import { plainTextForEbookTitleMatch } from "../ebookTitleMatch";
import { scanMdInternalLinkAt } from "../../markdown/markdownLinkShared";

export type EpubSpineSectionRange = {
  stem: string;
  /** 含首行，0-based */
  startLine: number;
  /** 含末行，0-based */
  endLine: number;
};

export type LineMutation =
  | { kind: "prepend"; at: number; prefix: string }
  | { kind: "insert"; at: number; text: string; replace?: boolean };

export function stemFromEbookTargetId(targetId: string): string {
  const hash = targetId.indexOf("#");
  return hash >= 0 ? targetId.slice(0, hash) : targetId;
}

export function fragmentFromEbookTargetId(targetId: string): string | null {
  const hash = targetId.indexOf("#");
  return hash >= 0 ? targetId.slice(hash + 1) : null;
}

function isMdInternalLinkOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[")) return false;
  const link = scanMdInternalLinkAt(trimmed, 0);
  return link != null && link.index === 0 && link.index + link.full.length === trimmed.length;
}

/** 在节内按 `targetId` 的 fragment 查找已注入的 `<span id="…">` 行 */
export function findLineByFragmentInSpineSection(
  lines: readonly string[],
  start: number,
  end: number,
  fragment: string,
): number | null {
  if (!fragment) return null;
  const needle = `id="${fragment}"`;
  for (let i = start; i <= end; i++) {
    if ((lines[i] ?? "").includes(needle)) return i;
  }
  return null;
}

/** 目录注入：按 targetId、注册表映射与额外 fragment 提示查找锚点行 */
export function findLineByTocTargetInSpineSection(
  lines: readonly string[],
  start: number,
  end: number,
  targetId: string,
  registry: {
    resolve(logicalKey: string): string | undefined;
  },
  extraFragmentHints?: readonly string[],
): number | null {
  const frags: string[] = [];
  const push = (f: string | undefined | null) => {
    const t = f?.trim();
    if (t && !frags.includes(t)) frags.push(t);
  };
  if (extraFragmentHints) {
    for (const h of extraFragmentHints) push(h);
  }
  push(fragmentFromEbookTargetId(targetId));
  push(registry.resolve(targetId));
  const stem = stemFromEbookTargetId(targetId);
  const raw = fragmentFromEbookTargetId(targetId);
  if (raw) push(registry.resolve(`${stem}#${raw}`));
  for (const frag of frags) {
    const hit = findLineByFragmentInSpineSection(lines, start, end, frag);
    if (hit != null) return hit;
  }
  return null;
}

function visiblePlainAtLine(lines: readonly string[], index: number): string {
  const raw = lines[index] ?? "";
  return chapterTitleForDisplay(plainTextForEbookTitleMatch(raw));
}

function findExactMatchLine(
  lines: readonly string[],
  start: number,
  end: number,
  want: string,
): number | null {
  if (!want) return null;
  for (let i = start; i <= end; i++) {
    if (isMdInternalLinkOnlyLine(lines[i] ?? "")) continue;
    const plain = visiblePlainAtLine(lines, i);
    if (plain && plain === want) return i;
  }
  return null;
}

/** 在范围内仅精确匹配标题（PDF 书签注入用，避免误升正文片段） */
export function findExactTitleLineInRange(
  lines: readonly string[],
  start: number,
  end: number,
  title: string,
  skipLines?: ReadonlySet<number>,
): number | null {
  const want = chapterTitleForDisplay(title);
  if (!want) return null;
  for (let i = start; i <= end; i++) {
    if (skipLines?.has(i)) continue;
    if (isMdInternalLinkOnlyLine(lines[i] ?? "")) continue;
    const plain = visiblePlainAtLine(lines, i);
    if (plain && plain === want) return i;
  }
  return null;
}

/** 在 spine 节内按标题精确匹配目标行（须整行与目录标题一致） */
export function findTitleLineInSpineSection(
  lines: readonly string[],
  start: number,
  end: number,
  title: string,
): number | null {
  const want = chapterTitleForDisplay(title);
  if (!want) return null;
  return findExactMatchLine(lines, start, end, want);
}

const RE_TOC_SPAN_ONLY_LINE =
  /^\s*<span\s+id="toc_[^"]+"\s*><\/span>\s*$/i;

/** 嵌入目录注入后：`<span id="toc_N">` 下一行为匹配 ATX 标题时返回该行号（多命中取离 `nearLine` 最近者） */
export function findEmbeddedTocSpanLineForTitle(
  lines: readonly string[],
  start: number,
  end: number,
  title: string,
  nearLine?: number,
): number | null {
  const want = chapterTitleForDisplay(title);
  if (!want) return null;
  const anchor = nearLine ?? start;
  let best: number | null = null;
  let bestDist = Infinity;
  for (let i = start; i <= end; i++) {
    if (!RE_TOC_SPAN_ONLY_LINE.test(lines[i] ?? "")) continue;
    if (i >= lines.length - 1) break;
    const nextPlain = visiblePlainAtLine(lines, i + 1);
    if (nextPlain !== want) continue;
    const dist = Math.abs(i - anchor);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** TOC / stem 锚点插入后，按行变更量前移后续 spine 节的 startLine / endLine */
export function shiftSpineSectionRangesForMutations(
  ranges: EpubSpineSectionRange[],
  mutations: readonly LineMutation[],
): void {
  const deltaByAt = new Map<number, number>();
  for (const m of mutations) {
    if (m.kind !== "insert" || m.replace) continue;
    deltaByAt.set(m.at, (deltaByAt.get(m.at) ?? 0) + 1);
  }
  const entries = [...deltaByAt.entries()].sort((a, b) => a[0] - b[0]);
  let offset = 0;
  for (const [at, delta] of entries) {
    const pos = at + offset;
    for (const r of ranges) {
      if (r.startLine >= pos) r.startLine += delta;
      if (r.endLine >= pos) r.endLine += delta;
    }
    offset += delta;
  }
}

export function applyLineMutations(
  lines: string[],
  mutations: readonly LineMutation[],
): void {
  const sorted = [...mutations].sort((a, b) => b.at - a.at);
  for (const m of sorted) {
    if (m.kind === "insert") {
      if (m.replace) {
        lines[m.at] = m.text;
      } else {
        lines.splice(m.at, 0, m.text);
      }
    } else {
      lines[m.at] = m.prefix + (lines[m.at] ?? "");
    }
  }
}

export function sectionRangeByStem(
  sectionRanges: readonly EpubSpineSectionRange[],
): Map<string, EpubSpineSectionRange> {
  const map = new Map<string, EpubSpineSectionRange>();
  for (const r of sectionRanges) {
    map.set(r.stem, r);
  }
  return map;
}
