import type { AnalyzeRule } from "./analyzeRule";
import {
  applyMakeUpRegex,
  containsCompositeEvalRule,
  extractEvalSegments,
  isLegadoInlineRule,
  isPlainRuleObject,
  parsePutMapFromRule,
  readJsonField,
  splitMakeUpRegexSuffix,
  type MakeUpRuleResult,
} from "./legadoCompositeRule";
import { applyRuleRegex, splitRuleRegexSuffix, trimLegadoAsciiWhitespace, trimLegadoRulePreservingRegexReplace, type RuleRegexSuffix } from "./legadoDefaultRule";
import { splitSourceRule } from "./legadoRuleSplit";
import { evalJsExpression } from "./rhinoRuntime";
import { coerceJavaString } from "./legadoJavaShims";
import { decodeHtmlEntities } from "@shared/htmlRemnantCleanup";

function coerceLegadoRuleString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return trimLegadoAsciiWhitespace(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const s = trimLegadoAsciiWhitespace(coerceJavaString(value));
    if (s && s !== "[object Object]") return s;
  }
  return "";
}

/** kind 等字段 ## 正则中的 {{book.name}} 等占位 */
export function expandBookInfoRegexTemplates(
  ar: AnalyzeRule,
  regex: RuleRegexSuffix,
): RuleRegexSuffix {
  const expand = (text: string): string =>
    text.replace(/\{\{([\s\S]*?)\}\}/g, (_, expr: string) => {
      const key = expr.trim();
      if (key === "book.name") return String(ar.bookRecord?.name ?? "");
      if (key === "book.author") return String(ar.bookRecord?.author ?? "");
      if (key === "result") return String(ar.currentContent ?? "");
      return "";
    });
  const normalizeStripPattern = (pattern: string): string =>
    pattern
      .replace(/类 别[：:]/g, "类\\s*别[：:]")
      .replace(/更新时间[：:]/g, "更新时间[：:]");
  return {
    pattern: normalizeStripPattern(expand(regex.pattern)),
    replacement: expand(regex.replacement ?? ""),
    replaceFirst: regex.replaceFirst,
  };
}

/** kind 标签：## 正则未命中时的常见前缀兜底剥离 */
export function stripLegadoKindLabelNoise(tag: string): string {
  return tag
    .replace(/^类\s*别[：:]\s*/, "")
    .replace(/^更新时间[：:]\s*/, "")
    .replace(/^\(\s*\)\s*/, "")
    .trim();
}

/** {{}} / @get 是否出现在选择器段（## 之前），而非仅出现在正则替换段 */
export function bookInfoSelectorNeedsCompositeResolver(
  selectorPart: string,
): boolean {
  const t = selectorPart.trim();
  if (!t) return false;
  if (t.includes("@get:")) return true;
  return (
    containsCompositeEvalRule(t) &&
    !/^@js:/i.test(t) &&
    !/^<js>/i.test(t)
  );
}

/** Legado putRule：解析 @put 并写入变量后再取字段值 */
async function applyBookInfoPutRule(
  ar: AnalyzeRule,
  rule: string,
  content: unknown,
): Promise<string> {
  const { cleanRule, putMap } = parsePutMapFromRule(rule);
  for (const [key, fieldRule] of Object.entries(putMap)) {
    // 走 getString：含 blogStat→postCollection.postCount 等 JSONPath 兼容回退
    const val = (await ar.getString(fieldRule, content)).trim();
    ar.putStored(key, val);
  }
  return cleanRule;
}

/** 规则末尾 `}}##正则##替换`（对齐 Legado SourceRule 分离 replaceRegex） */
function extractTrailingMakeUpSuffix(rule: string): {
  body: string;
  meta: MakeUpRuleResult | null;
} {
  const m = rule.match(/\}\}\s*(##[\s\S]*)$/);
  if (!m?.[1]) return { body: rule, meta: null };
  return {
    body: rule.slice(0, m.index! + 2),
    meta: splitMakeUpRegexSuffix(`_${m[1]}`),
  };
}

function applyBookInfoMakeUpResult(
  text: string,
  meta: MakeUpRuleResult,
  cleanRule: string,
): string {
  const trailing = extractTrailingMakeUpSuffix(cleanRule);
  if (trailing.meta?.replaceRegex) {
    let pattern = trailing.meta.replaceRegex;
    if (pattern.includes("emot")) {
      pattern = pattern.replace(/\.\*/g, ".*?");
    }
    return applyMakeUpRegex(text, { ...trailing.meta, replaceRegex: pattern });
  }
  if (meta.replaceRegex) return applyMakeUpRegex(text, meta);
  return text;
}

/** {{}} 模板 + @js: 链式规则（如 lastChapter 多段拼接） */
async function resolveBookInfoWithJsChain(
  ar: AnalyzeRule,
  cleanRule: string,
  content: unknown,
): Promise<string> {
  const segments = splitSourceRule(cleanRule);
  let result: unknown = content;
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    if (/^@js:/i.test(trimmed) || /^<js>/i.test(trimmed)) {
      result = await ar.getPlainString(trimmed, result);
      continue;
    }
    if (containsCompositeEvalRule(trimmed) && trimmed.includes("{{")) {
      result = await resolveBookInfoMakeUpField(ar, trimmed, result);
      continue;
    }
    result = await ar.getPlainString(trimmed, result);
  }
  return coerceLegadoRuleString(result);
}

/** 书籍详情 ruleBookInfo 专用解析，与搜索/发现列表规则隔离 */
export async function resolveBookInfoField(
  ar: AnalyzeRule,
  rule: string | undefined | null,
): Promise<string> {
  if (!rule?.trim()) return "";
  const content = ar.currentContent;
  const cleanRule = await applyBookInfoPutRule(ar, rule, content);
  if (!cleanRule.trim()) return "";

  if (isPlainRuleObject(content)) {
    const onObject = await resolveBookInfoOnObject(ar, cleanRule, content);
    if (onObject != null && onObject !== "") return onObject;
  }

  if (containsCompositeEvalRule(cleanRule) && !/^@js:/i.test(cleanRule.trim()) && !/^<js>/i.test(cleanRule.trim())) {
    if (/(?:<js>|@js:)/i.test(cleanRule)) {
      return resolveBookInfoWithJsChain(ar, cleanRule, content);
    }
    return resolveBookInfoMakeUpField(ar, cleanRule, content);
  }

  return ar.getPlainString(cleanRule, content);
}

/**
 * 展开 {{}} / @get 后解析字段。
 * 对齐 Legado SourceRule：`{{}}` 出现在 `##` 之后时 mode 仍为 Default，
 * 须先对选择器段 `getString`，再 `replaceRegex`（如 intro 的 `id.x@html##^##前缀{{js}}`）。
 */
async function resolveBookInfoMakeUpField(
  ar: AnalyzeRule,
  cleanRule: string,
  content: unknown,
): Promise<string> {
  const { baseRule } = splitRuleRegexSuffix(cleanRule);
  const { text, meta } = await expandBookInfoMakeUpRule(ar, cleanRule, content);
  if (!bookInfoSelectorNeedsCompositeResolver(baseRule)) {
    const selector = (meta.rule || text).trim();
    const extracted = selector ? await ar.getPlainString(selector, content) : "";
    // 对齐 Legado：选择器未命中时 getString 为 null，不跑 replaceRegex
    // （否则 ##^##前缀 会把空结果变成仅广告前缀，如爱久久网改版后无 #mainSoftIntro）
    if (!trimLegadoAsciiWhitespace(extracted)) return "";
    return applyBookInfoMakeUpResult(extracted, meta, cleanRule);
  }
  return applyBookInfoMakeUpResult(text, meta, cleanRule);
}

async function resolveBookInfoOnObject(
  ar: AnalyzeRule,
  cleanRule: string,
  content: Record<string, unknown>,
): Promise<string | null> {
  const trimmed = cleanRule.trim();
  // @js/<js> 须整段执行脚本；不可仅展开内部的 {{}}（如 tocUrl 的 {{$.id}}）
  if (/^@js:/i.test(trimmed) || /^<js>/i.test(trimmed)) {
    return null;
  }

  const { hasEval } = extractEvalSegments(cleanRule);

  if (hasEval || cleanRule.includes("@get:")) {
    if (/(?:<js>|@js:)/i.test(cleanRule)) {
      return resolveBookInfoWithJsChain(ar, cleanRule, content);
    }
    return resolveBookInfoMakeUpField(ar, cleanRule, content);
  }

  const { baseRule, regex } = splitRuleRegexSuffix(cleanRule);

  if (
    !baseRule.includes("@") &&
    !baseRule.includes("{{") &&
    !/^@js:/i.test(baseRule) &&
    !/^<js>/i.test(baseRule) &&
    !baseRule.includes("&&") &&
    !baseRule.includes("||")
  ) {
    let val = readJsonField(content, baseRule);
    if (regex) val = applyRuleRegex(val, regex);
    return val;
  }

  return null;
}

async function expandBookInfoMakeUpRule(
  ar: AnalyzeRule,
  cleanRule: string,
  content: unknown,
): Promise<{ text: string; meta: ReturnType<typeof splitMakeUpRegexSuffix> }> {
  const { body: ruleBody, meta: trailingMeta } =
    extractTrailingMakeUpSuffix(cleanRule);
  const { hasEval, literalParts, evalParts } = extractEvalSegments(ruleBody);

  if (!hasEval) {
    const trailing = extractTrailingMakeUpSuffix(cleanRule);
    if (trailing.meta?.replaceRegex) {
      return { text: trailing.body, meta: trailing.meta };
    }
    return { text: cleanRule, meta: splitMakeUpRegexSuffix(cleanRule) };
  }

  let out = "";
  for (let i = 0; i < evalParts.length; i++) {
    out += literalParts[i] ?? "";
    const part = evalParts[i];
    if (part.type === "get") {
      out += ar.lookupStored(part.expr);
    } else if (isLegadoInlineRule(part.expr)) {
      const expr = trimLegadoRulePreservingRegexReplace(part.expr);
      // @@/@css/XPath 与 && 组合须走选择器；Jsoup Element 不可当 JSON 字段读
      const forceSelector =
        /&&|\|\||%%/.test(expr) ||
        /^@@/i.test(expr) ||
        /^@css:/i.test(expr) ||
        /^@xpath:/i.test(expr) ||
        expr.startsWith("//") ||
        (expr.startsWith("/") && !expr.startsWith("$."));
      if (forceSelector || !isPlainRuleObject(content)) {
        out += await ar.getPlainString(expr, content);
      } else {
        out += readJsonField(content, expr);
      }
    } else {
      try {
        const jsOut = evalJsExpression(part.expr, {
          source: ar.sourceRecord,
          book: ar.bookRecord,
          chapter: ar.chapterRecord,
          result: content,
          baseUrl: ar.currentBaseUrl,
          host: ar.extensionHost,
          java: ar.buildRuleJavaBindings(content),
        });
        if (typeof jsOut === "number" && jsOut % 1 === 0) {
          out += String(Math.trunc(jsOut));
        } else {
          out += String(jsOut ?? "");
        }
      } catch {
        out += "";
      }
    }
  }

  const tailLiteral = literalParts[literalParts.length - 1] ?? "";
  out += tailLiteral;

  if (trailingMeta?.replaceRegex) {
    if (tailLiteral.trimStart().startsWith("##")) {
      out = out.slice(0, out.length - tailLiteral.length);
    }
    return { text: out, meta: trailingMeta };
  }

  const meta = splitMakeUpRegexSuffix(out);
  return { text: meta.rule, meta };
}

/** 最新章节展示：去掉规则拼接的时间后缀（时间由 updateTime / 简介字段展示） */
export function formatLegadoLastChapterDisplay(raw: string | undefined | null): string {
  const s = raw?.trim() ?? "";
  if (!s) return "";
  return s
    // Jsoup Elements 误 String()/join 时可能夹进 [object Object]
    .replace(/\s*[（(]\s*\[object Object\]\s*[）)]\s*/gi, "")
    .replace(/\[object Object\]/gi, "")
    .replace(/[·•][^\n]*$/, "")
    .replace(
      /\s+(?:\d+\s*(?:分钟|小时|天|周|个月|月|年)前|刚刚|\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s*$/u,
      "",
    )
    .trim();
}

/** 搜索规则 timeFormat 后的日期/时间（详情页应用目录章节名覆盖） */
export function isDateOnlyLegadoLastChapter(raw: string | undefined | null): boolean {
  const s = raw?.trim() ?? "";
  if (!s) return false;
  return /^\d{4}[./-]\d{1,2}[./-]\d{1,2}(\s+\d{1,2}:\d{2})?$/.test(s);
}

/** h1@text 等会连子节点 em 中「作者：xxx」一并取走；与 author 字段对齐后去掉书名末尾重复段 */
export function stripEmbeddedAuthorFromDetailName(
  name: string,
  author: string,
): string {
  let n = name.trim();
  const a = author.trim();
  if (!n || !a) return n;

  const authorCore = a.replace(/^作者[：:]\s*/, "").trim();
  const suffixes = [a, authorCore, `作者：${authorCore}`, `作者:${authorCore}`].filter(
    (s, i, arr) => s && arr.indexOf(s) === i,
  );

  for (const suffix of suffixes) {
    if (n.endsWith(suffix)) {
      return n.slice(0, n.length - suffix.length).trim();
    }
  }

  const m = n.match(/^(.+?)作者[：:]\s*(.+)$/);
  if (m?.[1] && m[2]) {
    const tail = m[2].trim();
    if (
      tail === authorCore ||
      tail === a ||
      authorCore.includes(tail) ||
      tail.includes(authorCore)
    ) {
      return m[1].trim();
    }
  }

  return n;
}

/** 详情简介缺首行书名时（如 digest 为空），与 Legado 一样补上标题行 */
export function ensureLegadoIntroLeadingTitle(intro: string, detailName: string): string {
  const name = detailName.trim();
  if (!name || !intro?.trim()) return intro;
  const plain = formatLegadoBookIntro(intro).trimStart();
  if (plain.startsWith(name)) return intro;
  if (plain.startsWith("--")) {
    const lead = formatLegadoBookIntro(`&emsp;&emsp;${name}`);
    return `${lead}\n${intro.trim()}`;
  }
  return intro;
}

/**
 * 详情页「最新章节」：对齐 Legado BookChapterList —
 * 有目录后用最新章节标题覆盖（不再保留规则拼接的时间等后缀）。
 * ColorTxt 目录在无 `-` 前缀时 reverse 一次，最新章在数组头部。
 */
export function resolveDetailLastChapterDisplay(
  detailLastChapter: string | undefined,
  latestChapterTitle: string | undefined,
): string {
  const fromToc = latestChapterTitle?.trim() ?? "";
  if (fromToc) return fromToc;
  return formatLegadoLastChapterDisplay(detailLastChapter)?.trim() ?? "";
}

/**
 * 段首缩进用的空白类：含全角空格 `\u3000`。
 * HtmlFormatter 的 indent1/indent2 本意是把段首规范成恰好一个 `　　`；
 * 若像 Java `\s` 那样不吃 `\u3000`，indent1 补上的缩进会被 indent2 再叠一层，
 * `##^##$1<br>` 类简介会变成 `　　　　…`，比 Legado 观感更空。
 * 纯文本简介（如 `　　…`）经 indent2 仍会收成单个 `　　`，缩进不丢。
 */
const LEGADO_INDENT_WS = "[\\t\\n\\r\\f\\v \\u3000]";

/** Legado HtmlFormatter.format / formatKeepImg：HTML 正文转纯文本 */
function formatLegadoHtmlContent(html: string, keepImg = false): string {
  if (!trimLegadoAsciiWhitespace(html)) return "";
  // JSON/API 常返回转义实体（如部分书源 novelIntro 的 &lt;br/&gt;），须先解码再剥标签
  const decoded = html.includes("&") ? unescapeLegadoHtmlEntities(html) : html;
  const tagStrip = keepImg
    ? /<\/?(?!img\b)[a-zA-Z]+(?=[ >])[^<>]*>/gi
    : /<\/?[a-zA-Z]+(?=[ >])[^<>]*>/gi;
  return decoded
    .replace(/(&nbsp;|&lrm;)+/gi, " ")
    .replace(/\u200E/g, "")
    .replace(/(&ensp;|&emsp;)/gi, " ")
    .replace(/(&thinsp;|&zwnj;|&zwj;|\u2009|\u200C|\u200D)/g, "")
    .replace(/<\/?(?:div|p|br|hr|h\d|article|dd|dl)[^>]*>/gi, "\n")
    .replace(/<!--[^>]*-->/g, "")
    .replace(tagStrip, "")
    // 对齐 Legado indent1/indent2：段间换行并规范为单个全角缩进（幂等）
    .replace(new RegExp(`${LEGADO_INDENT_WS}*\\n+${LEGADO_INDENT_WS}*`, "g"), "\n　　")
    .replace(new RegExp(`^${LEGADO_INDENT_WS}+`), "　　")
    .replace(new RegExp(`${LEGADO_INDENT_WS}+$`), "");
}

/** Legado HtmlFormatter.format：简介中的 <br> 等转为可读文本 */
export function formatLegadoBookIntro(html: string): string {
  return formatLegadoHtmlContent(html, false);
}

/** Legado HtmlFormatter.formatKeepImg：章节正文 HTML 转纯文本（保留 img） */
export function formatLegadoChapterContent(html: string): string {
  return formatLegadoHtmlContent(html, true);
}

/** 对齐 Legado StringEscapeUtils.unescapeHtml4（含 &hellip; / &nbsp; 等命名实体） */
export function unescapeLegadoHtmlEntities(text: string): string {
  if (!text.includes("&")) return text;
  return decodeHtmlEntities(text);
}
