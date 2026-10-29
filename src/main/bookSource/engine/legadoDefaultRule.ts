import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import { compileLegadoRegex } from "./analyzeByRegex";
import { normalizeLegadoCssAttrContains } from "./legadoAttrSelector";
import { jsoupPrettyElementsOuterHtml } from "./jsoupPrettyHtml";

/**
 * Cheerio/HTML5 会剥离脱离 `<table>` 的 `<tr>` / `<td>`（Jsoup 仍可保留单元格）。
 * `getElements` 序列化出的 `<tr>…</tr>` 再 `cheerio.load` 会导致 `td.N@text` 等规则全空
 *（如搜索列表字数栏 `247k`）。
 */
export function wrapOrphanTableFragments(html: string): string {
  const t = html.trim();
  if (!t) return html;
  if (/^<!doctype/i.test(t) || /^<html[\s>]/i.test(t) || /^<table[\s>]/i.test(t)) {
    return html;
  }
  if (/^<(thead|tbody|tfoot|colgroup)[\s>]/i.test(t)) {
    return `<table>${t}</table>`;
  }
  if (/^<tr[\s>]/i.test(t)) {
    return `<table><tbody>${t}</tbody></table>`;
  }
  if (/^<(td|th)[\s>]/i.test(t)) {
    return `<table><tbody><tr>${t}</tr></tbody></table>`;
  }
  return html;
}

/**
 * `JSON.stringify(Elements)` 的结果常被下一跳选择器当 HTML 再解析。
 * 若直接 `cheerio.load(jsonString)`，`\"` 会截断含空格的属性（标题丢失）。
 * 先按 JSON 数组拆出片段再拼接，对齐「可解析的元素列表」语义。
 */
export function unwrapJsonHtmlArray(html: string): string | null {
  const t = html.trim();
  if (!t.startsWith("[")) return null;
  try {
    const parsed: unknown = JSON.parse(t);
    if (!Array.isArray(parsed) || !parsed.length) return null;
    if (!parsed.every((x) => typeof x === "string")) return null;
    if (!parsed.some((x) => /<\s*\/?\s*[a-z]/i.test(x))) return null;
    return (parsed as string[]).join("\n");
  } catch {
    return null;
  }
}

/** 解析 HTML 片段/整页；自动包裹孤立的表格片段 */
export function loadCheerioHtml(html: string): CheerioAPI {
  const unwrapped = unwrapJsonHtmlArray(html);
  return cheerio.load(wrapOrphanTableFragments(unwrapped ?? html));
}

export type RuleRegexSuffix = {
  pattern: string;
  replacement: string;
  /** `##pat##repl###` 末尾 ### 表示仅替换首个匹配 */
  replaceFirst?: boolean;
};

/**
 * 去掉规则首部空白；含 `##` 时不 trimEnd，以免裁掉 `##pat##\n` 的换行替换值。
 */
export function trimLegadoRulePreservingRegexReplace(rule: string): string {
  const start = rule.replace(/^\s+/, "");
  if (!start.includes("##")) return start.trimEnd();
  return start;
}

/**
 * Legado 常见误用/惯用：用 `<js>` 包住纯 `##正则` 段，实际不是 JS。
 * - `title<js>##正则##</js>`（字段 + 替换）
 * - `<js>##正则</js>` / `@js:##正则`（链式段，如 lastChapter 后处理）
 */
function stripLegadoJsRegexWrapper(rule: string): string {
  let r = rule.trim();
  r = r.replace(/^<js>\s*(##[\s\S]*?)\s*<\/js>$/i, "$1");
  r = r.replace(/^@js:\s*(##[\s\S]*)$/i, "$1");
  r = r.replace(/^([\w.$[\]*]+)<js>(##[\s\S]*)<\/js>$/i, "$1$2");
  return r;
}

/** Legado 规则末尾 ##正则##替换（忽略 {{}} / <js>…</js> 内部的 ##） */
export function splitRuleRegexSuffix(rule: string): {
  baseRule: string;
  regex?: RuleRegexSuffix;
} {
  // 只去首部空白：末尾可能是 ##pat##\n，trim() 会裁掉替换用的换行
  const normalized = stripLegadoJsRegexWrapper(rule.replace(/^\s+/, ""));
  let braceDepth = 0;
  let inJsBlock = false;
  for (let i = 0; i < normalized.length - 1; i++) {
    if (/^<js>/i.test(normalized.slice(i, i + 4))) {
      inJsBlock = true;
      i += 3;
      continue;
    }
    if (/^<\/js>/i.test(normalized.slice(i, i + 5))) {
      inJsBlock = false;
      i += 4;
      continue;
    }
    if (inJsBlock) continue;
    if (normalized.startsWith("{{", i)) {
      braceDepth++;
      i++;
      continue;
    }
    if (normalized.startsWith("}}", i)) {
      braceDepth = Math.max(0, braceDepth - 1);
      i++;
      continue;
    }
    if (braceDepth > 0) continue;
    if (normalized[i] !== "#" || normalized[i + 1] !== "#") continue;

    const tail = normalized.slice(i + 2);
    const end = tail.indexOf("##");
    if (end < 0) {
      return {
        baseRule: normalized.slice(0, i).trimEnd(),
        regex: { pattern: tail.replace(/<\/js>$/i, ""), replacement: "" },
      };
    }
    let replacement = tail.slice(end + 2);
    let replaceFirst = false;
    // 误把整段「…##repl@js:…」传入时，勿将 @js 吃进 replacement（应对齐先 splitSourceRule）
    const jsInRepl = replacement.search(/(?:@js:|<js>|@webjs:)/i);
    if (jsInRepl >= 0) {
      replacement = replacement.slice(0, jsInRepl);
    }
    // Legado `##pat##repl###`：末尾 ### 表示仅替换首个匹配（非字面量 ##）
    if (replacement.endsWith("###")) {
      replaceFirst = true;
      replacement = replacement.slice(0, -3);
    }
    replacement = replacement.replace(/<\/js>$/i, "");
    return {
      baseRule: normalized.slice(0, i).trimEnd(),
      regex: {
        pattern: tail.slice(0, end),
        replacement,
        replaceFirst,
      },
    };
  }
  return { baseRule: normalized.trimEnd() };
}

export function applyRuleRegex(value: string, regex?: RuleRegexSuffix): string {
  if (!regex?.pattern) return value;
  try {
    // 对齐 Legado/Kotlin Regex 默认：`.` 不匹配换行（DOTALL 会让 `.*【1】.*` 之类整篇吞掉）；
    // ownText 等提取已按 Jsoup 规范化空白，无需靠 DOTALL 跨行。
    // 书源显式 `(?s)`/`(?i)` 等 Java 嵌入式标志 → compileLegadoRegex 转成 JS flags。
    if (regex.replaceFirst) {
      // Legado AnalyzeRule.replaceRegex：### → 取首个匹配再替换；未命中返回 ""
      const re = compileLegadoRegex(regex.pattern, "");
      if (!re) return value;
      const m = value.match(re);
      if (!m?.[0]) return "";
      return m[0].replace(re, regex.replacement ?? "");
    }
    const re = compileLegadoRegex(regex.pattern, "g");
    if (!re) return value;
    return value.replace(re, regex.replacement ?? "");
  } catch {
    return value;
  }
}

const EXTRACT_TYPES = new Set(
  [
    "text",
    "html",
    "all",
    "href",
    "src",
    "ownText",
    "textNodes",
    "children",
  ].map((s) => s.toLowerCase()),
);

export function isLegadoExtractType(s: string): boolean {
  const t = s.trim().toLowerCase();
  if (!t) return false;
  if (EXTRACT_TYPES.has(t)) return true;
  if (t.startsWith("[") && t.endsWith("]")) return true;
  return false;
}

/** 规则末段 `@li` / `@span` 等为子节点选择，非 `@attr` 属性提取 */
const TAG_CHILD_SELECTOR_NAMES = new Set(
  [
    "a", "abbr", "article", "aside", "b", "blockquote", "body", "button", "caption",
    "code", "dd", "div", "dl", "dt", "em", "figcaption", "figure", "footer", "form",
    "h1", "h2", "h3", "h4", "h5", "h6", "header", "i", "img", "input", "label", "li",
    "main", "nav", "object", "ol", "optgroup", "option", "p", "pre", "section", "select",
    "small", "span", "strong", "sub", "sup", "table", "tbody", "td", "textarea", "tfoot",
    "th", "thead", "tr", "u", "ul", "video",
  ].map((s) => s.toLowerCase()),
);

/** Legado `@data-bid` / `@title` / `@_src` 等属性提取（非 class/tag/id 选择器段） */
export function isLegadoAttrExtract(s: string): boolean {
  const t = s.trim();
  if (!t || isLegadoExtractType(t)) return false;
  if (t.startsWith("js:") || t.startsWith("@js:")) return false;
  if (/^(class|tag|id|text|children)\./.test(t)) return false;
  if (t.startsWith(".") || t.startsWith("#") || /[\[\]>+~*,]/.test(t)) return false;
  if (TAG_CHILD_SELECTOR_NAMES.has(t.toLowerCase())) return false;
  // 须允许 `_src` 等懒加载属性（如部分书源：`img@_src`）
  return /^[a-zA-Z_][\w-]*$/.test(t);
}

export function splitLegadoPathAndIndex(s: string): {
  path: string;
  index?: number;
} {
  const parts = s.split(".");
  const last = parts[parts.length - 1] ?? "";
  if (parts.length > 1 && /^-?\d+$/.test(last)) {
    return {
      path: parts.slice(0, -1).join("."),
      index: Number.parseInt(last, 10),
    };
  }
  return { path: s };
}

/**
 * 规则末段结果提取：`@src` / `@href` / `@data-src`，以及结果索引 `@src.0`（取列表第 0 条）。
 * 与 `img.0@src`（先筛元素再取属性）等价于常见写法 `img@src.0`。
 */
export type LegadoResultExtract = {
  /** `text`/`src`/`href`/`[data-src]` 等，供 extractFromElement */
  extract: string;
  /** 多结果时的索引；缺省保留全部（getString 再换行拼接） */
  resultIndex?: number;
};

export function parseLegadoResultExtract(lastPart: string): LegadoResultExtract | null {
  const t = lastPart.trim();
  if (!t || t.startsWith("js:") || t.startsWith("@js:")) return null;
  const { path, index } = splitLegadoPathAndIndex(t);
  if (!path) return null;
  if (isLegadoExtractType(path)) {
    return { extract: path, resultIndex: index };
  }
  if (isLegadoAttrExtract(path)) {
    return { extract: `[${path}]`, resultIndex: index };
  }
  return null;
}

/** 从多条规则结果中取下标（支持负数） */
export function pickLegadoResultByIndex(
  parts: string[],
  index: number | undefined,
): string[] {
  if (index == null || !parts.length) return parts;
  const i = index < 0 ? parts.length + index : index;
  if (i < 0 || i >= parts.length) return [];
  return [parts[i]!];
}

/** Legado 方括号索引区间 [start:end:step]（两端均含，对齐 AnalyzeByJSoup） */
export type LegadoIndexRange = {
  start: number;
  end?: number;
  step?: number;
};

type LegadoSegmentIndexSplit = {
  beforeRule: string;
  index?: number;
  indices?: number[];
  excludeIndex?: number;
  excludeIndices?: number[];
  range?: LegadoIndexRange;
};

function resolveLegadoElementIndex(i: number, length: number): number {
  return i < 0 ? length + i : i;
}

/** 段末 `[1:2]` / `[1,2]` / `[-1]` / `[!0,1]`（非 CSS 属性选择器） */
function parseLegadoBracketIndex(raw: string): Omit<LegadoSegmentIndexSplit, "beforeRule"> | null {
  const inner = raw.trim();
  if (!inner || !/^![\d:,-]+$|^[\d:,-]+$/.test(inner)) return null;

  const excludeList = inner.startsWith("!");
  const body = excludeList ? inner.slice(1) : inner;
  if (!body) return null;

  if (body.includes(",")) {
    const indices = body.split(",").map((n) => Number.parseInt(n.trim(), 10));
    if (indices.some((n) => Number.isNaN(n))) return null;
    return excludeList ? { excludeIndices: indices } : { indices };
  }

  if (body.includes(":")) {
    const parts = body.split(":");
    const start = parts[0] !== "" ? Number.parseInt(parts[0]!, 10) : 0;
    const end =
      parts[1] !== "" && parts[1] != null ? Number.parseInt(parts[1], 10) : undefined;
    const step =
      parts[2] !== "" && parts[2] != null ? Number.parseInt(parts[2], 10) : undefined;
    if (Number.isNaN(start) || (end != null && Number.isNaN(end)) || (step != null && Number.isNaN(step))) {
      return null;
    }
    return { range: { start, end, step } };
  }

  const index = Number.parseInt(body, 10);
  if (Number.isNaN(index)) return null;
  return { index };
}

/** Legado findIndexSet：从段末解析 .N / !N / .N:N:N / !N:N / [1:2] / [1,2] 索引 */
function splitLegadoSegmentIndex(segment: string): LegadoSegmentIndexSplit {
  const raw = segment.trim();

  // 方括号索引优先：tag.div[1:2] / tag.div[!0,1]
  const bracketEnd = raw.match(/^(.*?)\[([^\]]+)\]$/);
  if (bracketEnd?.[1] != null && bracketEnd[1] !== "") {
    const parsed = parseLegadoBracketIndex(bracketEnd[2]!);
    if (parsed) {
      return { beforeRule: bracketEnd[1], ...parsed };
    }
  }

  /**
   * 阅读原写法：`tag.div!0:1:2`（`!` 排除）或 `tag.div.0:1:2`（`.` 选取）。
   * 须整段识别；不可先把 `!0:1:2` 误拆成 `.`/`:` 多选索引（会把 before 变成 `tag.dd!0`）。
   */
  const classic = raw.match(/^(.*?)([!.])(-?\d+(?::-?\d+)*)$/);
  if (classic?.[1] != null && classic[1] !== "" && classic[2] && classic[3]) {
    const nums = classic[3].split(":").map((n) => Number.parseInt(n, 10));
    if (!nums.some((n) => Number.isNaN(n))) {
      if (classic[2] === "!") {
        return nums.length === 1
          ? { beforeRule: classic[1], excludeIndex: nums[0] }
          : { beforeRule: classic[1], excludeIndices: nums };
      }
      return nums.length === 1
        ? { beforeRule: classic[1], index: nums[0] }
        : { beforeRule: classic[1], indices: nums };
    }
  }

  return { beforeRule: raw };
}

export type LegadoSelectorSegment = {
  index?: number;
  indices?: number[];
  excludeIndex?: number;
  excludeIndices?: number[];
  range?: LegadoIndexRange;
  className?: string;
  tagName?: string;
  elementId?: string;
  ownText?: string;
  css?: string;
  children?: boolean;
};

export function hasLegadoSegmentIndex(parsed: LegadoSelectorSegment): boolean {
  return (
    parsed.index != null ||
    parsed.excludeIndex != null ||
    (parsed.excludeIndices != null && parsed.excludeIndices.length > 0) ||
    parsed.range != null ||
    (parsed.indices != null && parsed.indices.length > 0)
  );
}

/** Legado class.xxx：rules[1] 内空格表示同一元素需同时具备的多个 class（JSoup getElementsByClass） */
function legadoClassSelector(className: string): string {
  const tokens = className.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  return tokens.map((t) => `.${t}`).join("");
}

/** 解析 Legado 默认规则单段（class/tag/id/text/CSS 等） */
export function parseLegadoSelectorSegment(segment: string): LegadoSelectorSegment {
  const { beforeRule, index, indices, excludeIndex, excludeIndices, range } =
    splitLegadoSegmentIndex(segment);
  const indexFields = { index, indices, excludeIndex, excludeIndices, range };
  if (beforeRule.startsWith("class.")) {
    const name = beforeRule.slice(6).split(".")[0] ?? "";
    return { className: name, ...indexFields };
  }
  if (beforeRule.startsWith("tag.")) {
    const name = beforeRule.slice(4).split(".")[0] ?? "";
    return { tagName: name, ...indexFields };
  }
  if (beforeRule.startsWith("id.")) {
    const name = beforeRule.slice(3).split(".")[0] ?? "";
    return { elementId: name, ...indexFields };
  }
  if (beforeRule.startsWith("text.")) {
    return { ownText: beforeRule.slice(5), ...indexFields };
  }
  if (beforeRule === "children") {
    return { children: true, ...indexFields };
  }
  return { css: beforeRule, ...indexFields };
}

function elementsContainingOwnText(
  $: CheerioAPI,
  scope: Cheerio<any>,
  text: string,
  fromRoot: boolean,
): Cheerio<any> {
  const pool = fromRoot ? $("*") : scope.find("*").addBack();
  const needle = text.trim();
  return pool.filter((_, el) => {
    const own = $(el)
      .contents()
      .filter((__, node) => node.type === "text")
      .text()
      .trim();
    return own.includes(needle);
  });
}

/**
 * 对齐 Jsoup Element.select：相对查询须包含 scope 自身（若匹配）。
 * Cheerio 的 find() 不含自身，会导致 `.category-div@h3@…` 在已是 category-div 的条目上取空。
 */
function queryInScope(
  $: CheerioAPI,
  scope: Cheerio<any>,
  sel: string,
  fromRoot: boolean,
): Cheerio<any> {
  const css = normalizeLegadoCssAttrContains(sel);
  try {
    if (fromRoot) return $(css);
    const self = scope.filter(css);
    const descendants = scope.find(css);
    return self.length ? descendants.add(self) : descendants;
  } catch {
    // 非法 CSS：对齐 Legado 空结果
    return $("");
  }
}

/** 在 scope 内按 Legado 单段规则查询元素 */
export function queryLegadoSelectorSegment(
  $: CheerioAPI,
  scope: Cheerio<any>,
  segment: string,
  fromRoot: boolean,
): Cheerio<any> {
  const parsed = parseLegadoSelectorSegment(segment);
  try {
    let found: Cheerio<any>;
    if (parsed.className != null) {
      const sel = legadoClassSelector(parsed.className);
      found = queryInScope($, scope, sel, fromRoot);
    } else if (parsed.tagName != null) {
      found = queryInScope($, scope, parsed.tagName, fromRoot);
    } else if (parsed.elementId != null) {
      const sel = `#${parsed.elementId}`;
      found = queryInScope($, scope, sel, fromRoot);
    } else if (parsed.ownText != null) {
      found = elementsContainingOwnText($, scope, parsed.ownText, fromRoot);
    } else if (parsed.children) {
      found = fromRoot ? $.root().children() : scope.children();
    } else if (parsed.css) {
      found = queryInScope($, scope, parsed.css, fromRoot);
    } else {
      return $("");
    }
    return pickElements(found, parsed, $);
  } catch {
    // 非法 CSS（如误入的 http://… 字面量）对齐 Legado：空结果，勿抛
    return $("");
  }
}

/**
 * Legado AnalyzeByJSoup.getResultList：对每个父元素分别执行下一段规则并合并结果，
 * 中间段不做 pickElements(found, 0) 截断。
 */
export function legadoCollectResultTexts(
  html: string,
  ruleStr: string,
): string[] {
  const { baseRule } = splitRuleRegexSuffix(ruleStr.replace(/^@@/, "").trim());
  const trimmed = baseRule.trim();
  if (!trimmed) return [];

  const atParts = trimmed.split("@").filter(Boolean);
  let extract: string | null = null;
  let resultIndex: number | undefined;
  let selectorSegs = atParts;
  const lastPart = atParts[atParts.length - 1];
  const parsedExtract = lastPart ? parseLegadoResultExtract(lastPart) : null;
  if (parsedExtract) {
    extract = parsedExtract.extract;
    resultIndex = parsedExtract.resultIndex;
    selectorSegs = atParts.slice(0, -1);
  }
  if (!extract || !selectorSegs.length) return [];

  const $ = loadCheerioHtml(html);
  // 须含 <head>（og:novel:category 等 meta）；勿只从 body 起查
  const htmlRoot = $("html");
  const body = $("body");
  let roots: any[] = htmlRoot.length
    ? htmlRoot.toArray()
    : body.length
      ? body.toArray()
      : $.root().children().toArray();
  if (!roots.length) return [];

  let elements = roots;
  for (const seg of selectorSegs) {
    const next: any[] = [];
    for (const el of elements) {
      const found = queryLegadoSelectorSegment($, $(el), seg, false);
      found.each((_, node) => {
        next.push(node);
      });
    }
    elements = next;
    if (!elements.length) return [];
  }

  const out: string[] = [];
  const tagListContainerText =
    selectorSegs.length === 1 &&
    /^@?\.tag-list$/i.test(selectorSegs[0]?.trim() ?? "") &&
    extract?.trim().toLowerCase() === "text";
  for (const el of elements) {
    let v = trimLegadoAsciiWhitespace(extractFromElement($(el), extract));
    if (tagListContainerText) {
      v = normalizeLegadoAsciiWhitespace(v);
    }
    if (v) out.push(v);
  }
  return pickLegadoResultByIndex(out, resultIndex);
}

/** Legado getString：多条结果用换行拼接 */
export function legadoJoinResultTexts(parts: string[]): string {
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0] ?? "";
  return parts.join("\n");
}

/** Legado 默认规则段：class.xxx / tag.a.0 / id.foo / .item / a.tag / text.目录 */
export function legadoSegmentToCss(segment: string): {
  css: string;
  index?: number;
  indices?: number[];
  excludeIndex?: number;
  excludeIndices?: number[];
  range?: LegadoIndexRange;
} {
  const parsed = parseLegadoSelectorSegment(segment);
  const indexFields = {
    index: parsed.index,
    indices: parsed.indices,
    excludeIndex: parsed.excludeIndex,
    excludeIndices: parsed.excludeIndices,
    range: parsed.range,
  };
  if (parsed.className != null) {
    return {
      css: legadoClassSelector(parsed.className),
      ...indexFields,
    };
  }
  if (parsed.tagName != null) {
    return {
      css: parsed.tagName,
      ...indexFields,
    };
  }
  if (parsed.elementId != null) {
    return {
      css: `#${parsed.elementId}`,
      ...indexFields,
    };
  }
  if (parsed.ownText != null) {
    return {
      css: "text",
      ...indexFields,
    };
  }
  if (parsed.children) {
    return {
      css: "children",
      ...indexFields,
    };
  }
  return {
    css: parsed.css ?? "",
    ...indexFields,
  };
}

/**
 * Legado AnalyzeByJSoup.findIndexSet：`start..end` / `downTo` 均为闭区间。
 * 例：`.book_other[1:2]` 取第 2、3 个（索引 1 与 2），不是半开区间。
 */
function pickElementsByRange(
  els: Cheerio<any>,
  range: LegadoIndexRange,
  $?: CheerioAPI,
): Cheerio<any> {
  if (!els.length) return els;
  const len = els.length;
  const step = range.step ?? 1;
  const start = resolveLegadoElementIndex(range.start, len);
  // end 未写时取到最后一个元素（含）；勿写成 len 以免闭区间越界
  const end =
    range.end === undefined
      ? len - 1
      : resolveLegadoElementIndex(range.end, len);
  const nodes: any[] = [];
  if (step > 0) {
    for (let i = start; i <= end && i < len; i += step) {
      if (i >= 0) {
        const node = els.get(i);
        if (node != null) nodes.push(node);
      }
    }
  } else {
    for (let i = start; i >= end; i += step) {
      if (i >= 0 && i < len) {
        const node = els.get(i);
        if (node != null) nodes.push(node);
      }
    }
  }
  if (!nodes.length) return els.slice(0, 0);
  return $ ? $(nodes) : els.filter((_i, el) => nodes.includes(el));
}

export function pickElements(
  els: Cheerio<any>,
  pick: Pick<
    LegadoSelectorSegment,
    "index" | "indices" | "excludeIndex" | "excludeIndices" | "range"
  >,
  $?: CheerioAPI,
): Cheerio<any> {
  const { index, indices, excludeIndex, excludeIndices, range } = pick;
  if (!els.length) return els;
  if (range) return pickElementsByRange(els, range, $);
  if (indices?.length) {
    const nodes: any[] = [];
    for (const i of indices) {
      const idx = resolveLegadoElementIndex(i, els.length);
      const node = els.get(idx);
      if (node != null) nodes.push(node);
    }
    if (!nodes.length) return els.slice(0, 0);
    return $ ? $(nodes) : els.filter((_i, el) => nodes.includes(el));
  }
  if (excludeIndices?.length) {
    const excluded = new Set(
      excludeIndices.map((i) => resolveLegadoElementIndex(i, els.length)),
    );
    return els.filter((i) => !excluded.has(i));
  }
  if (excludeIndex != null && index == null) {
    const idx = resolveLegadoElementIndex(excludeIndex, els.length);
    return els.filter((i) => i !== idx);
  }
  if (index == null) return els;
  const idx = resolveLegadoElementIndex(index, els.length);
  return els.eq(idx);
}

/** 从规则 content（单条 HTML 片段）取根节点，用于 Legado 裸 text/href 等提取 */
export function cheerioContentRoot($: CheerioAPI): Cheerio<any> {
  let root = $.root().children().first();
  const tag = root.prop("tagName")?.toLowerCase();
  if (tag === "html") {
    const bodyChild = root.find("body").children();
    if (bodyChild.length) return bodyChild.first();
    const nonHead = root.children().not("head");
    if (nonHead.length) return nonHead.first();
  }
  if (root.length) return root;
  const body = $("body");
  return body.length ? body : $.root();
}

/** Legado 目录等：规则仅为 text / href 时，从当前 content 元素直接提取 */
export function extractFromContentRoot(
  content: unknown,
  extract: string,
  list: boolean,
): unknown {
  const html = typeof content === "string" ? content : String(content ?? "");
  const $ = loadCheerioHtml(html);
  const root = cheerioContentRoot($);
  if (!root.length) return list ? [] : "";
  if (list) {
    const v = trimLegadoAsciiWhitespace(extractFromElement(root, extract));
    return v ? [v] : [];
  }
  return extractFromElement(root, extract);
}

/**
 * 去掉首尾 ASCII 空白，但**保留换行** `\n`/`\r`。
 * - 勿用 JS `trim`/`\s`：会吃掉全角空格 `\u3000`（简介段首缩进）
 * - 勿裁掉换行：`##pat##\n$1` 类替换（榜单规则）依赖结果以 `\n` 开头，Legado 替换后不 trim
 */
export function trimLegadoAsciiWhitespace(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end) {
    const c = s.charCodeAt(start);
    if (c === 0x0a || c === 0x0d || c > 0x20) break;
    start += 1;
  }
  while (end > start) {
    const c = s.charCodeAt(end - 1);
    if (c === 0x0a || c === 0x0d || c > 0x20) break;
    end -= 1;
  }
  return s.slice(start, end);
}

/** 折叠 ASCII 空白为单空格并 trim；保留全角空格等（对齐 Jsoup text 规范化范围） */
export function normalizeLegadoAsciiWhitespace(raw: string): string {
  let out = "";
  let prevWs = true;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c <= 0x20) {
      if (!prevWs) {
        out += " ";
        prevWs = true;
      }
    } else {
      out += raw[i]!;
      prevWs = false;
    }
  }
  return prevWs && out.endsWith(" ") ? out.slice(0, -1) : out;
}

/**
 * Jsoup `Tag.isBlock` 常用集合（含 `br`：text() 时按块边界插空格）。
 * 块级边界插空格，否则 `<div>暂无</div><div>里程碑</div>` 会粘成「暂无里程碑」，
 * 榜单类 `##(\S+)\s+…` 替换会失效。
 */
const LEGADO_JSOUP_BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "caption",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "html",
  "legend",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

function isLegadoJsoupBlockTag(tagName: string): boolean {
  return LEGADO_JSOUP_BLOCK_TAGS.has(tagName.toLowerCase());
}

function lastCharIsAsciiWhitespace(s: string): boolean {
  if (!s) return false;
  return s.charCodeAt(s.length - 1) <= 0x20;
}

/**
 * 对齐 Legado/JSoup `Element.text()`：
 * - 忽略 script / style / noscript / textarea
 * - 块级元素（及 br）边界插入空格（Cheerio `.text()` 不会）
 * - 仅折叠 code≤0x20 的空白（勿用 JS `\s`/`trim`，以免去掉简介段首全角缩进）
 */
function legadoElementText(el: Cheerio<any>): string {
  if (!el.length) return "";
  let out = "";
  const walk = (node: any) => {
    if (!node) return;
    if (node.type === "text") {
      const raw = typeof node.data === "string" ? node.data : "";
      for (let i = 0; i < raw.length; i++) {
        const c = raw.charCodeAt(i);
        if (c <= 0x20) {
          if (out && !lastCharIsAsciiWhitespace(out)) out += " ";
        } else {
          out += raw[i]!;
        }
      }
      return;
    }
    if (node.type !== "tag" && node.type !== "script" && node.type !== "style") {
      return;
    }
    const name = String(node.name ?? "").toLowerCase();
    if (name === "script" || name === "style" || name === "noscript" || name === "textarea") {
      return;
    }
    const block = isLegadoJsoupBlockTag(name);
    if (block && out && !lastCharIsAsciiWhitespace(out)) out += " ";
    const children: any[] = node.children ?? [];
    for (const child of children) walk(child);
    if (block && out && !lastCharIsAsciiWhitespace(out)) out += " ";
  };
  el.each((_, root) => walk(root));
  return normalizeLegadoAsciiWhitespace(out);
}

/**
 * 对齐 Legado AnalyzeByJSoup `textNodes`：
 * 仅取元素的直接 Text 子节点，各自 `trim { it <= ' ' }`，再用 `\n` 拼接。
 * （不等于 `@text`：后者会递归取出所有后代文本，易把子标签里的广告行一并捞进正文。）
 */
function legadoElementTextNodes(el: Cheerio<any>): string {
  if (!el.length) return "";
  const parts: string[] = [];
  el.contents().each((_, node) => {
    if (node.type !== "text") return;
    // Kotlin: trim { it <= ' ' } —— 只去掉 code<=0x20，保留全角空格等
    const raw = "data" in node && typeof (node as { data?: string }).data === "string"
      ? (node as { data: string }).data
      : "";
    let start = 0;
    let end = raw.length;
    while (start < end && raw.charCodeAt(start) <= 0x20) start += 1;
    while (end > start && raw.charCodeAt(end - 1) <= 0x20) end -= 1;
    const text = raw.slice(start, end);
    if (text) parts.push(text);
  });
  return parts.join("\n");
}

/**
 * Legado `Elements.outerHtml()`（含选中节点自身标签）。
 * 输出对齐 Jsoup pretty-print：`<br>`/块级边界换行。行边界决定 `##` 正则
 * （不跨行）能吃掉什么——分页导航须独占一行，否则同行的正文末句会被误删。
 *
 * `@html` 会先去掉 script/style（对齐 AnalyzeByJSoup.getResultLast）；
 * `@all` 保留全文（部分正文规则依赖 body 内 `__INITIAL_STATE__` 等脚本）。
 */
function legadoElementOuterHtml(
  el: Cheerio<any>,
  stripScriptStyle: boolean,
): string {
  if (!el.length) return "";
  const clone = el.clone();
  if (stripScriptStyle) {
    clone.find("script, style").remove();
  }
  return jsoupPrettyElementsOuterHtml(clone);
}

export function extractFromElement(
  el: Cheerio<any>,
  extract: string,
): string {
  if (!el.length) return "";
  const t = extract.trim();
  const lower = t.toLowerCase();

  if (lower === "text") return legadoElementText(el);
  if (lower === "textnodes") return legadoElementTextNodes(el);
  if (lower === "html") return legadoElementOuterHtml(el, true);
  if (lower === "all") return legadoElementOuterHtml(el, false);
  if (lower === "owntext") {
    // 对齐 Jsoup ownText()：直接文本子节点 + 空白规范化（否则 <br> 间换行残留，
    // ## 正则须靠 DOTALL 跨行才匹配，进而引发 `.*` 整篇吞掉）
    return normalizeLegadoAsciiWhitespace(
      el
        .contents()
        .filter((_, node) => node.type === "text")
        .text(),
    );
  }
  if (lower === "href") return el.attr("href") ?? "";
  if (lower === "src") return el.attr("src") ?? el.attr("data-src") ?? "";
  if (lower === "children") return el.html() ?? "";

  const attrMatch = t.match(/^\[(.+)]$/);
  if (attrMatch) return el.attr(attrMatch[1]) ?? "";

  // 属性名提取（如 isVip 误写 `true`、或 `@data-id`）：无该属性时返回空。
  // 不可回退成元素 text，否则 `isVip:"true"` 会变成章节名 → 全部误判 VIP。
  if (el.attr(t) != null) return el.attr(t)!;
  if (isLegadoAttrExtract(t) || /^[a-zA-Z_][\w:-]*$/.test(t)) {
    return "";
  }

  return legadoElementText(el);
}

export function elementsToHtmlList(
  els: Cheerio<any>,
  $: CheerioAPI,
): string[] {
  const out: string[] = [];
  els.each((_, el) => {
    out.push($.html(el) ?? "");
  });
  return out;
}

/** SF 详情页 `.tag-list`：各 `<li>` 内 `span.text` 为标签文案 */
export function extractTagListLabelsFromHtml(html: string): string {
  const $ = loadCheerioHtml(html);
  const list = $(".tag-list").first();
  if (!list.length) return "";
  const out: string[] = [];
  list.children("li").each((_, li) => {
    const labelEl = $(li).find("span.text").first();
    const v = (labelEl.length ? labelEl : $(li)).text().trim();
    if (v) out.push(v);
  });
  return out.join(" ");
}

/** Legado `.tag-list@text`：容器 element.text() 一次取全（子节点以空格连接） */
export function isTagListContainerTextRule(rule: string): boolean {
  const { baseRule } = splitRuleRegexSuffix(rule.trim());
  return /^@?\.tag-list@text$/i.test(baseRule.trim());
}

/** 是否为 SF 等书源的 tag-list 文本规则（含 @span.N@text 变体） */
export function isTagListTextRule(rule: string): boolean {
  const { baseRule } = splitRuleRegexSuffix(rule.trim());
  const t = baseRule.trim();
  if (/^@?\.tag-list@text$/i.test(t)) return true;
  if (/^@?\.tag-list@span(?:\.\w+|\.\d+)@text$/i.test(t)) return true;
  if (/^@?\.tag-list@li@span(?:\.\w+|\.\d+)@text$/i.test(t)) return true;
  return false;
}

/** SF 等书源 tag-list：@span 变体逐 li 提取；裸 @text 保持 Legado 容器 text() 语义 */
export function normalizeTagListTextRule(rule: string): string | null {
  if (!isTagListTextRule(rule)) return null;
  if (isTagListContainerTextRule(rule)) return null;
  return "@.tag-list@li@text";
}

/** 从 `.tag-list` 容器读取 Legado 式合并文本（空格分隔子节点） */
export function tagListContainerTextFromHtml(html: string): string {
  const $ = loadCheerioHtml(html);
  const text = legadoElementText($(".tag-list").first()).replace(/\s+/g, " ").trim();
  return text;
}

export function extractIndexedSpanTextFromListItems(
  $: CheerioAPI,
  listRoot: Cheerio<any>,
  spanIndex: number,
  extract: string,
): string {
  const items = listRoot.children("li");
  if (!items.length) return "";
  const out: string[] = [];
  items.each((_, li) => {
    const spans = $(li).find("span");
    const picked = pickElements(spans, { index: spanIndex }, $);
    if (!picked.length) return;
    const v = extractFromElement(picked, extract).trim();
    if (v) out.push(v);
  });
  return out.join("\n");
}
