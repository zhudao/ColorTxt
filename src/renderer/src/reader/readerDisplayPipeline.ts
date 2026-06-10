import {
  applyLeadIndentFullWidth,
  detectChapterTitle,
  filterChaptersByMinCharCount,
  type Chapter,
} from "../chapter";
import {
  collectLeadingEbookALabelsFromLine,
  lineTextAfterStrippingEbookMarkers,
} from "../ebook/ebookInternalLinkMarkers";
import {
  collectQualifiedMarkdownChapterTitlePhysicalLines,
  detectMarkdownHeading,
} from "../markdown/markdownChapter";
import { createMarkdownBlockContextTracker } from "../markdown/markdownBlockContext";
import { isBlankPhysicalLineContent } from "./lineMapping";
import { countCharsForLine } from "../utils/format";

export type ReaderDisplayFormatOptions = {
  compressBlankLines: boolean;
  compressBlankKeepOneBlank: boolean;
  leadIndentFullWidth: boolean;
  /** 与侧栏章节列表一致：不足最少字数的标题行不插入章节上下空行 */
  minCharCount?: number;
  /** Markdown：用 ATX `#` 标题（物理行扫描，跳过代码块） */
  isMarkdown?: boolean;
  /**
   * Markdown 编辑态格式化：保留行内 `##` 等原文，仅豁免标题行缩进/留白规则；
   * 只读展示仍为去掉 `#` 的标题正文。
   */
  preserveMarkdownSourceLines?: boolean;
};

export type ReaderDisplayFormatResult = {
  text: string;
  /** 展示行号 i（1-based）→ 源物理行号 */
  displayLineToPhysicalLine: number[];
  lineCount: number;
};

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isEbookFalseChapterTitleFromLeadingLink(
  title: string,
  leadingLabels: readonly string[],
): boolean {
  const t = title.trim();
  return leadingLabels.some((lab) => {
    const L = lab.trim();
    return L.length > 0 && t.startsWith(L);
  });
}

/** 物理行章节匹配：先去掉电子书 `<<ID:…>>` / `<<A:…>>`，并排除链内假章节 */
function detectChapterTitleFromPhysicalLine(rawLine: string): string | null {
  const visible = lineTextAfterStrippingEbookMarkers(rawLine);
  const title = detectChapterTitle(visible);
  if (!title) return null;
  const leadingLabels = collectLeadingEbookALabelsFromLine(rawLine);
  if (isEbookFalseChapterTitleFromLeadingLink(title, leadingLabels)) return null;
  return title;
}

function lineForReaderDisplay(
  rawLine: string,
  leadIndentFullWidth: boolean,
  qualifiedChapterTitles: ReadonlySet<number>,
  physicalLine: number,
  exemptAsChapterTitle = false,
): string {
  if (!leadIndentFullWidth) return rawLine;
  return applyLeadIndentFullWidth(rawLine, {
    exemptChapterTitle:
      exemptAsChapterTitle || qualifiedChapterTitles.has(physicalLine),
  });
}

function resolvePhysicalLineDisplay(
  rawLine: string,
  physicalLine: number,
  options: ReaderDisplayFormatOptions,
  qualifiedChapterTitles: ReadonlySet<number>,
  mdTracker: ReturnType<typeof createMarkdownBlockContextTracker> | null,
): { shown: string; isChapterTitleLine: boolean } {
  let content = rawLine;
  let isChapterTitleLine = false;
  if (options.isMarkdown && mdTracker) {
    mdTracker.feedLine(rawLine);
    if (!mdTracker.isInCodeBlock()) {
      const h = detectMarkdownHeading(rawLine);
      if (h) {
        isChapterTitleLine = true;
        if (!options.preserveMarkdownSourceLines) {
          content = h.title;
        }
      }
    }
  } else {
    isChapterTitleLine = detectChapterTitleFromPhysicalLine(rawLine) != null;
  }
  const shown = lineForReaderDisplay(
    content,
    options.leadIndentFullWidth,
    qualifiedChapterTitles,
    physicalLine,
    isChapterTitleLine,
  );
  return { shown, isChapterTitleLine };
}

/**
 * 在物理行上按章节规则扫描，返回「计入侧栏章节表」的标题行物理行号（1-based）。
 * 字数统计与 {@link buildChaptersFromReaderDisplayText} 一致：不含标题行本身，不含格式化插入的空行。
 */
export function collectQualifiedChapterTitlePhysicalLines(
  physicalLines: readonly string[],
  options: {
    minCharCount: number;
    leadIndentFullWidth: boolean;
    isMarkdown?: boolean;
  },
): Set<number> {
  if (options.isMarkdown) {
    return collectQualifiedMarkdownChapterTitlePhysicalLines(physicalLines, {
      minCharCount: options.minCharCount,
    });
  }
  const floor = Math.max(0, Math.floor(options.minCharCount));
  const qualified = new Set<number>();
  const sections: { titlePhysicalLine: number; charCount: number }[] = [];
  let currentIdx = -1;
  let physicalLine = 0;

  for (const rawLine of physicalLines) {
    physicalLine += 1;
    if (isBlankPhysicalLineContent(rawLine)) continue;
    const title = detectChapterTitleFromPhysicalLine(rawLine);
    if (title) {
      sections.push({ titlePhysicalLine: physicalLine, charCount: 0 });
      currentIdx = sections.length - 1;
      if (floor <= 0) qualified.add(physicalLine);
      continue;
    }
    if (currentIdx >= 0) {
      const shown = options.leadIndentFullWidth
        ? applyLeadIndentFullWidth(rawLine, { exemptChapterTitle: false })
        : rawLine;
      sections[currentIdx]!.charCount += countCharsForLine(shown);
    }
  }

  if (floor <= 0) return qualified;
  for (const s of sections) {
    if (s.charCount >= floor) qualified.add(s.titlePhysicalLine);
  }
  return qualified;
}

/**
 * 由源文件物理行生成阅读器展示正文（压缩空行 / 行首缩进可组合）。
 * 只读加载完成、顶栏切换展示选项、编辑模式「格式化」均走此函数。
 */
export function formatPhysicalLinesForReader(
  physicalLines: readonly string[],
  options: ReaderDisplayFormatOptions,
): ReaderDisplayFormatResult {
  const minCharCount = options.minCharCount ?? 0;
  const qualifiedChapterTitles = collectQualifiedChapterTitlePhysicalLines(
    physicalLines,
    {
      minCharCount,
      leadIndentFullWidth: options.leadIndentFullWidth,
      isMarkdown: options.isMarkdown,
    },
  );

  const mdTracker = options.isMarkdown
    ? createMarkdownBlockContextTracker()
    : null;

  if (!options.compressBlankLines) {
    const out: string[] = [];
    const displayLineToPhysicalLine: number[] = [];
    let physicalLine = 0;
    for (const rawLine of physicalLines) {
      physicalLine += 1;
      const { shown } = resolvePhysicalLineDisplay(
        rawLine,
        physicalLine,
        options,
        qualifiedChapterTitles,
        mdTracker,
      );
      out.push(shown);
      displayLineToPhysicalLine.push(physicalLine);
    }
    return {
      text: out.join("\n"),
      displayLineToPhysicalLine,
      lineCount: out.length,
    };
  }

  const keepOneBlank = options.compressBlankKeepOneBlank;
  const blanksAbove = keepOneBlank ? 1 : 2;
  const out: string[] = [];
  const displayLineToPhysicalLine: number[] = [];

  const pushDisplay = (lineText: string, physicalLine: number) => {
    displayLineToPhysicalLine.push(physicalLine);
    out.push(lineText);
  };

  let physicalLine = 0;
  for (const rawLine of physicalLines) {
    physicalLine += 1;
    if (isBlankPhysicalLineContent(rawLine)) continue;
    const { shown, isChapterTitleLine } = resolvePhysicalLineDisplay(
      rawLine,
      physicalLine,
      options,
      qualifiedChapterTitles,
      mdTracker,
    );
    const isQualifiedChapterTitle =
      isChapterTitleLine && qualifiedChapterTitles.has(physicalLine);
    if (isQualifiedChapterTitle) {
      for (let i = 0; i < blanksAbove; i += 1) {
        pushDisplay("", physicalLine);
      }
      pushDisplay(shown, physicalLine);
      pushDisplay("", physicalLine);
    } else {
      pushDisplay(shown, physicalLine);
      if (keepOneBlank) pushDisplay("", physicalLine);
    }
  }

  return {
    text: out.join("\n"),
    displayLineToPhysicalLine,
    lineCount: out.length,
  };
}

export function formatPhysicalPlainTextForReader(
  physicalPlainText: string,
  options: ReaderDisplayFormatOptions,
): ReaderDisplayFormatResult {
  const normalized = normalizeNewlines(physicalPlainText);
  const lines = normalized.length > 0 ? normalized.split("\n") : [];
  return formatPhysicalLinesForReader(lines, options);
}

export type BuildChaptersFromDisplayOptions = {
  minCharCount: number;
  /** 电子书行首内链标签：展示行号 → 标签文案列表 */
  leadingLinkLabelsByDisplayLine?: ReadonlyMap<
    number,
    readonly string[]
  >;
};

/**
 * 对当前 Monaco **展示**全文匹配章节并统计字数（加载后 / 规则变更 / 刷新章节共用）。
 */
export function buildChaptersFromReaderDisplayText(
  displayText: string,
  options: BuildChaptersFromDisplayOptions,
): Chapter[] {
  const normalized = normalizeNewlines(displayText);
  const lines = normalized.length > 0 ? normalized.split("\n") : [];
  const leadingLinkLabels =
    options.leadingLinkLabelsByDisplayLine ??
    new Map<number, readonly string[]>();

  const next: Chapter[] = [];
  let lineNo = 0;
  let currentIdx = -1;

  for (const rawLine of lines) {
    lineNo += 1;
    const title = detectChapterTitle(rawLine);
    if (title) {
      const labels = leadingLinkLabels.get(lineNo);
      if (labels && labels.length > 0) {
        const t = title.trim();
        const fromLeadingLink = labels.some((lab) => {
          const L = lab.trim();
          return L.length > 0 && t.startsWith(L);
        });
        if (fromLeadingLink) {
          if (currentIdx >= 0) {
            next[currentIdx]!.charCount += countCharsForLine(rawLine);
          }
          continue;
        }
      }
      next.push({ title, lineNumber: lineNo, charCount: 0 });
      currentIdx = next.length - 1;
      continue;
    }
    if (currentIdx >= 0) {
      next[currentIdx]!.charCount += countCharsForLine(rawLine);
    }
  }

  return filterChaptersByMinCharCount(next, options.minCharCount);
}
