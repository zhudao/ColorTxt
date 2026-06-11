import {
  filterChaptersByMinCharCount,
  rollupChapterCharCountsByHeadingLevel,
  rollupCharCountsByHeadingLevel,
  type Chapter,
} from "../chapter";
import { plainTextForEbookTitleMatch } from "../ebook/ebookTitleMatch";
import { countCharsForLine } from "../utils/format";
import { isBlankPhysicalLineContent } from "../reader/lineMapping";
import {
  createMarkdownBlockContextTracker,
  type MarkdownBlockContextTracker,
} from "./markdownBlockContext";

const RE_ATX_HEADING = /^\s{0,3}(#{1,6})\s+(.+)$/;

export type MarkdownHeading = {
  /** 侧栏/章节匹配用纯标题（已剥内链） */
  title: string;
  level: number;
  /** ATX `#` 后原文（保留内链 MD 语法，供展示） */
  titleSource: string;
};

export function detectMarkdownHeading(line: string): MarkdownHeading | null {
  const m = line.replace(/\r?\n$/, "").match(RE_ATX_HEADING);
  if (!m) return null;
  const level = m[1]!.length;
  let titleSource = m[2]!.trim();
  titleSource = titleSource.replace(/\s+#+\s*$/g, "").trim();
  if (!titleSource) return null;
  const title = plainTextForEbookTitleMatch(titleSource);
  if (!title) return null;
  return { title, level, titleSource };
}

/** 只读展示：去掉 ATX `#` 前缀，保留标题正文（含内链） */
export function formatMarkdownHeadingLineForDisplay(line: string): string {
  const h = detectMarkdownHeading(line);
  return h ? h.titleSource : line;
}

/** ATX `#` / `##` 等前缀占用的列数（Monaco 1-based 列映射用） */
export function atxHeadingPrefixLength(line: string): number {
  const m = line.match(/^\s{0,3}(#{1,6})\s+/);
  return m ? m[0].length : 0;
}

export function isMarkdownHeadingPhysicalLine(
  line: string,
  tracker: MarkdownBlockContextTracker,
): boolean {
  tracker.feedLine(line);
  if (tracker.isInCodeBlock()) return false;
  return detectMarkdownHeading(line) != null;
}

export type MarkdownChapterScanHit = {
  title: string;
  level: number;
  physicalLine: number;
};

/** 在物理行上扫描 ATX 标题（跳过代码块内 `#`） */
export function scanMarkdownHeadingsOnPhysicalLines(
  physicalLines: readonly string[],
): MarkdownChapterScanHit[] {
  const tracker = createMarkdownBlockContextTracker();
  const hits: MarkdownChapterScanHit[] = [];
  let physicalLine = 0;
  for (const raw of physicalLines) {
    physicalLine += 1;
    tracker.feedLine(raw);
    if (tracker.isInCodeBlock()) continue;
    const h = detectMarkdownHeading(raw);
    if (h) {
      hits.push({
        title: h.title,
        level: h.level,
        physicalLine,
      });
    }
  }
  return hits;
}

export function collectQualifiedMarkdownChapterTitlePhysicalLines(
  physicalLines: readonly string[],
  options: { minCharCount: number },
): Set<number> {
  const floor = Math.max(0, Math.floor(options.minCharCount));
  const hits = scanMarkdownHeadingsOnPhysicalLines(physicalLines);
  const qualified = new Set<number>();
  if (floor <= 0) {
    for (const h of hits) qualified.add(h.physicalLine);
    return qualified;
  }

  const tracker = createMarkdownBlockContextTracker();
  const sections: {
    titlePhysicalLine: number;
    charCount: number;
    level: number;
  }[] = [];
  let currentIdx = -1;
  let physicalLine = 0;

  for (const raw of physicalLines) {
    physicalLine += 1;
    if (isBlankPhysicalLineContent(raw)) continue;
    tracker.feedLine(raw);
    const h =
      !tracker.isInCodeBlock() ? detectMarkdownHeading(raw) : null;
    if (h) {
      sections.push({
        titlePhysicalLine: physicalLine,
        charCount: 0,
        level: h.level,
      });
      currentIdx = sections.length - 1;
      continue;
    }
    if (currentIdx >= 0) {
      sections[currentIdx]!.charCount += countCharsForLine(raw);
    }
  }

  rollupCharCountsByHeadingLevel(sections, (i) => sections[i]!.level);

  for (const s of sections) {
    if (s.charCount >= floor) qualified.add(s.titlePhysicalLine);
  }
  return qualified;
}

export type BuildMarkdownChaptersOptions = {
  minCharCount: number;
  /** 物理行号 → 展示行号（Monaco 1-based）；无映射时视为 1:1 */
  physicalLineToDisplayLine: (physicalLine: number) => number;
  /** 展示全文（用于统计章节字数） */
  displayText: string;
};

/**
 * 章节标题在物理行上识别；`lineNumber` 为 Monaco 展示行号。
 */
export function buildChaptersFromMarkdownPhysicalLines(
  physicalLines: readonly string[],
  options: BuildMarkdownChaptersOptions,
): Chapter[] {
  const hits = scanMarkdownHeadingsOnPhysicalLines(physicalLines);
  const normalized = options.displayText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const displayLines =
    normalized.length > 0 ? normalized.split("\n") : [];

  const chapters: Chapter[] = hits.map((h, i) => ({
    title: h.title,
    lineNumber: options.physicalLineToDisplayLine(h.physicalLine),
    charCount: 0,
    headingLevel: h.level,
    tocOrder: i,
  }));

  if (chapters.length === 0) return [];

  const titleDisplayLines = new Set(chapters.map((c) => c.lineNumber));
  let chapterIdx = 0;

  for (let displayLine = 1; displayLine <= displayLines.length; displayLine++) {
    if (titleDisplayLines.has(displayLine)) {
      const idx = chapters.findIndex((c) => c.lineNumber === displayLine);
      if (idx >= 0) chapterIdx = idx;
      continue;
    }
    if (chapterIdx >= 0) {
      chapters[chapterIdx]!.charCount += countCharsForLine(
        displayLines[displayLine - 1] ?? "",
      );
    }
  }

  rollupChapterCharCountsByHeadingLevel(chapters);
  return filterChaptersByMinCharCount(chapters, options.minCharCount);
}

function splitEditorTextToLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.length > 0 ? normalized.split("\n") : [];
}

/**
 * 编辑模式：Monaco 展示磁盘原文，物理行与展示行 1:1，直接按编辑器全文识别 ATX 标题。
 */
export function buildChaptersFromMarkdownEditorText(
  editorText: string,
  options: { minCharCount: number },
): Chapter[] {
  const lines = splitEditorTextToLines(editorText);
  const normalized = lines.join("\n");
  return buildChaptersFromMarkdownPhysicalLines(lines, {
    minCharCount: options.minCharCount,
    displayText: normalized,
    physicalLineToDisplayLine: (physicalLine) => physicalLine,
  });
}
