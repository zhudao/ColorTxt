/**
 * 转换时按 NCX/nav 目录项，在 spine 节内注入 ATX `#` / `##` 与 `<span id>`。
 * 锚点独占一行、标题在下一行，避免 `<span>…</span># 标题` 导致 ATX 章节匹配失败。
 */

import type { EmbeddedTocEntry } from "./ebookTocTypes";
import {
  atxHeadingPrefix,
  EbookMarkdownFragmentRegistry,
  formatSpanAnchor,
  globalFragmentForLogicalTarget,
} from "./ebookMarkdownEmit";
import {
  applyLineMutations,
  findTitleLineInSpineSection,
  sectionRangeByStem,
  stemFromEbookTargetId,
  type EpubSpineSectionRange,
  type LineMutation,
} from "./ebookSpineLineMatch";

function lineAlreadyHasAtxHeading(line: string): boolean {
  return /^\s{0,3}#{1,6}\s+/.test(line);
}

/** 目录注入目标行：仅当节内某行与目录标题完全一致时升 ATX，否则走节首 fallback */
export function resolveTocInjectLineIdx(
  lines: readonly string[],
  searchStart: number,
  rangeEnd: number,
  title: string,
): number | null {
  return findTitleLineInSpineSection(lines, searchStart, rangeEnd, title);
}

/** 节首 fallback 注入目录标题时：空行可 replace；插图/正文须 insert 保留 */
export function shouldReplaceLineWhenInjectingTocHeading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return true;
  if (/^\s*<span\s+id="[^"]*"\s*><\/span>\s*$/.test(line)) return true;
  return false;
}

const RE_ONE_LEADING_SPAN_ID = /^\s*<span\s+id="[^"]*"\s*><\/span>/;

/** 行首 id span 独占一行，避免升 ATX 时丢掉 `#fragment` 跳转目标 */
function splitLeadingSpanAnchorLine(line: string): {
  spanLine: string | null;
  body: string;
} {
  let s = line;
  const spans: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = RE_ONE_LEADING_SPAN_ID.exec(s)) !== null) {
    spans.push(m[0]);
    s = s.slice(m[0].length);
  }
  return {
    spanLine: spans.length > 0 ? spans.join("") : null,
    body: s.trimStart(),
  };
}

/**
 * 写出两行：`<span id="…"></span>` 与 ATX 标题。
 * `applyLineMutations` 按行号降序应用；同索引须先写标题（replace 或 insert）、再 insert 锚点（锚点在上）。
 * `replaceHeading === false` 时在原内容前 insert 标题，用于节首已有插图/正文、不宜覆盖的场景。
 */
export function pushTocAnchorAndHeading(
  mutations: LineMutation[],
  at: number,
  span: string,
  headingLine: string,
  replaceHeading: boolean,
  preserveSpanLine?: string | null,
): void {
  mutations.push({
    kind: "insert",
    at,
    text: headingLine,
    replace: replaceHeading,
  });
  if (preserveSpanLine) {
    mutations.push({ kind: "insert", at, text: preserveSpanLine });
  }
  mutations.push({ kind: "insert", at, text: span });
}

/**
 * 在节内已定位到行，或 fallback 到节首时，写入目录锚点与 ATX 标题。
 * 匹配正文行时升 ATX（replace），无匹配时才在节首 insert。
 */
export function queueTocHeadingMutations(
  mutations: LineMutation[],
  lines: readonly string[],
  params: {
    lineIdx: number | null;
    rangeStartLine: number;
    span: string;
    title: string;
    level: number;
    /** PDF 等：升 ATX 时用书签标题，勿用正文行文本 */
    headingTitleOverride?: string;
  },
): void {
  const { lineIdx, rangeStartLine, span, title, level, headingTitleOverride } =
    params;
  const headingText = (override?: string) =>
    atxHeadingPrefix(level) + (override ?? title);
  if (lineIdx != null) {
    const raw = lines[lineIdx] ?? "";
    if (lineAlreadyHasAtxHeading(raw)) {
      mutations.push({ kind: "insert", at: lineIdx, text: span });
      return;
    }
    const { spanLine, body } = splitLeadingSpanAnchorLine(raw);
    if (body.length > 0) {
      pushTocAnchorAndHeading(
        mutations,
        lineIdx,
        span,
        headingText(headingTitleOverride ?? body),
        true,
        spanLine,
      );
      return;
    }
    /** 纯锚点行（如 filepos span）：在下一行升 ATX，保留锚点行不动 */
    const nextIdx = lineIdx + 1;
    const nextRaw = lines[nextIdx] ?? "";
    const nextSplit = splitLeadingSpanAnchorLine(nextRaw);
    const nextBody = nextSplit.body.trim();
    if (nextBody.length > 0) {
      pushTocAnchorAndHeading(
        mutations,
        nextIdx,
        span,
        headingText(headingTitleOverride ?? nextBody),
        true,
        nextSplit.spanLine,
      );
      return;
    }
  }
  pushTocAnchorAndHeading(
    mutations,
    rangeStartLine,
    span,
    atxHeadingPrefix(level) + title,
    shouldReplaceLineWhenInjectingTocHeading(lines[rangeStartLine] ?? ""),
  );
}

/** 收集嵌入目录 ATX / toc span 变更（由调用方 apply，并在 apply 前校准 spine 节行号） */
export function collectEpubTocAnchorMutations(
  lines: readonly string[],
  sectionRanges: readonly EpubSpineSectionRange[],
  tocEntries: readonly EmbeddedTocEntry[],
  registry: EbookMarkdownFragmentRegistry,
): LineMutation[] {
  if (tocEntries.length === 0 || sectionRanges.length === 0) return [];

  const sectionByStem = sectionRangeByStem(sectionRanges);
  const tocCounterByStem = new Map<string, number>();
  const searchStartByStem = new Map<string, number>();
  const mutations: LineMutation[] = [];

  for (const entry of tocEntries) {
    const stem = stemFromEbookTargetId(entry.targetId);
    const range = sectionByStem.get(stem);
    if (!range) continue;

    const n = (tocCounterByStem.get(stem) ?? 0) + 1;
    tocCounterByStem.set(stem, n);
    const logicalAnchor = `${stem}#toc_${n}`;
    const globalFrag = globalFragmentForLogicalTarget(
      registry,
      logicalAnchor,
      `toc_${n}`,
    );
    const span = formatSpanAnchor(globalFrag);

    const searchStart = Math.max(
      range.startLine,
      searchStartByStem.get(stem) ?? range.startLine,
    );
    const lineIdx = resolveTocInjectLineIdx(
      lines,
      searchStart,
      range.endLine,
      entry.title,
    );

    if (lineIdx != null) {
      queueTocHeadingMutations(mutations, lines, {
        lineIdx,
        rangeStartLine: range.startLine,
        span,
        title: entry.title,
        level: entry.level,
      });
      searchStartByStem.set(stem, lineIdx + 1);
    } else {
      queueTocHeadingMutations(mutations, lines, {
        lineIdx: null,
        rangeStartLine: range.startLine,
        span,
        title: entry.title,
        level: entry.level,
      });
      searchStartByStem.set(stem, range.startLine + 1);
    }
  }

  return mutations;
}

/** 按目录项在对应 spine 节内注入 ATX 标题行（阅读器侧栏章节由 ATX 解析，不另写目录块）。 */
export function injectEpubTocAnchorsIntoLines(
  lines: string[],
  sectionRanges: readonly EpubSpineSectionRange[],
  tocEntries: readonly EmbeddedTocEntry[],
  registry: EbookMarkdownFragmentRegistry,
): void {
  const mutations = collectEpubTocAnchorMutations(
    lines,
    sectionRanges,
    tocEntries,
    registry,
  );
  if (mutations.length > 0) {
    applyLineMutations(lines, mutations);
  }
}
