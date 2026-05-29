import { chapterTitleForDisplay, type Chapter } from "../chapter";

/**
 * AI 正文里的章节跳转标记解析与展示。
 * **推荐**模型输出 `（ch=N）`（全角括号 + 半角 `ch=`），以免形如 `[...](ch=N)` 被 Markdown 误解析为链接；
 * 下列 pattern 仍解析半角 `(ch=N)`、`[ch=N]`、`(ch=标识: N)` 等，兼容历史会话与旧模型输出。
 *
 * **N** = 全书章节 **chapterIndex（从 0 起）**，首章为 `（ch=0）`；展示跳转按钮时由界面换算为「第 N+1 章」。
 * 兼容模型把多章写在一对括号内：`（ch=1, ch=2）` 会先归一化为 `（ch=1）（ch=2）` 再解析。
 * 兼容 `（ch=25-26）` 范围、`（ch=25提及）` / `（ch=25章末）` 等在序号后夹任意说明的后缀变体（归一化后再解析为跳转按钮）。
 */

const CH_OPEN = "(?:\\uFF08|\\()";
const CH_CLOSE = "(?:\\)|\\uFF09)";
const CH_EQ = "[=\\uFF1D]";

function standardChapterMarker(chapterIndex: number): string {
  return `（ch=${chapterIndex}）`;
}

/** 将 `（ch=a, ch=b）` / `(ch=a，ch=b)` 等合并写法拆成多个标准 `（ch=N）`，便于现有正则命中。
 * 输出统一为全角括号包裹的独立标记。
 */
export function normalizeCompoundAiChapterMarkers(md: string): string {
  const atom = `ch\\s*${CH_EQ}\\s*\\d+`;
  const re = new RegExp(
    `(?:\\uFF08|\\()\\s*(${atom}(?:\\s*[,，]\\s*${atom})+)\\s*(?:\\uFF09|\\))`,
    "g",
  );
  const pick = new RegExp(`ch\\s*${CH_EQ}\\s*(\\d+)`, "g");
  return md.replace(re, (full, inner: string) => {
    const nums = [...inner.matchAll(pick)].map((m) => m[1]!);
    return nums.length > 0
      ? nums.map((n) => standardChapterMarker(Number.parseInt(n, 10)))
      .join("")
      : full;
  });
}

const MAX_CHAPTER_RANGE_EXPAND = 8;

function expandChapterIndexRange(startIdx: number, endIdx: number): number[] {
  const lo = Math.min(startIdx, endIdx);
  const hi = Math.max(startIdx, endIdx);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0) return [];
  const span = hi - lo + 1;
  if (span <= MAX_CHAPTER_RANGE_EXPAND) {
    return Array.from({ length: span }, (_, i) => lo + i);
  }
  return [lo, hi];
}

/**
 * `（ch=25-26）` / `（ch=25-26章末）` → 多个 `（ch=N）`（过长范围仅保留首尾），括号内说明移到括号外。
 */
export function normalizeAiChapterRangeMarkers(md: string): string {
  const re = new RegExp(
    `${CH_OPEN}\\s*ch\\s*${CH_EQ}\\s*(\\d+)\\s*-\\s*(\\d+)\\s*([^0-9)）]*)?\\s*${CH_CLOSE}`,
    "g",
  );
  return md.replace(re, (full, a: string, b: string, tail?: string) => {
    const i0 = Number.parseInt(a, 10);
    const i1 = Number.parseInt(b, 10);
    if (!Number.isFinite(i0) || !Number.isFinite(i1)) return full;
    const idxs = expandChapterIndexRange(i0, i1);
    if (idxs.length === 0) return full;
    const markers = idxs.map((i) => standardChapterMarker(i)).join("");
    const suffix = (tail ?? "").trim();
    return suffix ? `${markers}${suffix}` : markers;
  });
}

/**
 * `（ch=25提及）` / `（ch=25章末）` / `（ch=25出现）` 等 → `（ch=25）提及`（`ch=` 后任意非数字说明移到括号外，不限定具体用词）。
 */
export function normalizeAiChapterSuffixMarkers(md: string): string {
  const re = new RegExp(
    `${CH_OPEN}\\s*ch\\s*${CH_EQ}\\s*(\\d+)\\s*([^0-9\\s,，\\-－)）]+?)\\s*${CH_CLOSE}`,
    "g",
  );
  return md.replace(re, (full, num: string, suffix: string) => {
    const s = suffix.trim();
    if (!s || new RegExp(`^ch\\s*${CH_EQ}`, "i").test(s)) return full;
    return `${standardChapterMarker(Number.parseInt(num, 10))}${s}`;
  });
}

/** Markdown 与 marked 后 HTML 文本节点共用（含全角括号、半角括号、`[ch=N]`、`(ch=标识: N)` 等兼容） */
export function createAiChapterMarkerRegex(): RegExp {
  return new RegExp(
    `${CH_OPEN}ch${CH_EQ}(\\d+)${CH_CLOSE}` +
      `|\\[ch${CH_EQ}(\\d+)\\]` +
      `|${CH_OPEN}ch[^:：)\\uFF09]+[:：]\\s*(\\d+)${CH_CLOSE}` +
      "|\\[ch[^:：\\]]+[:：]\\s*(\\d+)\\]",
    "g",
  );
}

export function chapterNumStrFromMarkerMatch(m: RegExpExecArray): string {
  return (m[1] ?? m[2] ?? m[3] ?? m[4])!;
}

/** 章节跳转按钮展示文案：优先书中章节名，无标题时回退「第 N 章」 */
export function chapterRefButtonLabel(
  chapterIndex: number,
  chapters?: readonly Chapter[],
): string {
  if (chapters && chapters.length > 0) {
    return chapterRefDisplayLabel(chapterIndex, chapters);
  }
  return Number.isFinite(chapterIndex) && chapterIndex >= 0
    ? `第 ${chapterIndex + 1} 章`
    : `章 ${chapterIndex}`;
}

/** 移除模型误写入用户正文的 chapterIndex 字面量（保留工具 JSON 代码块外的叙述） */
export function stripChapterIndexLeakage(md: string): string {
  let s = md;
  s = s.replace(/[（(]\s*chapterIndex\s*[=:]\s*\d+\s*[）)]/gi, "");
  s = s.replace(/[,，]?\s*chapterIndex\s*[=:]\s*\d+/gi, "");
  s = s.replace(/[,，]?\s*对应全书\*{0,2}第\s*\d+\s*章\*{0,2}/gu, "");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s;
}

/** 界面 Markdown 渲染前：归一化跳转标记并去掉 chapterIndex 泄漏（保留 `（ch=N）` 供按钮解析） */
export function formatAiAssistantAnswerForDisplay(
  md: string,
): string {
  if (!md.trim()) return md;
  let s = normalizeAiChapterRefMarkers(md);
  s = stripChapterIndexLeakage(s);
  return s;
}

/** 导出 / 复制：在 display 处理基础上将 `（ch=N）` 换成书中章节名 */
export function formatAiAssistantAnswerForUser(
  md: string,
  chapters?: readonly Chapter[],
): string {
  if (!md.trim()) return md;
  let s = formatAiAssistantAnswerForDisplay(md);
  if (chapters && chapters.length > 0) {
    s = substituteAiChapterMarkersWithTitles(s, chapters);
  }
  return s;
}

/** 展示 / 导出 / 复制前：将各类变体归一为标准 `（ch=N）` */
export function normalizeAiChapterRefMarkers(md: string): string {
  let s = md;
  s = normalizeCompoundAiChapterMarkers(s);
  s = normalizeAiChapterRangeMarkers(s);
  s = normalizeAiChapterSuffixMarkers(s);
  return s;
}

function chapterRefDisplayLabel(
  chapterIndex: number,
  chapters: readonly Chapter[],
): string {
  if (!Number.isFinite(chapterIndex) || chapterIndex < 0) {
    return `章 ${chapterIndex}`;
  }
  const ch = chapters[chapterIndex];
  const title = ch ? chapterTitleForDisplay(ch.title) : "";
  if (title) return title;
  return `第 ${chapterIndex + 1} 章`;
}

function wrapChapterRefLabel(label: string): string {
  return `（${label}）`;
}

/**
 * 将 `（ch=N）` / `(ch=N)` 及范围、后缀等变体替换为章节列表中的真实章节名（思维导图等纯文本展示）。
 * 有标题时仅展示标题（常已含「第N章」）；无标题时回退「第 N 章」。
 */
export function substituteAiChapterMarkersWithTitles(
  md: string,
  chapters: readonly Chapter[],
): string {
  if (!md || chapters.length === 0) return md;

  let s = normalizeAiChapterRefMarkers(md);

  const re = createAiChapterMarkerRegex();
  return s.replace(re, (full, g1, g2, g3, g4) => {
    const num = (g1 ?? g2 ?? g3 ?? g4 ?? "").trim();
    const idx = Number.parseInt(num, 10);
    if (!Number.isFinite(idx)) return full;
    return wrapChapterRefLabel(chapterRefDisplayLabel(idx, chapters));
  });
}
