import * as cheerio from "cheerio";
import { JSONPath } from "jsonpath-plus";
import type { BookSourceRecord } from "@shared/bookSource/types";
import { normalizeBookSourceBaseUrl, normalizeHttpUrlPath, resolveAbsoluteUrl } from "@shared/bookSource/url";
import { createJsExtensionHost, type JsExtensionHost } from "./jsExtensions";
import { selectXPath } from "./htmlXPath";
import {
  applyRuleRegex as applyRuleRegexImpl,
  extractFromElement,
  extractFromContentRoot,
  isLegadoExtractType,
  isLegadoAttrExtract,
  hasLegadoSegmentIndex,
  loadCheerioHtml,
  parseLegadoResultExtract,
  parseLegadoSelectorSegment,
  pickElements,
  pickLegadoResultByIndex,
  queryLegadoSelectorSegment,
  splitRuleRegexSuffix,
  trimLegadoRulePreservingRegexReplace,
  normalizeTagListTextRule,
  extractIndexedSpanTextFromListItems,
  extractTagListLabelsFromHtml,
  isTagListTextRule,
  isTagListContainerTextRule,
  tagListContainerTextFromHtml,
  legadoCollectResultTexts,
  legadoJoinResultTexts,
  trimLegadoAsciiWhitespace,
  type RuleRegexSuffix,
} from "./legadoDefaultRule";
import {
  isLegadoAttrSelectorSegment,
  normalizeLegadoCssAttrContains,
  queryLegadoAttrSelector,
} from "./legadoAttrSelector";
import {
  bindJsHtmlValue,
  cheerioToJsoupList,
  isJsoupElementLike,
  asLegadoJavaGetElementResult,
} from "./legadoJsoupShim";
import {
  looksLikeLegadoRegexRule,
  parseRegexRuleList,
  regexGetElement,
  regexGetElements,
} from "./analyzeByRegex";
import { isVerificationCancelled } from "./sourceVerification";
import { evalJs, evalJsAsync, evalJsExpression } from "./rhinoRuntime";
import { ensureLegadoListApi } from "./legadoJsList";
import {
  isLegadoJsRule,
  looksLikeLegadoJs,
  shouldSplitOrAlternatives,
  splitLegadoCompoundRule,
  splitSourceRule,
  stripLegadoJsRuleMarkers,
  wrapLegadoJsRule,
} from "./legadoRuleSplit";
import {
  expandLegadoGetRefs,
  isLegadoEmbeddedRuleExpr,
  isLegadoJsonPathExpr,
  isLegadoLiteralUrlRule,
  isLegadoTemplateOnlyRule,
  isPureMustacheTemplateRule,
  legadoJsonPathFromRule,
  coerceLegadoMediaUrl,
  isPlainRuleObject,
  parsePutMapFromRule,
  parseLegadoPureGetKey,
  readJsonField,
  readJsonNestedValue,
  sourceVariableCacheKey,
  extractUrlFetchOptionsSuffix,
  splitUrlAndRuleVariables,
} from "./legadoCompositeRule";
import { getCacheValue } from "../store/bookSourceStore";
import { runBackstageWebView, stripWebJsRule } from "./backstageWebView";
import type { LegadoVariableSync } from "./legadoRuleEntity";
import { createBookVariableSync } from "./legadoRuleEntity";
import { getBookCustomVariable } from "../store/bookSourceStore";
import { coerceJavaString } from "./legadoJavaShims";
import { unescapeLegadoHtmlEntities } from "./bookInfoRules";

export {
  isLegadoJsRule,
  looksLikeLegadoJs,
  shouldSplitOrAlternatives,
  splitSourceRule,
  stripLegadoJsRuleMarkers,
} from "./legadoRuleSplit";

export type RuleData = {
  variable?: Record<string, string>;
  [key: string]: unknown;
};

type AnalyzeMode = "default" | "json" | "xpath" | "js" | "webJs" | "regex" | "template";

function coerceLegadoRuleString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return trimLegadoAsciiWhitespace(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    // 对齐 Legado：列表用换行拼接（勿用逗号，否则 URL 数组 / tagList 会被拆坏）
    return value
      .map((v) => coerceLegadoMediaUrl(v))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") {
    // Jsoup Elements / Element：优先 .text()，避免 String(el) → [object Object]
    const withText = value as { text?: unknown };
    if (typeof withText.text === "function") {
      try {
        const t = trimLegadoAsciiWhitespace(String(withText.text.call(value) ?? ""));
        if (t && t !== "[object Object]") return t;
      } catch {
        /* fall through */
      }
    }
    const s = trimLegadoAsciiWhitespace(coerceJavaString(value));
    if (s && s !== "[object Object]") return s;
  }
  return "";
}

/**
 * Legado `replaceRegex(result.toString())` 的输入串。
 * Element/Elements.toString() === outerHtml，故纯 `##pat##repl` 规则里的 `[^<]+` 能在标签处停住。
 * 不可用 coerceLegadoRuleString（其优先 .text()，无 `<` 会把作者/简介/日期一并吞掉）。
 */
function legadoContentToReplaceSource(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (isJsoupElementLike(content)) {
    try {
      return String((content as { outerHtml: () => string }).outerHtml() ?? "");
    } catch {
      /* fall through */
    }
  }
  if (Array.isArray(content)) {
    return content
      .map((v) => legadoContentToReplaceSource(v))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content === "object") {
    const withOuter = content as { outerHtml?: unknown; toString?: unknown };
    if (typeof withOuter.outerHtml === "function") {
      try {
        return String(withOuter.outerHtml.call(content) ?? "");
      } catch {
        /* fall through */
      }
    }
    const s = coerceJavaString(content);
    if (s && s !== "[object Object]") return s;
  }
  return String(content ?? "");
}

export class AnalyzeRule {
  private content: unknown = "";
  private baseUrl = "";
  private redirectUrl = "";
  private ruleUrlCtx = "";
  private requestUrlCtx = "";
  private source?: BookSourceRecord;
  private book?: Record<string, unknown>;
  private chapter?: Record<string, unknown>;
  private nextChapterUrl = "";
  private ruleData: RuleData = {};
  private contentIsJson = false;
  /** 规则链起始上下文（搜索/发现列表项），供 @js 内 {{$.}} 展开 */
  private chainItemContext: unknown = undefined;
  private host: JsExtensionHost;

  constructor(
    source?: BookSourceRecord,
    _logs: string[] = [],
    host?: JsExtensionHost,
  ) {
    this.source = source;
    this.host = host ?? createJsExtensionHost(source ?? emptySource(), _logs);
  }

  setContent(content: unknown, baseUrl = ""): this {
    this.content = content;
    this.baseUrl = baseUrl;
    this.contentIsJson = isLegadoJsonContent(content);
    if (!this.redirectUrl) this.redirectUrl = baseUrl;
    // 规则 JS 内显式 setContent 后，java.getString 默认读链上下文；
    // 若仍指向 getString 起始页（如 tocHtml），会取空（部分书源正文只剩 ★）
    if (this.chainItemContext !== undefined) {
      this.chainItemContext = content;
    }
    return this;
  }

  /**
   * `java.ajax` 仅在规则链内更新 getString 默认上下文，不改写 AnalyzeRule.content
   *（对齐 Legado AnalyzeRule.ajax 只返回 body）。
   */
  applyAjaxBodyToChainContext(body: unknown): void {
    if (this.chainItemContext !== undefined) {
      this.chainItemContext = body;
    }
  }

  setRedirectUrl(url: string): this {
    this.redirectUrl = url || this.baseUrl;
    return this;
  }

  setRequestContext(ruleUrl: string, requestUrl: string): this {
    this.ruleUrlCtx = ruleUrl;
    this.requestUrlCtx = requestUrl;
    return this;
  }

  setBook(book: Record<string, unknown>): this {
    const url = String(book.bookUrl ?? "").trim();
    const raw = book.variable;
    const isEmptyObj =
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      Object.keys(raw as Record<string, unknown>).length === 0;
    if (url && (raw == null || raw === "" || isEmptyObj)) {
      const persisted = getBookCustomVariable(url);
      book.variable = persisted || null;
    }
    this.book = book;
    return this;
  }

  setChapter(chapter: Record<string, unknown>): this {
    this.chapter = chapter;
    return this;
  }

  setNextChapterUrl(url: string | undefined | null): this {
    this.nextChapterUrl = String(url ?? "").trim();
    return this;
  }

  /**
   * 对齐 Legado `AnalyzeRule.evalJS`（购买 `payAction`、自定义脚本等）。
   * 与规则链 `evalRuleJs` 不同：不回退整页正文，错误向上抛出。
   */
  async evalJS(jsStr: string, result: unknown = null): Promise<unknown> {
    const script = stripLegadoJsRuleMarkers(jsStr);
    const title =
      this.chapter && typeof this.chapter.title === "string"
        ? this.chapter.title
        : "";
    const prefixes: string[] = [`var title=${JSON.stringify(title)};`];
    if (this.nextChapterUrl) {
      prefixes.push(
        `var nextChapterUrl=${JSON.stringify(this.nextChapterUrl)};`,
      );
    }
    return await evalJsAsync(
      `${prefixes.join("\n")}\n${script}`,
      this.buildJsEvalContext(result),
    );
  }

  setRuleData(data: RuleData): this {
    this.ruleData = data;
    return this;
  }

  get currentContent(): unknown {
    return this.content;
  }

  get currentBaseUrl(): string {
    return this.baseUrl;
  }

  get sourceRecord(): BookSourceRecord | undefined {
    return this.source;
  }

  get bookRecord(): Record<string, unknown> | undefined {
    return this.book;
  }

  get chapterRecord(): Record<string, unknown> | undefined {
    return this.chapter;
  }

  get extensionHost(): JsExtensionHost {
    return this.host;
  }

  /** 搜索/发现/目录等通用规则解析（不含详情页 {{}} 复合模板） */
  async getPlainString(
    rule: string | undefined | null,
    mContent?: unknown,
  ): Promise<string> {
    const normalized = trimLegadoRulePreservingRegexReplace(rule ?? "");
    if (normalized && isTagListTextRule(normalized)) {
      const content = mContent ?? this.content;
      const html = typeof content === "string" ? content : String(content ?? "");
      const { regex } = splitRuleRegexSuffix(normalized);
      let tags = "";
      if (isTagListContainerTextRule(normalized)) {
        tags = tagListContainerTextFromHtml(html);
      } else {
        const tagRule = normalizeTagListTextRule(normalized) ?? normalized;
        tags = legadoJoinResultTexts(legadoCollectResultTexts(html, tagRule)).trim();
        if (!tags) tags = extractTagListLabelsFromHtml(html).trim();
      }
      if (tags) {
        return regex ? this.applyRuleRegex(tags, regex).trim() : tags;
      }
    }
    return this.getString(rule, mContent);
  }

  lookupStored(key: string): string {
    return this.lookupStoredValue(key);
  }

  buildRuleJavaBindings(ruleContext?: unknown): Record<string, unknown> {
    return this.buildRuleJava(ruleContext);
  }

  async applyPutMapFromRule(rule: string, content: unknown): Promise<void> {
    const { putMap } = parsePutMapFromRule(rule);
    for (const [key, fieldRule] of Object.entries(putMap)) {
      const val = isPlainRuleObject(content)
        ? readJsonField(content, fieldRule)
        : await this.getString(fieldRule, content);
      this.putStored(key, val);
    }
  }

  private async evalPutMap(
    putMap: Record<string, string>,
    mContent?: unknown,
  ): Promise<void> {
    for (const [key, fieldRule] of Object.entries(putMap)) {
      const { baseRule, regex } = splitRuleRegexSuffix(fieldRule);
      const { working: normalized } = await this.normalizeRuleInput(baseRule, mContent);
      let s = await this.getStringChain(normalized, mContent);
      if (s && regex) s = this.applyRuleRegex(s, regex);
      this.putStored(key, s);
    }
  }

  /** Legado splitPutRule + putRule：getOne/getElement 前先执行 @put */
  private async applyPutPrefixRule(
    rule: string,
    content: unknown,
  ): Promise<{ rule: string; content: unknown }> {
    const { cleanRule, putMap } = parsePutMapFromRule(rule);
    if (Object.keys(putMap).length > 0) {
      await this.evalPutMap(putMap, content);
    }
    return { rule: cleanRule.trim(), content };
  }

  private evalPutMapSync(
    putMap: Record<string, string>,
    mContent?: unknown,
  ): void {
    for (const [key, fieldRule] of Object.entries(putMap)) {
      const { baseRule, regex } = splitRuleRegexSuffix(fieldRule);
      let s = this.getStringChainSync(baseRule, mContent);
      if (s && regex) s = this.applyRuleRegex(s, regex);
      this.putStored(key, s);
    }
  }

  private applyPutPrefixRuleSync(
    rule: string,
    content: unknown,
  ): { rule: string; content: unknown } {
    const { cleanRule, putMap } = parsePutMapFromRule(rule);
    if (Object.keys(putMap).length > 0) {
      this.evalPutMapSync(putMap, content);
    }
    return { rule: cleanRule.trim(), content };
  }

  private async normalizeRuleInput(
    rule: string,
    mContent?: unknown,
  ): Promise<{ working: string; pureGet: boolean }> {
    const { cleanRule, putMap } = parsePutMapFromRule(rule);
    await this.evalPutMap(putMap, mContent);
    const getKey = parseLegadoPureGetKey(cleanRule);
    if (getKey) {
      return { working: this.lookupStoredValue(getKey), pureGet: true };
    }
    return {
      working: expandLegadoGetRefs(cleanRule, (k) => this.lookupStoredValue(k)),
      pureGet: false,
    };
  }

  private normalizeRuleInputSync(
    rule: string,
    mContent?: unknown,
  ): { working: string; pureGet: boolean } {
    const { cleanRule, putMap } = parsePutMapFromRule(rule);
    this.evalPutMapSync(putMap, mContent);
    const getKey = parseLegadoPureGetKey(cleanRule);
    if (getKey) {
      return { working: this.lookupStoredValue(getKey), pureGet: true };
    }
    return {
      working: expandLegadoGetRefs(cleanRule, (k) => this.lookupStoredValue(k)),
      pureGet: false,
    };
  }

  private async applyPutFromFullRule(
    rule: string,
    mContent?: unknown,
  ): Promise<string> {
    const normalized = trimLegadoRulePreservingRegexReplace(rule);
    const { cleanRule, putMap } = parsePutMapFromRule(normalized);
    if (Object.keys(putMap).length > 0) {
      await this.evalPutMap(putMap, mContent);
    }
    const kept = trimLegadoRulePreservingRegexReplace(cleanRule);
    return kept || normalized;
  }

  private applyPutFromFullRuleSync(rule: string, mContent?: unknown): string {
    const normalized = trimLegadoRulePreservingRegexReplace(rule);
    const { cleanRule, putMap } = parsePutMapFromRule(normalized);
    if (Object.keys(putMap).length > 0) {
      this.evalPutMapSync(putMap, mContent);
    }
    const kept = trimLegadoRulePreservingRegexReplace(cleanRule);
    return kept || normalized;
  }

  async getString(rule: string | undefined | null, mContent?: unknown): Promise<string> {
    if (!rule?.trim()) return "";
    const parseRule = await this.applyPutFromFullRule(rule, mContent);
    // 对齐 Legado：先按 @js/<js> 切段，再对各段做 ##（勿先拆 ## 以免把 @js 吃进 replacement）
    if (/(?:@js:|<js>|@webjs:)/i.test(parseRule)) {
      return this.finalizeLegadoGetString(await this.getStringChain(parseRule, mContent));
    }
    // ## 作用于整条 a||b||c；须先拆 ## 再按 || 取首个非空
    const { baseRule: orBase, regex: orRegex } = splitRuleRegexSuffix(parseRule);
    if (shouldSplitOrAlternatives(orBase)) {
      for (const alt of orBase.split("||").map((s) => s.trim()).filter(Boolean)) {
        let v = await this.getString(alt, mContent);
        if (v) {
          if (orRegex) v = this.applyRuleRegex(v, orRegex);
          return this.finalizeLegadoGetString(v);
        }
      }
      return "";
    }
    const { baseRule, regex } = splitRuleRegexSuffix(parseRule);
    // 对齐 Legado：rule 为空且有 replaceRegex 时跳过 JSoup，对 content.toString()（outerHtml）做替换
    if (!baseRule.trim() && regex) {
      const src = legadoContentToReplaceSource(mContent ?? this.content);
      return this.finalizeLegadoGetString(this.applyRuleRegex(src, regex));
    }
    let { working, pureGet } = await this.normalizeRuleInput(baseRule, mContent);
    if (pureGet) {
      let s = working;
      if (regex) s = this.applyRuleRegex(s, regex);
      return this.finalizeLegadoGetString(s);
    }
    /**
     * 纯模板须在展开前判定并直接返回。
     * 若先 expand 再判，`<p>{{$.data.Content[0].Content}}</p>` 会变成 `<p>正文</p>`，
     * 在 JSON 页上被 detectMode 当成 JsonPath，正文变空。
     */
    if (isLegadoTemplateOnlyRule(working)) {
      let expanded = this.expandAllTemplateExprs(
        working,
        mContent ?? this.content,
      );
      if (expanded.includes("{$.")) {
        expanded = expandBraceJsonPathRule(
          expanded,
          mContent ?? this.content,
        );
      }
      // 对齐 Legado makeUpRule：套外层 ## 前 trim（见 getStringList / 部分书源「完结」tag）
      if (regex) expanded = this.applyRuleRegex(expanded.trim(), regex);
      return this.finalizeLegadoGetString(expanded);
    }
    // @put/@get 拼出的 https://…/book/id.html：勿再当 JsonPath
    // 仍含 {{ }} 时先 makeUpRule（`$..docId##.*_` 等），再判断是否字面 URL
    const ruleBeforeExpand = working;
    if (working.includes("{{") || working.includes("{$")) {
      working = this.expandAllTemplateExprs(
        working,
        mContent ?? this.content,
      );
    }
    // 单花括号 `{$.book_id}`（部分 tocUrl）；须在字面 URL 判断前展开
    if (working.includes("{$.")) {
      working = expandBraceJsonPathRule(
        working,
        mContent ?? this.content,
      );
    }
    // 仅在 `{$.}`/`{{` 实际展开后：剥残留 `@JSon:` 当字面量（部分书源章名）；勿拦截裸字段 `name`
    if (working !== ruleBeforeExpand) {
      const literal = asLiteralAfterJsonBraceExpand(working);
      if (literal != null) {
        let s = literal;
        if (regex) s = this.applyRuleRegex(s, regex);
        return this.finalizeLegadoGetString(s);
      }
    }
    if (isLegadoLiteralUrlRule(working)) {
      let s = working.trim();
      if (regex) s = this.applyRuleRegex(s, regex);
      return this.finalizeLegadoGetString(s);
    }
    const jsonCompound = await this.resolveJsonCompoundString(working, mContent, regex);
    if (jsonCompound != null) return this.finalizeLegadoGetString(jsonCompound);
    let s = await this.getStringChain(working, mContent);
    // 对齐 Legado：JSoup getString 未命中返回 null 时不执行 replaceRegex
    if (regex && s) s = this.applyRuleRegex(s, regex);
    return this.finalizeLegadoGetString(s);
  }

  /** Legado/Rhino：规则 JS / `{{@@…}}` 嵌套规则展开用的同步 getString */
  getStringSync(rule: string | undefined | null, mContent?: unknown): string {
    if (!rule?.trim()) return "";
    const parseRule = this.applyPutFromFullRuleSync(rule, mContent);
    if (/(?:@js:|<js>|@webjs:)/i.test(parseRule)) {
      return this.finalizeLegadoGetString(this.getStringChainSync(parseRule, mContent));
    }
    const { baseRule: orBase, regex: orRegex } = splitRuleRegexSuffix(parseRule);
    if (shouldSplitOrAlternatives(orBase)) {
      for (const alt of orBase.split("||").map((s) => s.trim()).filter(Boolean)) {
        let v = this.getStringSync(alt, mContent);
        if (v) {
          if (orRegex) v = this.applyRuleRegex(v, orRegex);
          return this.finalizeLegadoGetString(v);
        }
      }
      return "";
    }
    const { baseRule, regex } = splitRuleRegexSuffix(parseRule);
    // 对齐 Legado：rule 为空且有 replaceRegex 时跳过 JSoup，对 content.toString()（outerHtml）做替换
    if (!baseRule.trim() && regex) {
      const src = legadoContentToReplaceSource(mContent ?? this.content);
      return this.finalizeLegadoGetString(this.applyRuleRegex(src, regex));
    }
    let { working, pureGet } = this.normalizeRuleInputSync(baseRule, mContent);
    if (pureGet) {
      let s = working;
      if (regex) s = this.applyRuleRegex(s, regex);
      return this.finalizeLegadoGetString(s);
    }
    if (isLegadoTemplateOnlyRule(working)) {
      let expanded = this.expandAllTemplateExprs(
        working,
        mContent ?? this.content,
      );
      if (expanded.includes("{$.")) {
        expanded = expandBraceJsonPathRule(
          expanded,
          mContent ?? this.content,
        );
      }
      // 对齐 Legado makeUpRule：套外层 ## 前 trim（见 getStringList / 部分书源「完结」tag）
      if (regex) expanded = this.applyRuleRegex(expanded.trim(), regex);
      return this.finalizeLegadoGetString(expanded);
    }
    const ruleBeforeExpand = working;
    if (working.includes("{{") || working.includes("{$")) {
      working = this.expandAllTemplateExprs(
        working,
        mContent ?? this.content,
      );
    }
    // 单花括号 `{$.book_id}`（部分 tocUrl）；须在字面 URL 判断前展开
    if (working.includes("{$.")) {
      working = expandBraceJsonPathRule(
        working,
        mContent ?? this.content,
      );
    }
    if (working !== ruleBeforeExpand) {
      const literal = asLiteralAfterJsonBraceExpand(working);
      if (literal != null) {
        let s = literal;
        if (regex) s = this.applyRuleRegex(s, regex);
        return this.finalizeLegadoGetString(s);
      }
    }
    if (isLegadoLiteralUrlRule(working)) {
      let s = working.trim();
      if (regex) s = this.applyRuleRegex(s, regex);
      return this.finalizeLegadoGetString(s);
    }
    const jsonCompound = this.resolveJsonCompoundStringSync(working, mContent, regex);
    if (jsonCompound != null) return this.finalizeLegadoGetString(jsonCompound);
    let s = this.getStringChainSync(working, mContent);
    // 对齐 Legado：未命中时不执行 replaceRegex
    if (regex && s) s = this.applyRuleRegex(s, regex);
    return this.finalizeLegadoGetString(s);
  }

  /** Legado getStringList：&& 分段取多个 tag，|| 取首个非空段 */
  async getStringList(
    rule: string | undefined | null,
    mContent?: unknown,
  ): Promise<string[]> {
    if (!rule?.trim()) return [];
    const content = mContent ?? this.content;
    const parseRule = await this.applyPutFromFullRule(rule, content);
    // 对齐 Legado：含 @js 时整条走规则链（段内 ## 由 getOne 处理）
    if (/(?:@js:|<js>|@webjs:)/i.test(parseRule)) {
      const prevChain = this.chainItemContext;
      this.chainItemContext = content;
      try {
        const rules = splitSourceRule(parseRule);
        let result: unknown = content;
        for (const r of rules) {
          result = await this.evalStringChainSegment(r, result);
        }
        if (Array.isArray(result)) {
          return result
            .flatMap((v) => {
              if (v == null) return [];
              if (Array.isArray(v)) {
                return v.map((x) => String(x ?? "").trim()).filter(Boolean);
              }
              const s = String(v).trim();
              return s ? [s] : [];
            })
            .filter(Boolean);
        }
        const s = coerceLegadoRuleString(result);
        return s ? splitStringListLines(s) : [];
      } finally {
        this.chainItemContext = prevChain;
      }
    }

    if (shouldSplitOrAlternatives(parseRule)) {
      for (const alt of parseRule.split("||").map((s) => s.trim()).filter(Boolean)) {
        const list = await this.getStringList(alt, content);
        if (list.length) return list;
      }
      return [];
    }

    const { baseRule, regex } = splitRuleRegexSuffix(parseRule);

    // 对齐 Legado：纯 ## 规则对 content.toString()（outerHtml）替换
    if (!baseRule.trim() && regex) {
      const src = legadoContentToReplaceSource(content);
      const v = this.applyRuleRegex(src, regex).trim();
      return v ? splitStringListLines(v) : [];
    }

    if (isLegadoTemplateOnlyRule(baseRule)) {
      const s = this.expandAllTemplateExprs(baseRule, content).trim();
      const v = regex ? this.applyRuleRegex(s, regex) : s;
      return v ? splitStringListLines(v) : [];
    }

    const { parts, joiner } = splitLegadoCompoundRule(baseRule);
    if (parts.length > 1) {
      const out: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        if (joiner === "||") {
          const seg = await this.getStringList(part, content);
          if (seg.length) {
            out.push(...seg);
            break;
          }
          continue;
        }
        const seg = await this.getStringList(part, content);
        if (joiner === "&&" && regex && i === parts.length - 1) {
          out.push(
            ...seg
              .map((s) => this.applyRuleRegex(s, regex).trim())
              .filter(Boolean),
          );
        } else {
          out.push(...seg);
        }
      }
      if (!out.length) return [];
      return out;
    }

    const multi = this.byLegadoDefaultExtractAll(baseRule, content);
    if (multi.length) {
      return multi
        .map((s) => (regex ? this.applyRuleRegex(s, regex) : s))
        .filter(Boolean);
    }

    if (isJsonItemContent(content)) {
      const jsonList = jsonPathToLegadoStringList(baseRule, content);
      if (jsonList.length) {
        return jsonList
          .map((s) => (regex ? this.applyRuleRegex(s, regex).trim() : s.trim()))
          .filter(Boolean);
      }
    }

    const s = await this.getStringChain(baseRule, content);
    if (!s) return [];
    const v = regex ? this.applyRuleRegex(s, regex) : s;
    return splitStringListLines(v);
  }

  /** Legado/Rhino：规则 JS 中 java.getStringList 为同步 API */
  getStringListSync(
    rule: string | undefined | null,
    mContent?: unknown,
  ): string[] {
    if (!rule?.trim()) return [];
    const content = mContent ?? this.content;
    const parseRule = this.applyPutFromFullRuleSync(rule, content);
    if (/(?:@js:|<js>|@webjs:)/i.test(parseRule)) {
      const prevChain = this.chainItemContext;
      this.chainItemContext = content;
      try {
        const rules = splitSourceRule(parseRule);
        let result: unknown = content;
        for (const r of rules) {
          result = this.evalStringChainSegmentSync(r, result);
        }
        if (Array.isArray(result)) {
          return result
            .flatMap((v) => {
              if (v == null) return [];
              if (Array.isArray(v)) {
                return v.map((x) => String(x ?? "").trim()).filter(Boolean);
              }
              const s = String(v).trim();
              return s ? [s] : [];
            })
            .filter(Boolean);
        }
        const s = coerceLegadoRuleString(result);
        return s ? splitStringListLines(s) : [];
      } finally {
        this.chainItemContext = prevChain;
      }
    }

    if (shouldSplitOrAlternatives(parseRule)) {
      for (const alt of parseRule.split("||").map((s) => s.trim()).filter(Boolean)) {
        const list = this.getStringListSync(alt, content);
        if (list.length) return list;
      }
      return [];
    }

    const { baseRule, regex } = splitRuleRegexSuffix(parseRule);

    // 对齐 Legado：纯 ## 规则对 content.toString()（outerHtml）替换
    if (!baseRule.trim() && regex) {
      const src = legadoContentToReplaceSource(content);
      const v = this.applyRuleRegex(src, regex).trim();
      return v ? splitStringListLines(v) : [];
    }

    if (isLegadoTemplateOnlyRule(baseRule)) {
      const s = this.expandAllTemplateExprs(baseRule, content).trim();
      const v = regex ? this.applyRuleRegex(s, regex) : s;
      return v ? splitStringListLines(v) : [];
    }

    const { parts, joiner } = splitLegadoCompoundRule(baseRule);
    if (parts.length > 1) {
      const out: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        if (joiner === "||") {
          const seg = this.getStringListSync(part, content);
          if (seg.length) {
            out.push(...seg);
            break;
          }
          continue;
        }
        const seg = this.getStringListSync(part, content);
        if (joiner === "&&" && regex && i === parts.length - 1) {
          out.push(
            ...seg
              .map((s) => this.applyRuleRegex(s, regex).trim())
              .filter(Boolean),
          );
        } else {
          out.push(...seg);
        }
      }
      if (!out.length) return [];
      return out;
    }

    const multi = this.byLegadoDefaultExtractAll(baseRule, content);
    if (multi.length) {
      return multi
        .map((s) => (regex ? this.applyRuleRegex(s, regex) : s))
        .filter(Boolean);
    }

    if (isJsonItemContent(content)) {
      const jsonList = jsonPathToLegadoStringList(baseRule, content);
      if (jsonList.length) {
        return jsonList
          .map((s) => (regex ? this.applyRuleRegex(s, regex).trim() : s.trim()))
          .filter(Boolean);
      }
    }

    const s = this.getStringChainSync(baseRule, content);
    if (!s) return [];
    const v = regex ? this.applyRuleRegex(s, regex) : s;
    return splitStringListLines(v);
  }

  private async evalStringChainSegment(
    segment: string,
    content: unknown,
  ): Promise<unknown> {
    const t = segment.trim();
    if (!t.includes("||") || /^@js:/i.test(t) || /^<js>/i.test(t)) {
      return this.getOne(t, content);
    }
    const outsideTemplate = t.replace(/\{\{[\s\S]*?\}\}/g, "");
    if (!outsideTemplate.includes("||")) {
      return this.getOne(t, content);
    }
    for (const alt of t.split("||").map((s) => s.trim()).filter(Boolean)) {
      const v = await this.getOne(alt, content);
      if (v != null && v !== "") return v;
    }
    return "";
  }

  private evalStringChainSegmentSync(segment: string, content: unknown): unknown {
    const t = segment.trim();
    if (!t.includes("||") || /^@js:/i.test(t) || /^<js>/i.test(t)) {
      return this.getOneSync(t, content);
    }
    const outsideTemplate = t.replace(/\{\{[\s\S]*?\}\}/g, "");
    if (!outsideTemplate.includes("||")) {
      return this.getOneSync(t, content);
    }
    for (const alt of t.split("||").map((s) => s.trim()).filter(Boolean)) {
      const v = this.getOneSync(alt, content);
      if (v != null && v !== "") return v;
    }
    return "";
  }

  private async getStringChain(
    rule: string,
    mContent?: unknown,
  ): Promise<string> {
    const prevChain = this.chainItemContext;
    this.chainItemContext = mContent ?? this.content;
    try {
      const rules = splitSourceRule(rule);
      let result: unknown = mContent ?? this.content;
      // 空串不打断：后续 @js 可用 baseUrl 兜底
      for (const r of rules) {
        result = await this.evalStringChainSegment(r, result);
      }
      return coerceLegadoRuleString(result);
    } finally {
      this.chainItemContext = prevChain;
    }
  }

  private getStringChainSync(rule: string, mContent?: unknown): string {
    const prevChain = this.chainItemContext;
    this.chainItemContext = mContent ?? this.content;
    try {
      const rules = splitSourceRule(rule);
      let result: unknown = mContent ?? this.content;
      for (const r of rules) {
        result = this.evalStringChainSegmentSync(r, result);
      }
      return coerceLegadoRuleString(result);
    } finally {
      this.chainItemContext = prevChain;
    }
  }

  async getElements(rule: string | undefined | null, mContent?: unknown): Promise<unknown[]> {
    if (!rule?.trim()) return [];
    if (shouldSplitOrAlternatives(rule)) {
      for (const alt of rule.split("||").map((s) => s.trim()).filter(Boolean)) {
        const els = await this.getElements(alt, mContent);
        if (els.length) return els;
      }
      return [];
    }
    const rules = splitSourceRule(rule);
    let result: unknown = mContent ?? this.content;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i]!;
      const nextIsJs =
        i + 1 < rules.length && isLegadoJsRule(rules[i + 1]!);
      result = await this.getOne(r, result, true);
      if (
        !nextIsJs &&
        (result == null ||
          result === "" ||
          (Array.isArray(result) && result.length === 0))
      ) {
        break;
      }
    }
    if (Array.isArray(result)) return result;
    // 规则 JS 若仍返回带 toArray 的 List 包装（非 Array），须展开为元素列表
    // （否则 bookList `@js: …; return a` 会把整表当成 1 条，发现列表为空）
    if (result != null && typeof result === "object") {
      const toArray = (result as { toArray?: unknown }).toArray;
      if (typeof toArray === "function") {
        try {
          const arr = (toArray as () => unknown).call(result);
          if (Array.isArray(arr)) return arr;
        } catch {
          /* ignore */
        }
      }
    }
    if (result == null || result === "") return [];
    return [result];
  }

  /** Legado/Rhino：规则 JS 中 java.getElements 为同步 API */
  getElementsSync(rule: string | undefined | null, mContent?: unknown): unknown[] {
    if (!rule?.trim()) return [];
    if (shouldSplitOrAlternatives(rule)) {
      for (const alt of rule.split("||").map((s) => s.trim()).filter(Boolean)) {
        const els = this.getElementsSync(alt, mContent);
        if (els.length) return els;
      }
      return [];
    }
    const rules = splitSourceRule(rule);
    let result: unknown = mContent ?? this.content;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i]!;
      const nextIsJs =
        i + 1 < rules.length && isLegadoJsRule(rules[i + 1]!);
      result = this.getOneSync(r, result, true);
      if (
        !nextIsJs &&
        (result == null ||
          result === "" ||
          (Array.isArray(result) && result.length === 0))
      ) {
        break;
      }
    }
    if (Array.isArray(result)) return result;
    if (result != null && typeof result === "object") {
      const toArray = (result as { toArray?: unknown }).toArray;
      if (typeof toArray === "function") {
        try {
          const arr = (toArray as () => unknown).call(result);
          if (Array.isArray(arr)) return arr;
        } catch {
          /* ignore */
        }
      }
    }
    if (result == null || result === "") return [];
    return [result];
  }

  /** Legado 规则 JS：java.getElement(selector) — 返回 Elements（可 .text/.attr）或 JSON 对象 */
  getElementForJs(ruleStr: string): unknown {
    try {
      const sel = ruleStr.trim();
      if (!sel) return asLegadoJavaGetElementResult([]);
      const content = this.content;
      const toList = (out: unknown): unknown[] => {
        if (Array.isArray(out)) return out;
        if (out == null || out === "") return [];
        return [out];
      };
      // setContent(JSON) 后不可 String(obj)→"[object Object]"（书单推荐 ge('$.book.docs')）
      if (
        this.contentIsJson ||
        isPlainRuleObject(content) ||
        Array.isArray(content)
      ) {
        return asLegadoJavaGetElementResult(
          toList(this.byJsonPath(sel, content, true)),
        );
      }
      if (typeof content === "string") {
        const t = content.trim();
        if (t.startsWith("{") || t.startsWith("[")) {
          try {
            const parsed = JSON.parse(t) as unknown;
            return asLegadoJavaGetElementResult(
              toList(this.byJsonPath(sel, parsed, true)),
            );
          } catch {
            /* 非整段 JSON，走 HTML */
          }
        }
      }
      const html = String(content ?? "");
      return asLegadoJavaGetElementResult(
        toList(this.byLegadoDefault(sel, html, true)),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.host.log(`getElement 规则错误: ${msg}`);
      return asLegadoJavaGetElementResult([]);
    }
  }

  async getElement(
    rule: string | undefined | null,
    mContent?: unknown,
  ): Promise<unknown> {
    if (!rule?.trim()) return null;
    const rules = splitSourceRule(rule);
    let result: unknown = mContent ?? this.content;
    for (const r of rules) {
      result = await this.getOne(r, result);
      if (result == null || result === "") return null;
    }
    return result;
  }

  private readBookVariable(key: string): string {
    if (!this.book) return "";
    const raw = this.book.variable;
    if (typeof raw === "string") {
      if (key === "custom") return raw;
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const v = parsed[key];
        if (typeof v === "string" && v) return v;
      } catch {
        return "";
      }
      return "";
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === "string" && v) return v;
    }
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const v = parsed[key];
        if (typeof v === "string" && v) return v;
      } catch {
        /* ignore invalid book.variable JSON */
      }
    }
    return "";
  }

  private lookupStoredValue(key: string): string {
    // 对齐 Legado AnalyzeRule.get：chapter → book → ruleData → source
    const fromChapter = this.readChapterVariable(key);
    if (fromChapter) return fromChapter;
    const fromBook = this.readBookVariable(key);
    if (fromBook) return fromBook;
    const vars = this.ruleData.variable ?? {};
    if (vars[key]) return vars[key]!;
    const sourceUrl = this.source?.bookSourceUrl;
    if (sourceUrl) {
      const cached = getCacheValue(
        sourceUrl,
        sourceVariableCacheKey(sourceUrl, key),
      );
      if (cached) return cached;
    }
    const fromLogin = this.host.sourceWrapper.getLoginInfo as
      | (() => Record<string, string>)
      | undefined;
    const login = fromLogin?.() ?? {};
    if (login[key]) return login[key]!;
    // 须在 cache / put 之后：否则 java.put('url', tocUrl) 会被 baseUrl 盖掉，nextTocUrl 无法分页
    if (key === "url") return this.requestUrlCtx || this.baseUrl;
    if (key === "bookName" && this.book?.name) return String(this.book.name);
    if (key === "title" && this.chapter?.title) return String(this.chapter.title);
    return "";
  }

  getStored(key: string): string {
    return this.lookupStoredValue(key);
  }

  /** Legado makeUpRule：{{title}} / {{chapter.title}} / {{book.name}} 等绑定变量 */
  expandLegadoTemplateKey(expr: string): string {
    return this.expandRegexTemplateExpr(expr.trim());
  }

  /** 展开 ## 替换段中的 {{title}} / {{book.name}} 等（对齐 Legado SourceRule.makeUpRule） */
  private expandRuleRegexTemplates(regex: RuleRegexSuffix): RuleRegexSuffix {
    const expand = (text: string): string =>
      text
        .replace(/\{\{([\s\S]*?)\}\}/g, (_, expr: string) =>
          this.expandRegexTemplateExpr(String(expr).trim()),
        )
        .replace(/@get:\{([^}]+)\}/gi, (_, key: string) =>
          this.getStored(String(key).trim()),
        );
    return {
      pattern: expand(regex.pattern),
      replacement: expand(regex.replacement ?? ""),
      replaceFirst: regex.replaceFirst,
    };
  }

  private expandRegexTemplateExpr(expr: string): string {
    if (!expr) return "";
    if (expr === "title" || expr === "chapter.title") {
      return String(this.chapter?.title ?? this.getStored("title"));
    }
    if (expr === "bookName" || expr === "book.name") {
      return this.getStored("bookName") || String(this.book?.name ?? "");
    }
    if (expr === "book.author") return String(this.book?.author ?? "");
    if (expr === "result") return String(this.content ?? "");
    return this.getStored(expr);
  }

  /** ##正则##替换：先展开 {{}} 再应用 */
  private applyRuleRegex(value: string, regex?: RuleRegexSuffix): string {
    if (!regex?.pattern) return value;
    return applyRuleRegexImpl(value, this.expandRuleRegexTemplates(regex));
  }

  /**
   * 对齐 Legado AnalyzeRule.put：chapter → book → ruleData → source（有实体时不写书源 cache）。
   * 规则链仍镜像到 ruleData，供 getStoredVariables 随搜索项带走（避免只进 book 丢快照）。
   */
  putStored(key: string, value: unknown): string {
    const s = String(value ?? "");
    if (!this.ruleData.variable) this.ruleData.variable = {};
    this.ruleData.variable[key] = s;
    if (this.chapter) {
      this.writeEntityVariable(this.chapter, key, s);
      return s;
    }
    if (this.book) {
      if (key === "custom") {
        this.book.variable = s;
      } else {
        this.writeEntityVariable(this.book, key, s);
      }
      return s;
    }
    (this.host.javaBindings.put as ((k: string, v: unknown) => string) | undefined)?.(
      key,
      s,
    );
    return s;
  }

  /** 当前规则链 @put / java.put 写入的变量快照（供搜索项带入 Book.variable） */
  getStoredVariables(): Record<string, string> {
    const out: Record<string, string> = { ...(this.ruleData.variable ?? {}) };
    const mergeObj = (raw: unknown) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === "string" && v) out[k] = v;
      }
    };
    mergeObj(this.book?.variable);
    mergeObj(this.chapter?.variable);
    return out;
  }

  private writeEntityVariable(
    target: Record<string, unknown> | undefined,
    key: string,
    value: string,
  ): void {
    if (!target) return;
    let variable = target.variable;
    if (!variable || typeof variable !== "object" || Array.isArray(variable)) {
      variable = {};
      target.variable = variable;
    }
    (variable as Record<string, string>)[key] = value;
  }

  private putBookVariable(key: string, value: string): void {
    if (!this.ruleData.variable) this.ruleData.variable = {};
    this.ruleData.variable[key] = value;
    if (!this.book) return;
    // 部分书源等：整段正文存在 variable 字符串里
    if (key === "custom") {
      this.book.variable = value;
      return;
    }
    this.writeEntityVariable(this.book, key, value);
  }

  private putChapterVariable(key: string, value: string): void {
    if (!this.ruleData.variable) this.ruleData.variable = {};
    this.ruleData.variable[key] = value;
    this.writeEntityVariable(this.chapter, key, value);
  }

  private readChapterVariable(key: string): string {
    if (!this.chapter) return "";
    const raw = this.chapter.variable;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === "string" && v) return v;
    }
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const v = parsed[key];
        if (typeof v === "string" && v) return v;
      } catch {
        /* ignore */
      }
    }
    return "";
  }

  private buildJsEvalContext(content: unknown): {
    source: BookSourceRecord | undefined;
    book: Record<string, unknown> | undefined;
    chapter: Record<string, unknown> | undefined;
    result: unknown;
    src: unknown;
    baseUrl: string;
    host: JsExtensionHost;
    java: Record<string, unknown>;
    bookVariableSync: LegadoVariableSync;
    chapterVariableSync: LegadoVariableSync;
  } {
    return {
      source: this.source,
      book: this.book,
      chapter: this.chapter,
      // 部分书源：JSON.stringify(Elements) 后再解析时，字段 JS 正则依赖 \&quot; 形态
      result: bindJsHtmlValue(content),
      src: bindJsHtmlValue(this.content),
      baseUrl: this.baseUrl,
      host: this.host,
      // 对齐 Legado：java.getString 默认读 AnalyzeRule.content（src），不是链式 result
      java: this.buildRuleJava(),
      bookVariableSync: (() => {
        const bookUrl = String(this.book?.bookUrl ?? "").trim();
        if (bookUrl) return createBookVariableSync(bookUrl);
        return {
          putVariable: (key: string, value: string) =>
            this.putBookVariable(key, value),
          getVariable: (key: string) => this.readBookVariable(key),
        };
      })(),
      chapterVariableSync: {
        putVariable: (key, value) => this.putChapterVariable(key, value),
        getVariable: (key) => this.readChapterVariable(key),
      },
    };
  }

  /** JSON 上 `$.a&&$.b##regex##repl`：合并多段 JsonPath 后再做正则（如 intro 标签行） */
  private resolveJsonCompoundStringSync(
    baseRule: string,
    content: unknown,
    regex?: ReturnType<typeof splitRuleRegexSuffix>["regex"],
  ): string | null {
    if (!isJsonItemContent(content)) return null;
    // `a||b <js>strip</js>`：须走规则链，避免 || 短路后跳过 JS 再套 ##
    if (splitSourceRule(baseRule).length > 1) return null;
    const { parts, joiner } = splitLegadoCompoundRule(baseRule);
    if (parts.length <= 1) return null;

    if (joiner === "||") {
      for (const part of parts) {
        const list = this.getStringListSync(part, content);
        if (list.length) {
          // Legado AnalyzeByJSonPath.getString：List 与 && 段均用 \n 拼接，再由 ##・|\s##， 统一为全角逗号
          let s = list.join("\n");
          if (regex) s = this.applyRuleRegex(s, regex);
          return this.finalizeLegadoGetString(s);
        }
      }
      return "";
    }

    const segments: string[] = [];
    for (const part of parts) {
      const list = this.getStringListSync(part, content);
      if (list.length) segments.push(list.join("\n"));
    }
    if (!segments.length) return "";
    let s = segments.join("\n");
    if (regex) s = this.applyRuleRegex(s, regex);
    return trimLegadoAsciiWhitespace(s);
  }

  private async resolveJsonCompoundString(
    baseRule: string,
    mContent: unknown | undefined,
    regex?: ReturnType<typeof splitRuleRegexSuffix>["regex"],
  ): Promise<string | null> {
    const content = mContent ?? this.content;
    if (!isJsonItemContent(content)) return null;
    if (splitSourceRule(baseRule).length > 1) return null;
    const { parts, joiner } = splitLegadoCompoundRule(baseRule);
    if (parts.length <= 1) return null;

    if (joiner === "||") {
      for (const part of parts) {
        const list = await this.getStringList(part, content);
        if (list.length) {
          let s = list.join("\n");
          if (regex) s = this.applyRuleRegex(s, regex);
          return this.finalizeLegadoGetString(s);
        }
      }
      return "";
    }

    const segments: string[] = [];
    for (const part of parts) {
      const list = await this.getStringList(part, content);
      if (list.length) segments.push(list.join("\n"));
    }
    if (!segments.length) return "";
    let s = segments.join("\n");
    if (regex) s = this.applyRuleRegex(s, regex);
    return trimLegadoAsciiWhitespace(s);
  }

  /** 规则 JS 内 java.getString / getStringList 未传 content 时的默认上下文（列表项优先于整页） */
  private javaRuleContent(content?: unknown, ruleContext?: unknown): unknown {
    if (content !== undefined) return content;
    if (ruleContext !== undefined) return ruleContext;
    if (this.chainItemContext !== undefined) return this.chainItemContext;
    return this.content;
  }

  /**
   * 规则 JS：`java.getString(rule)` / `java.getString(rule, content)` /
   * Legado 重载 `java.getString(rule, unescape: Boolean)`（第二参为布尔时不是正文，
   * 如 部分书源 `getString("tag.div.-1@text", false)`）。
   */
  ruleJavaGetString(
    ruleStr: string,
    contentOrUnescape?: unknown,
    ruleContext?: unknown,
  ): string {
    let content: unknown = contentOrUnescape;
    let unescape = true;
    // 对齐 AnalyzeRule.getString(ruleStr, unescape: Boolean)
    if (typeof contentOrUnescape === "boolean") {
      unescape = contentOrUnescape;
      content = undefined;
    }

    let c: unknown = this.javaRuleContent(content, ruleContext);
    const rawRule = String(ruleStr ?? "").trim();
    if (!rawRule) return "";

    let out = "";
    if (typeof c === "string") {
      const t = c.trim();
      if (t.startsWith("{") || t.startsWith("[")) {
        try {
          c = JSON.parse(t);
        } catch {
          // 非整段 JSON：按 HTML/文本选择器解析（对齐 Legado AnalyzeRule.getString）
          out = this.getStringChainSync(rawRule, c);
          return this.applyJavaGetStringUnescape(out, unescape);
        }
      } else {
        // HTML 整页等：必须跑选择器，不能把正文原样返回（否则 kind 会被拆成一堆标签）
        out = this.getStringChainSync(rawRule, c);
        return this.applyJavaGetStringUnescape(out, unescape);
      }
    }

    const { baseRule, regex } = splitRuleRegexSuffix(rawRule);
    const compound = this.resolveJsonCompoundStringSync(baseRule, c, regex);
    if (compound != null) {
      return this.applyJavaGetStringUnescape(compound, unescape);
    }
    const field = baseRule.trim();
    if (field.startsWith("$.") || field.startsWith("$[")) {
      let val = jsonPathFromContent(field, c);
      if (regex) val = this.applyRuleRegex(val, regex);
      return this.applyJavaGetStringUnescape(val, unescape);
    }
    if (isPlainRuleObject(c) && /^[\w.]+$/.test(field)) {
      let val = readJsonField(c, field);
      if (regex) val = this.applyRuleRegex(val, regex);
      return this.applyJavaGetStringUnescape(val, unescape);
    }
    // 元素节点等：走与 getString 同步路径相同的选择器解析
    if (c != null && typeof c === "object") {
      out = this.getStringChainSync(rawRule, c);
      return this.applyJavaGetStringUnescape(out, unescape);
    }
    // 无可用正文时勿 String(false)→"false"（布尔已在上方按 unescape 重载处理）
    if (c == null || typeof c === "boolean") return "";
    return this.applyJavaGetStringUnescape(String(c ?? ""), unescape);
  }

  /** Legado getString：unescape 且含 `&` 时做 HTML 实体解码 */
  private applyJavaGetStringUnescape(text: string, unescape: boolean): string {
    if (!unescape || !text.includes("&")) return text;
    return unescapeLegadoHtmlEntities(text);
  }

  /** 对齐 Legado AnalyzeRule.getString 末尾 StringEscapeUtils.unescapeHtml4 */
  private finalizeLegadoGetString(s: string, unescape = true): string {
    const trimmed = trimLegadoAsciiWhitespace(s);
    return this.applyJavaGetStringUnescape(trimmed, unescape);
  }

  buildRuleJava(ruleContext?: unknown): Record<string, unknown> {
    const rule = this;
    const baseAjax = this.host.javaBindings.ajax as (
      url: unknown,
    ) => Promise<string>;
    const ctx = (content?: unknown) => rule.javaRuleContent(content, ruleContext);
    return {
      ...this.host.javaBindings,
      ruleUrl: this.ruleUrlCtx,
      url: this.requestUrlCtx || this.baseUrl,
      get: (key: string) => rule.lookupStoredValue(key),
      put: (key: string, value: unknown) => rule.putStored(key, value),
      getString: (ruleStr: string, content?: unknown) =>
        rule.ruleJavaGetString(ruleStr, content, ruleContext),
      getStringList: (ruleStr: string, content?: unknown) =>
        ensureLegadoListApi(rule.getStringListSync(ruleStr, ctx(content))),
      getElements: (ruleStr: string, content?: unknown) =>
        ensureLegadoListApi(rule.getElementsSync(ruleStr, ctx(content))),
      getElement: (sel: string) => rule.getElementForJs(sel),
      setContent: (content: unknown, baseUrl?: string) => {
        rule.setContent(content, baseUrl ?? rule.baseUrl);
        return rule;
      },
      /**
       * Legado AnalyzeRule.refreshBookUrl：
       * 返回当前详情最终 URL（redirectUrl），供 tocUrl 使用。
       * 若原 bookUrl 带 UrlOption（如搜索 POST）而新地址没有，则不覆盖 bookUrl，
       * 以免丢掉重新拉详情所需的 POST 参数（bookUrl 与 tocUrl 可指向不同地址）。
       */
      refreshBookUrl: () => {
        const url = String(
          rule.redirectUrl ||
            rule.requestUrlCtx ||
            rule.baseUrl ||
            (rule.book && typeof rule.book === "object"
              ? (rule.book as { bookUrl?: unknown }).bookUrl
              : "") ||
            "",
        ).trim();
        if (rule.book && typeof rule.book === "object" && url) {
          const prev = String(
            (rule.book as { bookUrl?: unknown }).bookUrl ?? "",
          );
          const prevHasOpt = /,\s*\{/.test(prev);
          const nextHasOpt = /,\s*\{/.test(url);
          if (!(prevHasOpt && !nextHasOpt)) {
            (rule.book as { bookUrl?: string }).bookUrl = url;
          }
        }
        return url;
      },
      /**
       * 对齐 Legado AnalyzeRule.ajax：只返回响应体，不改写 AnalyzeRule.content。
       * 规则链求值中（chainItemContext 已设）则更新链上下文，供同段 JS 内
       * 后续 `java.getString` 读到 ajax 结果（如部分书源）；勿永久 setContent，
       * 否则详情 lastChapter 里 ajax 目录后，coverUrl/tocUrl 会落在错误正文上（如部分书源）。
       */
      ajax: async (url: unknown) => {
        const body = await baseAjax(url);
        if (body != null && body !== "") {
          rule.applyAjaxBodyToChainContext(body);
        }
        return body;
      },
    };
  }

  private async getOne(rule: string, content: unknown, list = false): Promise<unknown> {
    const trimmed = trimLegadoRulePreservingRegexReplace(rule);
    if (!trimmed) return content;

    const putResolved = await this.applyPutPrefixRule(trimmed, content);
    content = putResolved.content;
    const ruleBody = putResolved.rule;
    if (!ruleBody) return content;

    const groupPick = this.applyRegexGroupRef(ruleBody, content);
    if (groupPick !== undefined) return groupPick;

    const isJsRule =
      isLegadoJsRule(ruleBody) || /^@webjs:/i.test(ruleBody.trim());
    const { baseRule, regex } = splitRuleRegexSuffix(ruleBody);
    let workRule = baseRule.trim();
    // Legado：`<js>##pat</js>` / 纯 `##pat##repl` 拆成空规则 + replaceRegex，对 content.toString()（outerHtml）替换
    if (!workRule && regex) {
      return this.applyRuleRegex(legadoContentToReplaceSource(content), regex);
    }

    // 单段内 `a||b`：首个非空（如 `$..posts[*]||$.response.items[*]`）；勿把整段当 JSONPath
    if (!isJsRule && workRule.includes("||")) {
      const { parts, joiner } = splitLegadoCompoundRule(workRule);
      if (joiner === "||" && parts.length > 1) {
        for (const part of parts) {
          const r = await this.getOne(part.trim(), content, list);
          if (list) {
            if (Array.isArray(r) && r.length) return r;
            if (r != null && r !== "" && !Array.isArray(r)) return [r];
          } else if (r != null && r !== "") {
            return regex ? this.applyRuleRegex(String(r), regex) : r;
          }
        }
        return list ? [] : "";
      }
    }

    if (isJsonItemContent(content)) {
      if (workRule.includes("{{")) {
        workRule = this.expandAllTemplateExprs(workRule, content);
      } else if (workRule.includes("{$.")) {
        workRule = expandBraceJsonPathRule(workRule, content);
      }
    } else if (workRule.includes("{{")) {
      // 链式上一段常为 number/string（如 `<js>1100000000+parseInt(result)</js>`），
      // 下一段 `https://…?bookid={{result}}` 须展开，不能只在 JSON 条目上 makeUpRule
      workRule = this.expandAllTemplateExprs(workRule, content);
    }
    // Legado AnalyzeByJSonPath：{$.} 展开后为字面量；@js/<js> 仍须执行脚本
    if (workRule !== baseRule && !isJsRule) {
      const stillNeedsParse =
        workRule.includes("{{") ||
        workRule.includes("{$") ||
        /^@js:/i.test(workRule.trim()) ||
        /^<js>/i.test(workRule.trim());
      if (!stillNeedsParse) {
        // 展开后残留的 @JSon: 须剥掉，避免「@JSon:第章」经 @js 收成「@JSon:」
        let literal = stripJsonPathRulePrefix(workRule);
        if (!list && typeof literal === "string" && regex) {
          literal = this.applyRuleRegex(literal, regex);
        }
        return literal;
      }
    }
    // @get 展开后的绝对/站内 URL：JSON 条目上勿走 JsonPath，也勿把 /book/x.html 当 XPath
    if (!list && isLegadoLiteralUrlRule(workRule)) {
      return regex ? this.applyRuleRegex(workRule, regex) : workRule;
    }
    const mode = detectMode(workRule, this.contentIsJson);
    let out: unknown;
    try {
      switch (mode) {
        case "template":
          out = this.expandAllTemplateExprs(workRule, content);
          break;
        case "js":
          out = await this.evalRuleJs(baseRule, content);
          break;
        case "webJs":
          out = await this.evalWebJsRule(baseRule, content);
          break;
        case "json":
          if (!list && isPlainRuleObject(content)) {
            const nested = readJsonNestedValue(
              content as Record<string, unknown>,
              ruleBody,
            );
            if (nested !== undefined) return nested;
            const field = readJsonField(content as Record<string, unknown>, ruleBody);
            if (field) return field;
            const path = stripJsonPathRulePrefix(workRule);
            // 仅「展开后的散文/中文」当字面量；CSS 选择器（如 og:novel meta）勿原样返回
            if (
              path &&
              !path.startsWith("$") &&
              !path.includes("{$") &&
              !/^[\w.[\]]+$/.test(path) &&
              !/[@"'=<>\/#[\]]/.test(path) &&
              !/^https?:/i.test(path)
            ) {
              return regex ? this.applyRuleRegex(path, regex) : path;
            }
            const fb = jsonPathWithLegacyResponseFallback(path, content);
            if (fb) return fb;
            return "";
          }
          out = this.byJsonPath(workRule, content, list);
          break;
        case "xpath":
          out = this.byXPath(
            stripPrefix(workRule, ["@XPath:", "@xpath:"]),
            content,
            list,
          );
          break;
        case "regex":
          out = this.byLegadoRegex(workRule, content, list);
          break;
        default: {
          const jsonField = tryJsonFieldRule(workRule, content);
          if (jsonField != null) {
            out = jsonField;
          } else if (
            workRule !== baseRule &&
            isJsonItemContent(content) &&
            !workRule.includes("@") &&
            !workRule.startsWith("$.") &&
            !workRule.startsWith("/") &&
            !workRule.startsWith(":")
          ) {
            out = workRule;
          } else {
            out = this.byLegadoDefault(workRule, content, list);
          }
          break;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const selectorMisparse =
        msg.includes("Unmatched selector") || msg.includes("Empty sub-selector");
      if (
        !isVerificationCancelled(e) &&
        (selectorMisparse || (mode === "default" && looksLikeLegadoJs(workRule)))
      ) {
        out = await this.evalRuleJs(wrapLegadoJsRule(baseRule), content);
      } else {
        throw e;
      }
    }
    if (!list && typeof out === "string" && regex) {
      return this.applyRuleRegex(out, regex);
    }
    return out;
  }

  /** Legado/Rhino 规则 JS 内 getOne 须同步阻塞（与 java.getStringList 一致） */
  private getOneSync(rule: string, content: unknown, list = false): unknown {
    const trimmed = trimLegadoRulePreservingRegexReplace(rule);
    if (!trimmed) return content;

    const putResolved = this.applyPutPrefixRuleSync(trimmed, content);
    content = putResolved.content;
    const ruleBody = putResolved.rule;
    if (!ruleBody) return content;

    const groupPick = this.applyRegexGroupRef(ruleBody, content);
    if (groupPick !== undefined) return groupPick;

    const isJsRule =
      isLegadoJsRule(ruleBody) || /^@webjs:/i.test(ruleBody.trim());
    const { baseRule, regex } = splitRuleRegexSuffix(ruleBody);
    let workRule = baseRule.trim();
    if (!workRule && regex) {
      return this.applyRuleRegex(legadoContentToReplaceSource(content), regex);
    }
    if (!isJsRule && workRule.includes("||")) {
      const { parts, joiner } = splitLegadoCompoundRule(workRule);
      if (joiner === "||" && parts.length > 1) {
        for (const part of parts) {
          const r = this.getOneSync(part.trim(), content, list);
          if (list) {
            if (Array.isArray(r) && r.length) return r;
            if (r != null && r !== "" && !Array.isArray(r)) return [r];
          } else if (r != null && r !== "") {
            return regex ? this.applyRuleRegex(String(r), regex) : r;
          }
        }
        return list ? [] : "";
      }
    }
    if (isJsonItemContent(content)) {
      if (workRule.includes("{{")) {
        workRule = this.expandAllTemplateExprs(workRule, content);
      } else if (workRule.includes("{$.")) {
        workRule = expandBraceJsonPathRule(workRule, content);
      }
    } else if (workRule.includes("{{")) {
      workRule = this.expandAllTemplateExprs(workRule, content);
    }
    if (workRule !== baseRule && !isJsRule) {
      const stillNeedsParse =
        workRule.includes("{{") ||
        workRule.includes("{$") ||
        /^@js:/i.test(workRule.trim()) ||
        /^<js>/i.test(workRule.trim());
      if (!stillNeedsParse) {
        let literal = stripJsonPathRulePrefix(workRule);
        if (!list && typeof literal === "string" && regex) {
          literal = this.applyRuleRegex(literal, regex);
        }
        return literal;
      }
    }
    if (!list && isLegadoLiteralUrlRule(workRule)) {
      return regex ? this.applyRuleRegex(workRule, regex) : workRule;
    }
    const mode = detectMode(workRule, this.contentIsJson);
    let out: unknown;
    try {
      switch (mode) {
        case "template":
          out = this.expandAllTemplateExprs(workRule, content);
          break;
        case "js":
          out = this.evalRuleJsSync(baseRule, content);
          break;
        case "webJs":
          this.host.log("规则 JS 中 @webjs 须异步执行，同步 getStringList/getElements 无法解析");
          out = "";
          break;
        case "json":
          if (!list && isPlainRuleObject(content)) {
            const nested = readJsonNestedValue(
              content as Record<string, unknown>,
              ruleBody,
            );
            if (nested !== undefined) return nested;
            const field = readJsonField(content as Record<string, unknown>, ruleBody);
            if (field) return field;
            const path = stripJsonPathRulePrefix(workRule);
            if (
              path &&
              !path.startsWith("$") &&
              !path.includes("{$") &&
              !/^[\w.[\]]+$/.test(path) &&
              !/[@"'=<>\/#[\]]/.test(path) &&
              !/^https?:/i.test(path)
            ) {
              return regex ? this.applyRuleRegex(path, regex) : path;
            }
            const fb = jsonPathWithLegacyResponseFallback(path, content);
            if (fb) return fb;
            return "";
          }
          out = this.byJsonPath(workRule, content, list);
          break;
        case "xpath":
          out = this.byXPath(
            stripPrefix(workRule, ["@XPath:", "@xpath:"]),
            content,
            list,
          );
          break;
        case "regex":
          out = this.byLegadoRegex(workRule, content, list);
          break;
        default: {
          const jsonField = tryJsonFieldRule(workRule, content);
          if (jsonField != null) {
            out = jsonField;
          } else if (
            workRule !== baseRule &&
            isJsonItemContent(content) &&
            !workRule.includes("@") &&
            !workRule.startsWith("$.") &&
            !workRule.startsWith("/") &&
            !workRule.startsWith(":")
          ) {
            out = workRule;
          } else {
            out = this.byLegadoDefault(workRule, content, list);
          }
          break;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const selectorMisparse =
        msg.includes("Unmatched selector") || msg.includes("Empty sub-selector");
      if (
        !isVerificationCancelled(e) &&
        (selectorMisparse || (mode === "default" && looksLikeLegadoJs(workRule)))
      ) {
        out = this.evalRuleJsSync(wrapLegadoJsRule(baseRule), content);
      } else {
        throw e;
      }
    }
    if (!list && typeof out === "string" && regex) {
      return this.applyRuleRegex(out, regex);
    }
    return out;
  }

  /**
   * Legado SourceRule.splitRegex + makeUpRule：正则捕获组 List 上的 `$1`/`$2`。
   * - `$3$5$6` 纯拼接（章名）
   * - `$1@js:` / `$1<js>` / `$1##…`
   * - 嵌入式如 `https://api.example.com/chapter/content/$1`（勿当字面 URL）
   */
  private applyRegexGroupRef(rule: string, content: unknown): unknown | undefined {
    if (!Array.isArray(content)) return undefined;
    if (!/\$\d{1,2}/.test(rule)) return undefined;
    const allScalar = content.every(
      (v) =>
        v == null ||
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean",
    );
    if (!allScalar) return undefined;

    const trimmed = rule.trim();
    // `$3$5$6$7$8`：多组直接拼接（目录章名常用）
    if (/^(?:\$\d{1,2})+$/.test(trimmed)) {
      return trimmed.replace(/\$(\d{1,2})/g, (_, d) =>
        String(content[Number.parseInt(d, 10)] ?? ""),
      );
    }
    const m = trimmed.match(/^(\$\d{1,2})([\s\S]*)$/);
    if (m) {
      const idx = Number.parseInt(m[1]!.slice(1), 10);
      const val: unknown = content[idx] ?? "";
      const tail = m[2]!.trim();
      if (!tail) return val;
      if (tail.startsWith("@js:")) {
        return evalJs(tail.slice(4), {
          source: this.source,
          book: this.book,
          chapter: this.chapter,
          result: val,
          baseUrl: this.baseUrl,
          host: this.host,
        });
      }
      if (/^<js>/i.test(tail)) {
        const script = stripLegadoJsRuleMarkers(tail);
        return evalJs(script, {
          source: this.source,
          book: this.book,
          chapter: this.chapter,
          result: val,
          baseUrl: this.baseUrl,
          host: this.host,
        });
      }
      if (tail.startsWith("##")) {
        const { regex: rx } = splitRuleRegexSuffix(tail);
        return this.applyRuleRegex(String(val ?? ""), rx);
      }
      // `$1` 后接普通文本：落到下方全局替换（如极少见的 `$1/foo`）
    }

    // 对齐 Legado：任意位置 `$N` 用捕获组替换，再处理尾部 `##`
    const expanded = trimmed.replace(/\$(\d{1,2})/g, (_, d) =>
      String(content[Number.parseInt(d, 10)] ?? ""),
    );
    const { baseRule, regex: rx } = splitRuleRegexSuffix(expanded);
    const out = baseRule.trim();
    return rx ? this.applyRuleRegex(out, rx) : out;
  }

  private byLegadoRegex(rule: string, content: unknown, list: boolean): unknown {
    const text = typeof content === "string" ? content : String(content ?? "");
    const regs = parseRegexRuleList(rule);
    if (!regs.length) return list ? [] : "";
    if (list) return regexGetElements(text, regs);
    const one = regexGetElement(text, regs);
    return one ?? (list ? [] : "");
  }

  private expandRuleJsTemplates(script: string, content: unknown): string {
    return this.expandAllTemplateExprs(script, content);
  }

  /**
   * 展开 `{{…}}`：对齐 Legado SourceRule.makeUpRule —
   * - `result` / `$.…`：链式结果 / JSONPath
   * - `@`/`@@`/`$/`/`//` 开头：嵌套规则走 getString（如 `{{@@td.1@text##…}}`）
   * - 其余：Rhino 表达式
   */
  private expandAllTemplateExprs(rule: string, content: unknown): string {
    const templateContexts: unknown[] = [];
    if (isJsonItemContent(this.chainItemContext)) {
      templateContexts.push(this.chainItemContext);
    }
    if (isJsonItemContent(content)) {
      templateContexts.push(content);
    }
    if (this.content != null && this.content !== "") {
      templateContexts.push(this.content);
    }
    if (!templateContexts.length) templateContexts.push(content);

    return rule.replace(/\{\{([\s\S]*?)\}\}/g, (_, expr: string) => {
      const key = expr.trim();
      // 对齐 Legado get("bookName") / bindings.book — 勿走 evalJS（Node 沙箱常失败→空标题）
      if (
        key === "title" ||
        key === "chapter.title" ||
        key === "bookName" ||
        key === "book.name" ||
        key === "book.author"
      ) {
        return this.expandRegexTemplateExpr(key);
      }
      if (key === "result") {
        if (content == null || typeof content === "object") return "";
        if (typeof content === "number" && Number.isFinite(content)) {
          return content % 1 === 0
            ? String(Math.trunc(content))
            : String(content);
        }
        return String(content);
      }
      if (key.startsWith("$.") || key.startsWith("$..") || key.startsWith("$[") || isLegadoJsonPathExpr(key)) {
        // 须带 ## 后缀整段交给 expand（如 `$..docId##.*_` 去资源 id 前缀）
        for (const ctx of templateContexts) {
          const val = expandLegadoTemplateJsonPathExpr(key, ctx);
          if (val) return val;
        }
        const pathPart = key.split("##")[0]?.trim() ?? key;
        if (pathPart === "$.id" || pathPart.endsWith(".id")) {
          const bid =
            this.lookupStoredValue("bid") || this.lookupStoredValue("id");
          if (bid) return bid;
          const fromUrl =
            this.requestUrlCtx?.match(/[?&]id=([^&]+)/i)?.[1] ??
            this.baseUrl?.match(/[?&]id=([^&]+)/i)?.[1] ??
            "";
          if (fromUrl) return fromUrl;
        }
        return "";
      }
      // Legado isRule：嵌套选择器/JSONPath/XPath，勿当 JS eval
      if (isLegadoEmbeddedRuleExpr(key)) {
        return this.getStringSync(key, content);
      }
      try {
        const jsOut = evalJsExpression(key, {
          ...this.buildJsEvalContext(content),
        });
        if (typeof jsOut === "number" && jsOut % 1 === 0) {
          return String(Math.trunc(jsOut));
        }
        return String(jsOut ?? "");
      } catch {
        // 模板内误写 JS / `$` 未绑定时勿炸整条规则（URL 会残留 {{}}）
        return "";
      }
    });
  }

  private async evalWebJsRule(rule: string, content: unknown): Promise<string> {
    const script = stripWebJsRule(rule);
    const html =
      typeof content === "string"
        ? content
        : content == null
          ? String(this.content ?? "")
          : String(content);
    const pageUrl = this.redirectUrl || this.baseUrl || this.requestUrlCtx || "";
    try {
      return await runBackstageWebView({
        html,
        url: pageUrl,
        js: script,
        source: this.source,
        host: this.host,
        injectResult: content,
        cacheFirst: true,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.host.log(`WebJs 规则错误: ${msg}`);
      return "";
    }
  }

  private async evalRuleJs(rule: string, content: unknown): Promise<unknown> {
    let script = stripLegadoJsRuleMarkers(rule);
    const beforeExpand = script;
    script = this.expandRuleJsTemplates(script, content);
    // `{{'书名'}}` / `{{`url`}}`：expand 已是最终字面量，再 eval 会 ReferenceError / Unexpected token
    if (isPureMustacheTemplateRule(beforeExpand)) {
      return script;
    }
    // `https://…?id={{$.book_id}}`：detectMode 因 `{{` 进 js；展开后已是 URL，勿再当脚本
    if (
      isLegadoLiteralUrlRule(script) ||
      (beforeExpand.includes("{{") &&
        !isLegadoJsRule(rule) &&
        !looksLikeLegadoJs(script))
    ) {
      return script;
    }
    script = expandLegadoRegexGroupRefsInJs(script, content);
    const allowContentFallback = this.shouldEvalJsFallbackToContent(content);
    const contentBeforeEval = this.content;
    let out: unknown;
    const jsPrefix = this.nextChapterUrl
      ? `var nextChapterUrl=${JSON.stringify(this.nextChapterUrl)};\n`
      : "";
    try {
      out = await evalJsAsync(jsPrefix + script, this.buildJsEvalContext(content));
    } catch (e) {
      if (isVerificationCancelled(e)) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      this.host.log(`规则 JS 错误: ${msg}`);
      // 对齐 Legado：evalJS 异常向上抛（正文等可显示「获取正文失败」）；
      // 仅非 @js/<js> 且允许回退整页时吞掉。
      if (!isLegadoJsRule(rule) && allowContentFallback) {
        return this.content;
      }
      throw e instanceof Error ? e : new Error(msg);
    }
    if (Array.isArray(out)) {
      // 空数组是合法结果（如 nextTocUrl 无下一页）；不可回退整页正文
      return out;
    }
    if (out != null && out !== "") {
      return out;
    }
    // 显式空串是合法结果（如 id.TextContent 未命中时 result=""）。
    // 若回退整页 HTML，formatKeepImg 会把 <style> 正文化（部分书源 404 页出现 @media 等）。
    if (out === "") {
      return "";
    }
    // 部分书源在 if 外不 return，但已通过 setContent / ajax 更新正文
    const pathMatch = script.match(/path\s*=\s*['"]([^'"]+)['"]/);
    if (pathMatch) {
      try {
        return this.getElementForJs(pathMatch[1]);
      } catch {
        return [];
      }
    }
    // 仅当 JS 内 setContent 改写过正文时回退；勿把整页 HTML 当规则结果
    // （部分论坛书源：`<js>` 未 return → undefined → 读者页出现 DOCTYPE/脚本源码）
    if (allowContentFallback && this.content !== contentBeforeEval) {
      return this.content;
    }
    if (isLegadoJsRule(rule)) {
      return "";
    }
    if (allowContentFallback) {
      return this.content;
    }
    return out;
  }

  /** 规则 JS 内嵌 @js/<js> 规则：同步 eval（对齐 Legado/Rhino） */
  private evalRuleJsSync(rule: string, content: unknown): unknown {
    let script = stripLegadoJsRuleMarkers(rule);
    const beforeExpand = script;
    script = this.expandRuleJsTemplates(script, content);
    if (isPureMustacheTemplateRule(beforeExpand)) {
      return script;
    }
    if (
      isLegadoLiteralUrlRule(script) ||
      (beforeExpand.includes("{{") &&
        !isLegadoJsRule(rule) &&
        !looksLikeLegadoJs(script))
    ) {
      return script;
    }
    script = expandLegadoRegexGroupRefsInJs(script, content);
    const allowContentFallback = this.shouldEvalJsFallbackToContent(content);
    const contentBeforeEval = this.content;
    const jsPrefix = this.nextChapterUrl
      ? `var nextChapterUrl=${JSON.stringify(this.nextChapterUrl)};\n`
      : "";
    let out: unknown;
    try {
      out = evalJs(jsPrefix + script, this.buildJsEvalContext(content), {
        throwOnError: true,
      });
    } catch (e) {
      if (isVerificationCancelled(e)) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      this.host.log(`规则 JS 错误: ${msg}`);
      if (!isLegadoJsRule(rule) && allowContentFallback) {
        return this.content;
      }
      throw e instanceof Error ? e : new Error(msg);
    }
    if (Array.isArray(out)) {
      return out;
    }
    if (out != null && out !== "") {
      return out;
    }
    // 显式空串是合法结果；勿回退整页 HTML（见 evalRuleJs）
    if (out === "") {
      return "";
    }
    const pathMatch = script.match(/path\s*=\s*['"]([^'"]+)['"]/);
    if (pathMatch) {
      try {
        return this.getElementForJs(pathMatch[1]);
      } catch {
        return [];
      }
    }
    if (allowContentFallback && this.content !== contentBeforeEval) {
      return this.content;
    }
    if (isLegadoJsRule(rule)) {
      return "";
    }
    if (allowContentFallback) {
      return this.content;
    }
    return out;
  }

  /** 子元素/片段解析失败时不应回退到整页 HTML */
  private shouldEvalJsFallbackToContent(content: unknown): boolean {
    // 规则链中间结果（blogId 字符串、列表项 JSON 等）禁止回退整页 content
    if (content !== this.content) return false;
    if (this.content == null || this.content === "") return false;
    return typeof this.content === "string";
  }

  private byJsonPath(rule: string, content: unknown, list: boolean): unknown {
    let data = content;
    if (typeof content === "string") {
      try {
        data = JSON.parse(content);
      } catch {
        return list ? [] : "";
      }
    }
    const trimmed = stripJsonPathRulePrefix(rule);
    // Legado AnalyzeByJSonPath.getList：&& 各段对同一 JSON 根分别取表再合并（非链式钻取）
    if (list && /(?:&&|\|\||%%)/.test(trimmed)) {
      return byJsonPathLegadoList(trimmed, data);
    }
    let path = normalizeJaywayArrayJsonPath(
      trimmed.startsWith("$") ? trimmed : `$.${trimmed}`,
      data,
    );
    try {
      const results = JSONPath({ path, json: data as object, wrap: false });
      if (list) {
        if (results == null) return [];
        return Array.isArray(results) ? results : [results];
      }
      if (Array.isArray(results)) {
        // 对齐 Legado：标量数组整表 join（如 $.tagList），勿只取 [0]
        const allScalar = results.every(
          (v) =>
            v == null ||
            typeof v === "string" ||
            typeof v === "number" ||
            typeof v === "boolean",
        );
        const joinMulti =
          allScalar || path.includes("..") || path.includes("[*]");
        if (joinMulti) {
          const sep =
            path.includes("[*]") && !path.includes("..") && !allScalar
              ? ","
              : "\n";
          return results.map((v) => String(v ?? "")).filter(Boolean).join(sep);
        }
        const first = results[0] ?? "";
        if (first !== "" && first != null) return first;
      } else if (results != null && results !== "") {
        return results;
      }
      // 标量路径落空时尝试详情字段兼容（blogsetting → posts[0].post）
      const fb = jsonPathWithLegacyResponseFallback(path, data);
      return fb || "";
    } catch {
      return list ? [] : "";
    }
  }

  private byXPath(rule: string, content: unknown, list: boolean): unknown {
    const html = typeof content === "string" ? content : String(content ?? "");
    try {
      return selectXPath(rule, html, list);
    } catch {
      return list ? [] : "";
    }
  }

  private byLegadoDefault(rule: string, content: unknown, list: boolean): unknown {
    const trimmed = rule.replace(/^@@/, "").trim();
    if (!trimmed) return list ? [] : "";

    const { parts, joiner } = splitLegadoCompoundRule(trimmed);
    if (parts.length <= 1) {
      return this.byLegadoDefaultSingle(trimmed, content, list);
    }
    return this.mergeLegadoDefaultCompound(parts, joiner, content, list);
  }

  /** Legado AnalyzeByJSoup：同一段内 && / || / %% 组合，共用 content */
  private mergeLegadoDefaultCompound(
    parts: string[],
    joiner: "&&" | "||" | "%%",
    content: unknown,
    list: boolean,
  ): unknown {
    if (joiner === "||") {
      for (const part of parts) {
        const r = this.byLegadoDefaultSingle(part.trim(), content, list);
        if (list) {
          const arr = Array.isArray(r) ? r : r != null && r !== "" ? [r] : [];
          if (arr.length) return arr;
        } else if (typeof r === "string" && r) {
          return r;
        } else if (Array.isArray(r) && r.length) {
          return legadoJoinResultTexts(r.map(String));
        } else if (r != null && r !== "") {
          return String(r);
        }
      }
      return list ? [] : "";
    }

    if (joiner === "%%") {
      const lists = parts.map((part) => {
        const r = this.byLegadoDefaultSingle(part.trim(), content, true);
        return Array.isArray(r) ? r : r != null && r !== "" ? [r] : [];
      });
      if (!lists.length || !lists[0]?.length) return list ? [] : "";
      const out: unknown[] = [];
      for (let i = 0; i < lists[0]!.length; i++) {
        for (const lst of lists) {
          if (i < lst.length) out.push(lst[i]!);
        }
      }
      if (list) return out;
      return legadoJoinResultTexts(
        out.map((v) => String(v ?? "")).filter(Boolean),
      );
    }

    const acc: string[] = [];
    const elements: unknown[] = [];
    for (const part of parts) {
      const r = this.byLegadoDefaultSingle(part.trim(), content, list);
      if (list) {
        if (Array.isArray(r)) elements.push(...r);
        else if (r != null && r !== "") elements.push(r);
      } else if (typeof r === "string" && r) {
        acc.push(r);
      } else if (Array.isArray(r)) {
        acc.push(...r.map(String).filter(Boolean));
      } else if (r != null && r !== "") {
        acc.push(String(r));
      }
    }
    if (list) return elements;
    return joinLegadoDefaultAndTexts(acc);
  }

  private byLegadoDefaultExtractAll(rule: string, content: unknown): string[] {
    const trimmed = rule.replace(/^@@/, "").trim();
    if (!trimmed) return [];

    const atParts = trimmed.split("@").filter(Boolean);
    if (atParts.length < 2) return [];

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
    if (!extract || selectorSegs.length !== 1) return [];

    const selector = selectorSegs[0].trim();
    const parsed = parseLegadoSelectorSegment(selector);
    if (hasLegadoSegmentIndex(parsed)) return [];

    const html = typeof content === "string" ? content : String(content ?? "");
    const $ = loadCheerioHtml(html);
    const els = isLegadoAttrSelectorSegment(selector)
      ? queryLegadoAttrSelector($, selector)
      : // fromRoot：整页查询（含 <head> 内 og:novel meta），勿限 body
        queryLegadoSelectorSegment($, $.root(), selector, true);
    if (!els.length) return [];

    const out: string[] = [];
    els.each((_, el) => {
      const v = trimLegadoAsciiWhitespace(extractFromElement($(el), extract!));
      if (v) out.push(v);
    });
    return pickLegadoResultByIndex(out, resultIndex);
  }

  private byLegadoDefaultSingle(rule: string, content: unknown, list: boolean): unknown {
    const trimmed = rule.replace(/^@@/, "").trim();
    if (!trimmed) return list ? [] : "";

    // `https://host/&&tag.a@href` 的前缀：字面量，勿当 CSS（Cheerio 会抛 Expected name）
    if (!list && isLegadoLiteralUrlRule(trimmed) && !trimmed.includes("@")) {
      return trimmed;
    }

    if (trimmed.startsWith("@css:")) {
      return this.byCss(trimmed.slice(5).trim(), content, list);
    }

    const html = legadoContentToReplaceSource(content);
    const $ = loadCheerioHtml(html);
    let atParts = trimmed.split("@").filter(Boolean);

    let jsSuffix: string | null = null;
    const tail = atParts[atParts.length - 1];
    if (tail?.startsWith("js:") || tail?.startsWith("@js:")) {
      jsSuffix = tail.replace(/^@?js:/, "").trim();
      atParts = atParts.slice(0, -1);
    }

    if (atParts.length === 1 && !jsSuffix) {
      const seg = atParts[0];
      // getString：裸 text/html/href 等从当前 content 提取。
      // getElements（list）：对齐 Legado `select(rule)`，勿把 `html`/`all` 当提取类型
      // （否则 chapterList:"html" 单章源得到字符串而非元素，目录为空）。
      if (!list && (isLegadoExtractType(seg) || isLegadoAttrExtract(seg))) {
        return extractFromContentRoot(content, seg, list);
      }
      if (isLegadoAttrSelectorSegment(seg)) {
        const found = queryLegadoAttrSelector($, seg);
        if (!found.length) return list ? [] : "";
        // 对齐 Legado Elements：列表可供后续 <js> 调用 .attr/.select（非仅 outerHTML 字符串）
        if (list) return cheerioToJsoupList($, found);
        return found.first().html() ?? found.first().text() ?? "";
      }
      const found = queryLegadoSelectorSegment($, $("body"), seg, true);
      if (!found.length) return list ? [] : "";
      if (list) return cheerioToJsoupList($, found);
      return found.first().html() ?? found.first().text() ?? "";
    }

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

    if (extract && selectorSegs.length > 0 && !jsSuffix) {
      const parts = legadoCollectResultTexts(html, trimmed);
      if (parts.length) {
        return list ? parts : legadoJoinResultTexts(parts);
      }
    }

    let current: cheerio.Cheerio<any> = $("body");
    if (!current.length) current = $.root().children();

    for (let i = 0; i < selectorSegs.length; i++) {
      const seg = selectorSegs[i];
      let found: cheerio.Cheerio<any>;
      let segIndexed = false;
      if (isLegadoAttrSelectorSegment(seg)) {
        found = queryLegadoAttrSelector($, seg);
      } else {
        found = queryLegadoSelectorSegment($, current, seg, i === 0);
        const parsed = parseLegadoSelectorSegment(seg);
        segIndexed = hasLegadoSegmentIndex(parsed);
      }
      if (!found.length) return list ? [] : "";

      const isLast = i === selectorSegs.length - 1;
      if (isLast && !extract && !jsSuffix) {
        const target = list ? found : segIndexed ? found : pickElements(found, { index: 0 });
        if (list) return cheerioToJsoupList($, target);
        return target.first().html() ?? target.first().text() ?? "";
      }

      if (isLast && extract) {
        const parsed = parseLegadoSelectorSegment(seg);
        if (
          parsed.tagName === "span" &&
          parsed.index != null &&
          current.length === 1 &&
          current.children("li").length > 1
        ) {
          const perLi = extractIndexedSpanTextFromListItems(
            $,
            current,
            parsed.index,
            extract,
          );
          if (perLi) return perLi;
        }
        current = found;
      } else {
        // list 模式中间段保留全部匹配（对齐 Legado getElements）；单值模式再取首个
        current = list || segIndexed ? found : pickElements(found, { index: 0 });
      }
    }

    let value: unknown;
    if (!extract && !jsSuffix) {
      if (list) return cheerioToJsoupList($, current);
      value = current.first().html() ?? current.first().text() ?? "";
    } else if (extract) {
      if (list || current.length > 1) {
        const out: string[] = [];
        current.each((_, el) => {
          const v = trimLegadoAsciiWhitespace(extractFromElement($(el), extract));
          if (v) out.push(v);
        });
        const picked = pickLegadoResultByIndex(out, resultIndex);
        return list ? picked : legadoJoinResultTexts(picked);
      }
      value = extractFromElement(current, extract);
    } else {
      value = list
        ? cheerioToJsoupList($, current)
        : (current.first().html() ?? current.first().text() ?? "");
    }

    if (jsSuffix) {
      const base = typeof value === "string" ? value : String(value ?? "");
      const jsOut = evalJs(jsSuffix, {
        source: this.source,
        book: this.book,
        chapter: this.chapter,
        result: base,
        baseUrl: this.baseUrl,
        host: this.host,
      });
      return jsOut ?? base;
    }

    return value;
  }

  private byCss(rule: string, content: unknown, list: boolean): unknown {
    const html = typeof content === "string" ? content : String(content ?? "");
    const $ = loadCheerioHtml(html);
    let sel = rule.replace(/^@@/, "").replace(/^@css:/, "").trim();
    if (!sel) return list ? [] : "";

    let extract = "html";
    const at = sel.lastIndexOf("@");
    if (at > 0) {
      const maybe = sel.slice(at + 1);
      if (isLegadoExtractType(maybe)) {
        extract = maybe;
        sel = sel.slice(0, at);
      }
    }

    const els = $(normalizeLegadoCssAttrContains(sel));
    if (!els.length) return list ? [] : "";
    if (list) {
      // 供后续 @js：`$[i].select()`（对齐 Legado Elements）；普通列表字段仍靠 toString→outerHtml
      return cheerioToJsoupList($, els);
    }
    return extractFromElement(els.first(), extract);
  }

  async getUrlList(
    rule: string | undefined | null,
    mContent?: unknown,
  ): Promise<string[]> {
    if (!rule?.trim()) return [];
    const content = mContent ?? this.content;
    const parseRule = await this.applyPutFromFullRule(rule, content);
    // @js 返回 string[] 时保留列表（对齐 Legado getStringList isUrl），勿先拼成单串
    if (/(?:@js:|<js>|@webjs:)/i.test(parseRule)) {
      const prevChain = this.chainItemContext;
      this.chainItemContext = content;
      try {
        const rules = splitSourceRule(parseRule);
        let result: unknown = content;
        for (const r of rules) {
          result = await this.evalStringChainSegment(r, result);
        }
        if (Array.isArray(result)) {
          const out: string[] = [];
          for (const item of result) {
            const u = this.resolveAbsoluteRuleUrl(String(item ?? "").trim());
            if (u) out.push(u);
          }
          return out;
        }
        const raw = coerceLegadoRuleString(result).trim();
        if (!raw) return [];
        // 规则 JS 空返回若误回退整页 HTML，勿按行拆成「下一页」URL
        // （否则会把广告属性行解析成相对路径并去拉 404，正文里出现「页面不存在」+ CSS）
        if (/^\s*</.test(raw)) return [];
        if (/,\s*\{/.test(raw)) {
          const u = this.resolveAbsoluteRuleUrl(raw);
          return u ? [u] : [];
        }
        const out: string[] = [];
        for (const line of splitStringListLines(raw)) {
          const u = this.resolveAbsoluteRuleUrl(line);
          if (u) out.push(u);
        }
        return out;
      } finally {
        this.chainItemContext = prevChain;
      }
    }

    const raw = (await this.getString(rule, mContent)).trim();
    if (!raw) return [];
    // 含 UrlOption 的整段可跨行，不可按行拆成多条
    if (/,\s*\{/.test(raw)) {
      const chunks = raw
        .split(/\n\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const out: string[] = [];
      for (const chunk of chunks.length ? chunks : [raw]) {
        if (/,\s*\{/.test(chunk)) {
          const u = this.resolveAbsoluteRuleUrl(chunk);
          if (u) out.push(u);
          continue;
        }
        for (const line of chunk.split(/[\r\n]+/)) {
          const u = this.resolveAbsoluteRuleUrl(line.trim());
          if (u) out.push(u);
        }
      }
      return out;
    }
    const list = await this.getStringList(rule, mContent);
    const out: string[] = [];
    for (const item of list) {
      const u = this.resolveAbsoluteRuleUrl(item);
      if (u) out.push(u);
    }
    return out;
  }

  resolveAbsoluteRuleUrl(u: string): string {
    let path = u.trim();
    if (!path) return "";
    // 内容回退/误解析成相对路径时，拒绝整页 JSON/HTML 被拼进 URL
    if (
      path.startsWith("{") ||
      path.startsWith("[") ||
      path.startsWith("<") ||
      path.length > 4096
    ) {
      return "";
    }
    const suffix = extractUrlFetchOptionsSuffix(path);
    const { url: pathPart } = splitUrlAndRuleVariables(path);
    path = pathPart;
    if (path.startsWith("data:") || path.startsWith("colortxt-local:")) {
      return path + suffix;
    }
    if (path.startsWith("//")) path = `https:${path}`;
    if (!/^https?:\/\//i.test(path)) {
      const base = normalizeBookSourceBaseUrl(
        this.redirectUrl || this.baseUrl || this.source?.bookSourceUrl || "",
      );
      // UrlOption 后缀已拆出；相对路径不含换行。多行 href 误入时只取首行
      path = resolveAbsoluteUrl(base, path);
    } else {
      path = normalizeHttpUrlPath(path);
    }
    return path + suffix;
  }

  async getUrl(rule: string, content?: unknown): Promise<string> {
    const raw = (await this.getString(rule, content)).trim();
    if (!raw) return "";
    /**
     * 搜索/详情 bookUrl 常为多行 UrlOption：
     * `https://host/path,{\n  "body":'{"bookId":"1"}',\n  "method":"POST"\n}`
     * 不可走 getStringList 按换行切开（会只剩 `…/path,{`，bookId 丢失）。
     */
    if (/,\s*\{/.test(raw)) {
      return this.resolveAbsoluteRuleUrl(raw);
    }
    // 多条普通 href 换行拼接（如 a@href）：取第一条
    const first =
      raw
        .split(/[\r\n]+/)
        .map((s) => s.trim())
        .find(Boolean) ?? "";
    return first ? this.resolveAbsoluteRuleUrl(first) : "";
  }
}

/**
 * Legado：上一段为正则捕获组 List 时，规则 JS 里的 `$1`/`$2` 替换为组内容。
 * 仅标量数组可展开；JsonPath `data.books[*]` 等对象数组不可展开，否则会把
 * `.replace(..., '（$1）')` 里的 `$1` 误替换成 `String(book)` → `[object Object]`
 *（搜索 list `@js` 里 `.replace(..., '（$1）')` 拼最新章日期）。
 */
function expandLegadoRegexGroupRefsInJs(script: string, content: unknown): string {
  if (!Array.isArray(content) || content.length === 0) return script;
  const allScalar = content.every(
    (v) =>
      v == null ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean",
  );
  if (!allScalar) return script;
  return script.replace(/\$(\d{1,2})/g, (_, d) => {
    const v = content[Number.parseInt(d, 10)] ?? "";
    return String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  });
}

function jsonPathFromContent(path: string, content: unknown): string {
  let data = content;
  if (typeof content === "string") {
    try {
      data = JSON.parse(content);
    } catch {
      return "";
    }
  }
  if (data == null || typeof data !== "object") return "";
  const jsonPath = path.startsWith("$") ? path : `$.${path}`;
  try {
    const results = JSONPath({ path: jsonPath, json: data as object, wrap: false });
    if (Array.isArray(results)) {
      // 对齐 Legado：数组结果用换行拼接（含 $.data.Content[0].Content 字符串数组）
      const allScalar = results.every(
        (v) => v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean",
      );
      const joinMulti =
        allScalar || jsonPath.includes("..") || jsonPath.includes("[*]");
      if (joinMulti) {
        const sep = jsonPath.includes("[*]") && !jsonPath.includes("..") && !allScalar
          ? ","
          : "\n";
        return results.map((v) => coerceLegadoMediaUrl(v)).filter(Boolean).join(sep);
      }
      return coerceLegadoMediaUrl(results[0]);
    }
    return coerceLegadoMediaUrl(results);
  } catch {
    return "";
  }
}

/**
 * 部分博客/合集书源字段兼容（勿把 detail 的 post.blogId 当成 blogsetting.blogId：
 * 否则会误拼 blogHomePage，目录变成博主全部动态而非本书）。
 */
function jsonPathWithLegacyResponseFallback(path: string, content: unknown): string {
  let val = jsonPathFromContent(path, content);
  if (val) return val;
  // coverUrl @put page：详情响应常无 blogStat，用合集 postCount 供真·blogHomePage 分页
  if (path === "$.response.blogInfo.blogStat.publicPostCount") {
    const count =
      jsonPathFromContent(
        "$.response.posts[0].post.postCollection.postCount",
        content,
      ) || jsonPathFromContent("$..postCollection.postCount", content).split("\n")[0];
    return String(count ?? "").split("\n")[0]?.trim() ?? "";
  }
  return "";
}

function expandLegadoTemplateJsonPathExpr(expr: string, content: unknown): string {
  const alts = expr.split("||").map((s) => s.trim()).filter(Boolean);
  for (const alt of alts) {
    // 对齐 Legado：`{{$.docId##.*_}}` 先取 JsonPath，再套用 ## 替换
    const { baseRule, regex } = splitRuleRegexSuffix(alt);
    const pathPart = baseRule.trim();
    if (
      !pathPart.startsWith("$.") &&
      !pathPart.startsWith("$..") &&
      !pathPart.startsWith("$[")
    ) {
      continue;
    }
    let val = "";
    if (isPlainRuleObject(content)) {
      val = readJsonField(content as Record<string, unknown>, pathPart);
    }
    if (!val) {
      val = jsonPathWithLegacyResponseFallback(pathPart, content);
    }
    if (val && regex) val = applyRuleRegexImpl(val, regex);
    if (val) return val;
  }
  if (alts.length === 1 && isJsonItemContent(content)) {
    const { baseRule } = splitRuleRegexSuffix(alts[0]!);
    const pathPart = baseRule.trim();
    const nestedFallback: Record<string, string> = {
      "$.blogId": "$.blogInfo.blogId",
      "$.blogName": "$.blogInfo.blogName",
    };
    const fb = nestedFallback[pathPart];
    if (fb) {
      return readJsonField(content as Record<string, unknown>, fb);
    }
  }
  return "";
}

/** `{$.…}`/`{{` 展开后：剥 `@JSon:`；若已无 JsonPath，直接当字面量（如章名 `@JSon:{$.chaptername}`） */
function asLiteralAfterJsonBraceExpand(rule: string): string | null {
  const stripped = stripJsonPathRulePrefix(rule).trim();
  if (!stripped) return "";
  if (
    stripped.includes("{$") ||
    stripped.includes("{{") ||
    stripped.startsWith("$") ||
    /^@(?:js|webjs|css|xpath|json):/i.test(stripped) ||
    /^<js>/i.test(stripped) ||
    // 裸字段名（书单推荐 `name`/`author`）须继续走 getOne，不可当字面量
    /^[\w.]+$/.test(stripped)
  ) {
    return null;
  }
  return stripped;
}

/**
 * 展开单花括号 `{$.path}`（对齐 Legado）。
 * 若规则中的 `{$.…}` 全部取空，则丢弃剩余纯字面量（如 `{$.novelsize}字`→勿留下「字」、
 * `第{$.maxChapterId}章`→勿留下「第章」）；含 URL/`@`/`$.` 等结构的残留仍保留。
 */
function expandBraceJsonPathRule(rule: string, content: unknown): string {
  let anyHit = false;
  let anyMiss = false;
  const out = rule.replace(/(?<!\{)\{(\$\.[^}]+)\}/g, (_, expr: string) => {
    const v = jsonPathFromContent(expr.trim(), content);
    if (v) anyHit = true;
    else anyMiss = true;
    return v;
  });
  if (anyMiss && !anyHit) {
    const leftover = rule.replace(/(?<!\{)\{(\$\.[^}]+)\}/g, "").trim();
    // 仅剩度量词/衬字等字面量时视为整段未命中
    if (leftover && !/[$@/\\]|https?:|\{|\}/i.test(leftover)) {
      return "";
    }
  }
  return out;
}

function isJsonItemContent(content: unknown): boolean {
  return (
    content != null &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    !isJsoupElementLike(content)
  );
}

/** JSON 列表项上的裸字段名，如 category_name */
function tryJsonFieldRule(rule: string, content: unknown): string | null {
  const t = rule.trim();
  if (!isJsonItemContent(content)) return null;
  if (!/^[\w.]+$/.test(t)) return null;
  const path = t.startsWith("$.") ? t : `$.${t}`;
  const v = jsonPathFromContent(path, content);
  return v || null;
}

function splitStringListLines(value: string): string[] {
  return value
    .split(/[\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Legado getStringList：JSON 数组字段（如 $.tagList / book_tag_list[*].title）展开为多个 tag */
function jsonPathToLegadoStringList(rule: string, content: unknown): string[] {
  const pathRule = rule.trim().split("##")[0]?.trim() ?? "";
  const path = legadoJsonPathFromRule(pathRule);
  if (!path) return [];
  let data = content;
  if (typeof content === "string") {
    try {
      data = JSON.parse(content);
    } catch {
      return [];
    }
  }
  if (data == null || typeof data !== "object") return [];
  try {
    const results = JSONPath({ path, json: data as object, wrap: false });
    if (results == null || results === "") return [];
    const flatten = (v: unknown): string[] => {
      if (v == null) return [];
      if (Array.isArray(v)) return v.flatMap((item) => flatten(item));
      const s = String(v).trim();
      return s ? [s] : [];
    };
    if (Array.isArray(results)) {
      if (results.length === 1 && Array.isArray(results[0])) {
        return flatten(results[0]);
      }
      return results.flatMap((v) => flatten(v));
    }
    return flatten(results);
  } catch {
    return [];
  }
}

/**
 * Legado / Jayway 在数组根上的路径兼容（仅当 content 为数组时改写）：
 * - `$.*` / `$.[*]` → `$[*]`（jsonpath-plus 的 `$.[*]` 会误展开嵌套字段）
 * - `$.*[?(…)]` → `$[?(…)]`（jsonpath-plus 对前者常返回空）
 * 对象根（如 `{data:[…]}`）不改写，避免影响 `$.*` 取对象属性值。
 */
function normalizeJaywayArrayJsonPath(path: string, data: unknown): string {
  if (!Array.isArray(data)) return path;
  if (path === "$.*" || path === "$.[*]") return "$[*]";
  // 仅 `$.*` 后紧跟 `[` 的过滤器形式，如 `$.*[?(@.novelName)]`
  if (path.startsWith("$.*[")) return `$${path.slice(3)}`;
  return path;
}

/** 剥离 `@Json:` / `@JSon:` / `@json:` 等（对齐 Legado 大小写不敏感） */
function stripJsonPathRulePrefix(rule: string): string {
  const m = rule.trim().match(/^@json:\s*/i);
  return m ? rule.trim().slice(m[0].length) : rule.trim();
}

/** Legado AnalyzeByJSonPath.getList 单段 */
function readJsonPathListSingle(rule: string, data: unknown): unknown[] {
  const t = stripJsonPathRulePrefix(rule);
  if (!t || data == null || typeof data !== "object") return [];
  const path = normalizeJaywayArrayJsonPath(
    t.startsWith("$") ? t : `$.${t}`,
    data,
  );
  try {
    const results = JSONPath({ path, json: data as object, wrap: false });
    if (results == null) return [];
    return Array.isArray(results) ? results : [results];
  } catch {
    return [];
  }
}

/**
 * Legado AnalyzeByJSonPath.getList：`&&` 各段对同一 JSON 根分别取表再合并；
 * `||` 取首个非空；`%%` 按索引交错。
 */
function byJsonPathLegadoList(rule: string, data: unknown): unknown[] {
  const trimmed = rule.trim();
  if (!trimmed) return [];
  const { parts, joiner } = splitLegadoCompoundRule(trimmed);
  if (parts.length <= 1) {
    return readJsonPathListSingle(parts[0] ?? trimmed, data);
  }
  if (joiner === "||") {
    for (const part of parts) {
      const temp = byJsonPathLegadoList(part.trim(), data);
      if (temp.length) return temp;
    }
    return [];
  }
  if (joiner === "%%") {
    const lists = parts
      .map((p) => byJsonPathLegadoList(p.trim(), data))
      .filter((l) => l.length);
    if (!lists.length) return [];
    const out: unknown[] = [];
    const max = Math.max(...lists.map((l) => l.length));
    for (let i = 0; i < max; i++) {
      for (const list of lists) {
        if (i < list.length) out.push(list[i]);
      }
    }
    return out;
  }
  const result: unknown[] = [];
  for (const part of parts) {
    const temp = byJsonPathLegadoList(part.trim(), data);
    if (temp.length) result.push(...temp);
  }
  return result;
}

function isLegadoJsonContent(content: unknown): boolean {
  if (content == null) return false;
  if (typeof content === "object") {
    // getElements 返回的 Jsoup Element / Element[] 不是 JSONPath 数据
    if (isJsoupElementLike(content)) return false;
    if (Array.isArray(content)) {
      if (!content.length) return false;
      if (content.every(isJsoupElementLike)) return false;
      if (
        content.every(
          (x) => typeof x === "string" && /^\s*</.test(x),
        )
      ) {
        return false;
      }
    }
    return true;
  }
  if (typeof content !== "string") return false;
  const str = content.trim();
  return (
    (str.startsWith("{") && str.endsWith("}")) ||
    (str.startsWith("[") && str.endsWith("]"))
  );
}

/**
 * Default 规则 `&&` 拼接：含字面 URL 时直接相连（`https://host/&&tag.a@href`）；
 * 否则仍用换行（kind 标签等再经 `##\n##，` 规范化）。
 */
function joinLegadoDefaultAndTexts(parts: string[]): string {
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0] ?? "";
  if (parts.some((p) => /^(?:https?:\/\/|data:)/i.test(p.trim()))) {
    return parts.join("");
  }
  return legadoJoinResultTexts(parts);
}

function detectMode(rule: string, contentIsJson = false): AnalyzeMode {
  const t = rule.trim();
  if (isLegadoTemplateOnlyRule(t)) return "template";
  if (/^@webjs:/i.test(t)) return "webJs";
  if (/^<js>/i.test(t) || /^@js:/i.test(t)) return "js";
  // @put/@get 拼出的 URL 优先于 JsonPath / XPath（/book/x.html）
  if (isLegadoLiteralUrlRule(t)) return "default";
  if (
    /^@json:/i.test(t) ||
    t.startsWith("$.") ||
    t.startsWith("$..") ||
    t.startsWith("$[")
  )
    return "json";
  if (t.startsWith("@XPath:") || t.startsWith("@xpath:") || t.startsWith("/"))
    return "xpath";
  if (t.startsWith("@css:") || t.startsWith("@@")) return "default";
  if (t.includes("{{")) return "js";
  if (looksLikeLegadoJs(t)) return "js";
  if (t.startsWith(":") || looksLikeLegadoRegexRule(t)) return "regex";
  if (/^##/.test(t) || (t.startsWith("##") === false && /^[^@#.\s]+##/.test(t)))
    return "regex";
  // Legado：setContent 判定为 JSON 时，裸字段规则（如 data）走 JsonPath；
  // CSS/Default 选择器（og:novel meta、tag@class 等）仍走 default，勿当字面量/路径。
  // 注意：勿用宽泛 `\[[^\]]+\]`，否则 JsonPath 的 `[*]`/`[0]`/`[?(…)]` 会被误判为 CSS
  //（如部分书源章节列表 `result.chapterList[*].chapterViewList[*]`）。
  if (contentIsJson) {
    if (
      /@(?:text|textNodes|ownText|html|all|href|src|content|value)\b/i.test(t) ||
      /^class\.|^tag\.|^id\.|^\./.test(t) ||
      // CSS 属性选择器：[href=…] [name$=…] [property="og:…"]；不含 [*] / [0] / [?(]
      /\[[\w-]+\s*(?:[~|^$*!]?=)/.test(t)
    ) {
      return "default";
    }
    return "json";
  }
  return "default";
}

function stripPrefix(s: string, prefixes: string[]): string {
  for (const p of prefixes) {
    if (s.startsWith(p)) return s.slice(p.length).trim();
  }
  return s;
}

function emptySource(): BookSourceRecord {
  return { bookSourceUrl: "", bookSourceName: "", bookSourceType: 0 };
}

export function templateRule(rule: string, ctx: Record<string, string>): string {
  return rule.replace(/\{\{([^}]+)\}\}/g, (_, key) => ctx[key.trim()] ?? "");
}
