export type Chapter = {
  title: string;
  lineNumber: number;
  charCount: number;
  /** 1 = 顶栏；子级递增。侧栏缩进 = (headingLevel - 1) * 10px */
  headingLevel?: number;
  /** 嵌入目录写入顺序（侧栏与粘性大纲用，勿按展示行号重排） */
  tocOrder?: number;
};

export type ChapterMatchRule = {
  id: string;
  pattern: string;
  enabled: boolean;
  examples: string[];
  builtIn: boolean;
};

import {
  CHAPTER_MATCH_BUILTIN_ALT_EXAMPLES,
  CHAPTER_MATCH_BUILTIN_ALT_PATTERN,
  CHAPTER_MATCH_BUILTIN_MAIN_EXAMPLES,
  CHAPTER_MATCH_BUILTIN_MAIN_PATTERN,
  CHAPTER_MATCH_BUILTIN_NUM_ORDERED_EXAMPLES,
  CHAPTER_MATCH_BUILTIN_NUM_ORDERED_PATTERN,
} from "@shared/chapterMatchBuiltinPatterns";
import { buildChaptersFromReaderDisplayText } from "./reader/readerDisplayPipeline";

const BUILTIN_RULE_MAIN_ID = "builtin-main";
const BUILTIN_RULE_ALT_ID = "builtin-alt";
const BUILTIN_RULE_NUM_ORDERED_ID = "builtin-num-ordered";

let rulesState: ChapterMatchRule[] = createDefaultChapterRulesInternal();
let enabledRegexList: RegExp[] = [];

function createDefaultChapterRulesInternal(): ChapterMatchRule[] {
  return [
    {
      id: BUILTIN_RULE_MAIN_ID,
      pattern: CHAPTER_MATCH_BUILTIN_MAIN_PATTERN,
      enabled: true,
      examples: [...CHAPTER_MATCH_BUILTIN_MAIN_EXAMPLES],
      builtIn: true,
    },
    {
      id: BUILTIN_RULE_ALT_ID,
      pattern: CHAPTER_MATCH_BUILTIN_ALT_PATTERN,
      enabled: true,
      examples: [...CHAPTER_MATCH_BUILTIN_ALT_EXAMPLES],
      builtIn: true,
    },
    {
      id: BUILTIN_RULE_NUM_ORDERED_ID,
      pattern: CHAPTER_MATCH_BUILTIN_NUM_ORDERED_PATTERN,
      enabled: false,
      examples: [...CHAPTER_MATCH_BUILTIN_NUM_ORDERED_EXAMPLES],
      builtIn: true,
    },
  ];
}

export function createDefaultChapterRules(): ChapterMatchRule[] {
  return createDefaultChapterRulesInternal().map(cloneChapterMatchRule);
}

/** 内置规则在「编辑」对话框中恢复默认时使用的正则与示例 */
export function getBuiltinRuleDefaults(
  ruleId: string,
): { pattern: string; examples: string[] } | null {
  if (ruleId === BUILTIN_RULE_MAIN_ID) {
    return {
      pattern: CHAPTER_MATCH_BUILTIN_MAIN_PATTERN,
      examples: [...CHAPTER_MATCH_BUILTIN_MAIN_EXAMPLES],
    };
  }
  if (ruleId === BUILTIN_RULE_ALT_ID) {
    return {
      pattern: CHAPTER_MATCH_BUILTIN_ALT_PATTERN,
      examples: [...CHAPTER_MATCH_BUILTIN_ALT_EXAMPLES],
    };
  }
  if (ruleId === BUILTIN_RULE_NUM_ORDERED_ID) {
    return {
      pattern: CHAPTER_MATCH_BUILTIN_NUM_ORDERED_PATTERN,
      examples: [...CHAPTER_MATCH_BUILTIN_NUM_ORDERED_EXAMPLES],
    };
  }
  return null;
}

function cloneChapterMatchRule(r: ChapterMatchRule): ChapterMatchRule {
  return {
    id: r.id,
    pattern: r.pattern,
    enabled: r.enabled,
    examples: [...r.examples],
    builtIn: r.builtIn,
  };
}

function rebuildEnabledRegexes(rules: ChapterMatchRule[]) {
  const next: RegExp[] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    const p = r.pattern?.trim();
    if (!p) continue;
    try {
      next.push(new RegExp(p));
    } catch {
      throw new Error(
        `规则无效（${r.builtIn ? "内置" : "自定义"}）：正则表达式无法编译`,
      );
    }
  }
  if (next.length === 0) {
    throw new Error("至少需要启用一条非空的匹配规则");
  }
  enabledRegexList = next;
}

try {
  rebuildEnabledRegexes(rulesState);
} catch {
  rulesState = createDefaultChapterRulesInternal();
  rebuildEnabledRegexes(rulesState);
}

/** 章节标题展示用：去除首尾空白（含全角空格 U+3000 等 Unicode 空白） */
export function trimChapterTitle(s: string): string {
  return s.trim();
}

/** 侧栏、粘性条等 UI：在 trim 基础上去掉零宽字符，避免符号名为空但数据侧有字的情况 */
export function chapterTitleForDisplay(s: string): string {
  return s.replace(/[\u200b-\u200d\ufeff]/g, "").trim();
}

/** 行首连续空白所占列数（含全角空格等 `\p{White_Space}`），用于阅读器压缩章节行缩进 */
const RE_LEADING_WHITE_SPACE = /^[\p{White_Space}]+/u;

export function leadingWhitespaceColumnCount(line: string): number {
  const m = line.match(RE_LEADING_WHITE_SPACE);
  return m ? m[0].length : 0;
}

export function getChapterMatchRules(): { rules: ChapterMatchRule[] } {
  return { rules: rulesState.map(cloneChapterMatchRule) };
}

export function setChapterMatchRules(rules: ChapterMatchRule[]) {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error("至少保留一条匹配规则");
  }
  const seen = new Set<string>();
  for (const r of rules) {
    if (!r.id || seen.has(r.id)) throw new Error("规则 id 重复或无效");
    seen.add(r.id);
  }
  const next = rules.map(cloneChapterMatchRule);
  rebuildEnabledRegexes(next);
  rulesState = next;
}

export function generateChapterRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function matchToTitle(match: RegExpMatchArray): string | null {
  const g1 = (match[1] ?? "").trim();
  const g2 = (match[2] ?? "").trim();
  if (g1 && g2) return trimChapterTitle(`${g1} ${g2}`);
  if (g1) return trimChapterTitle(g1);
  return trimChapterTitle((match[0] ?? "").trim()) || null;
}

/**
 * 单条规则编辑预览：用当前正则试匹配一行，标题解析与 detectChapterTitle 一致。
 * 正则无效时返回 { error }。
 */
export function previewChapterLineMatch(
  line: string,
  pattern: string,
): { error: string } | { hit: boolean; title: string } {
  const p = pattern.trim();
  if (!p) return { hit: false, title: "" };
  let re: RegExp;
  try {
    re = new RegExp(p);
  } catch {
    return { error: "正则表达式无效" };
  }
  const s = line.replace(/\r?\n$/, "");
  const m = s.match(re);
  if (!m) return { hit: false, title: "" };
  const title = matchToTitle(m);
  if (!title) return { hit: false, title: "" };
  return { hit: true, title };
}

export type ChapterExamplesPreview =
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ok"; items: { hit: boolean; text: string }[] };

/** 多条示例的匹配预览（与编辑面板列表展示一致） */
export function previewChapterExamples(
  pattern: string,
  examples: string[],
): ChapterExamplesPreview {
  const lines = examples.map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0) return { kind: "empty" };
  const first = previewChapterLineMatch(lines[0]!, pattern);
  if ("error" in first) return { kind: "error", message: first.error };
  const items = lines.map((line) => {
    const r = previewChapterLineMatch(line, pattern);
    if ("error" in r) return { hit: false, text: line };
    return { hit: r.hit, text: r.hit ? r.title : line };
  });
  return { kind: "ok", items };
}

export function detectChapterTitle(line: string): string | null {
  const s = line.replace(/\r?\n$/, "");
  for (const re of enabledRegexList) {
    const m = s.match(re);
    if (m) return matchToTitle(m);
  }
  return null;
}

export function filterChaptersByMinCharCount(
  chapters: Chapter[],
  minCharCount: number,
): Chapter[] {
  const floor = Math.max(0, Math.floor(minCharCount));
  if (floor <= 0) return chapters;
  return chapters.filter((ch) => ch.charCount >= floor);
}

/**
 * 将各节 direct 字数累加到祖先标题（按 ATX 层级：子级计入父级，兄弟互不影响）。
 * 调用前 `charCount` 应为该节标题下至下一同级/更高级标题前的 direct 统计。
 */
export function rollupCharCountsByHeadingLevel(
  items: { charCount: number }[],
  getLevel: (index: number) => number,
): void {
  if (items.length === 0) return;
  const direct = items.map((item) => item.charCount);
  const stack: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const level = getLevel(i);
    while (stack.length > 0) {
      if (getLevel(stack[stack.length - 1]!) < level) break;
      stack.pop();
    }
    const count = direct[i]!;
    for (const ancIdx of stack) {
      items[ancIdx]!.charCount += count;
    }
    stack.push(i);
  }
}

export function rollupChapterCharCountsByHeadingLevel(chapters: Chapter[]): void {
  rollupCharCountsByHeadingLevel(
    chapters,
    (i) => chapters[i]!.headingLevel ?? 1,
  );
}

/** 编辑态等：对当前 Monaco 全文（通常为物理原文）匹配章节 */
export function buildChaptersFromPlainText(
  text: string,
  minCharCount: number,
): Chapter[] {
  return buildChaptersFromReaderDisplayText(text, { minCharCount });
}

/** 行首缩进：非空行且非章节标题时，去掉行首空白后统一为两个全角空格「　　」 */
const RE_LEADING_WHITE_FOR_INDENT = /^[\p{White_Space}]+/u;
const FULL_WIDTH_INDENT_TWO = "　　";

export function applyLeadIndentFullWidth(
  line: string,
  options?: { exemptChapterTitle?: boolean },
): string {
  if (line.trim().length === 0) return line;
  const exempt =
    options?.exemptChapterTitle ?? detectChapterTitle(line) != null;
  if (exempt) return line;
  return FULL_WIDTH_INDENT_TWO + line.replace(RE_LEADING_WHITE_FOR_INDENT, "");
}

/** 物理行 0-based 偏移 → Monaco 展示行 0-based 偏移（行首全角缩进时 +2） */
export function physicalOffsetToDisplayOffset(
  physicalLine: string,
  physicalOffset: number,
  options?: { exemptChapterTitle?: boolean },
): number {
  const displayLine = applyLeadIndentFullWidth(physicalLine, options);
  if (displayLine === physicalLine) {
    return Math.max(0, Math.min(Math.floor(physicalOffset), displayLine.length));
  }
  const stripped = physicalLine.replace(RE_LEADING_WHITE_FOR_INDENT, "");
  const leadingRemoved = physicalLine.length - stripped.length;
  const indentLen = displayLine.length - stripped.length;
  const off = Math.max(0, Math.floor(physicalOffset));
  if (off < leadingRemoved) {
    return Math.min(off + indentLen, indentLen);
  }
  return indentLen + (off - leadingRemoved);
}

/** 物理行内匹配区间 → Monaco 1-based 列号（与 {@link applyLeadIndentFullWidth} 展示文一致） */
export function physicalRangeToDisplayColumns(
  physicalLine: string,
  range: { start: number; end: number },
): { startColumn: number; endColumn: number } {
  const start0 = physicalOffsetToDisplayOffset(physicalLine, range.start);
  const end0 = physicalOffsetToDisplayOffset(physicalLine, range.end);
  return {
    startColumn: start0 + 1,
    endColumn: Math.max(start0 + 2, end0 + 1),
  };
}

export function normalizeLoadedChapterRules(
  raw: unknown,
): ChapterMatchRule[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ChapterMatchRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id.trim()) return null;
    if (typeof o.pattern !== "string") return null;
    if (typeof o.enabled !== "boolean") return null;
    if (typeof o.builtIn !== "boolean") return null;
    if (!Array.isArray(o.examples)) return null;
    const examples = o.examples.filter(
      (x) => typeof x === "string",
    ) as string[];
    out.push({
      id: o.id,
      pattern: o.pattern,
      enabled: o.enabled,
      examples,
      builtIn: o.builtIn,
    });
  }
  return out;
}
