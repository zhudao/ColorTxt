import iconv from "iconv-lite";
import type { BookSourceRecord } from "@shared/bookSource/types";
import {
  normalizeBookSourceBaseUrl,
  normalizeHttpUrlPath,
  resolveAbsoluteUrl,
} from "@shared/bookSource/url";

import { createJsExtensionHost, type JsExtensionHost, isHttpGetKey } from "./jsExtensions";
import {
  buildSourceRequestHeaders,
  resolveSourceRequestHeaders,
} from "./sourceRequestHeaders";
import { appendBookSourceErrorLog } from "./bookSourceErrorLog";
import { toLegadoStrResponse } from "./legadoStrResponse";
import { cookieHeaderForUrl } from "./cookieManager";
import { DEFAULT_BOOK_SOURCE_USER_AGENT } from "./bookSourceUserAgent";
import { evalJs, evalJsAsync } from "./rhinoRuntime";
import { legadoJsonValueToString } from "./legadoJavaApi";
import { runBackstageWebView } from "./backstageWebView";
import { fetchViaChromiumNet } from "./chromiumNetFetch";
import { splitAtJsRule } from "./legadoRuleSplit";
import {
  isLegadoEmbeddedRuleExpr,
  isLegadoJsonPathExpr,
  parseLegadoUrlSuffixJson,
} from "./legadoCompositeRule";
import { withSourceRateLimit } from "./concurrentRateLimiter";
import { extractProxyFromHeaders } from "./httpProxy";

export type StrResponse = {
  url: string;
  body: string;
  headers: Record<string, string>;
  statusCode?: number;
  statusMessage?: string;
};

export type UrlFetchOptions = {
  charset?: string;
  method?: string;
  body?: string;
  bodyJs?: string;
  webJs?: string;
  webView?: boolean;
  webViewDelayTime?: number;
  headers?: Record<string, string>;
  /** Legado UrlOption.type：非空时响应正文改为 hex 字符串 */
  type?: string;
};

/** URL 后缀 JSON 选项：`,` + `{`，但勿匹配 Mustache 模板 `{{...}}` */
const PARAM_JSON_PATTERN = /,\s*(?=\{(?!\{))/;

const EMPTY_BODY_MD5_STUB = "D41D8CD98F00B204E9800998ECF8427E";

function hasGorgonHeader(headers?: Record<string, string>): boolean {
  return Boolean(headers?.["X-Gorgon"] ?? headers?.["x-gorgon"]);
}

/** Legado NetworkUtils.notNeedEncodingQuery：含 `+`，故 `order=foo+` 视为已编码、勿再 encode */
const LEGADO_QUERY_SAFE =
  /[A-Za-z0-9!$&()*+,\-./:;=?@[\]^_`{|}~]/;

/**
 * 对齐 Legado NetworkUtils.encodedQuery：
 * 仅含「查询安全字符」或合法 `%XX` 时视为已编码，整段 query 原样保留。
 * 旧实现只认 `%XX`，会把 `novel_wordnumber+` 拆参后编成 `%2B`，部分接口因此 400。
 */
function isLegadoEncodedQuery(query: string): boolean {
  for (let i = 0; i < query.length; i++) {
    const c = query[i]!;
    if (LEGADO_QUERY_SAFE.test(c)) continue;
    if (c === "%" && i + 2 < query.length) {
      const h1 = query[i + 1]!;
      const h2 = query[i + 2]!;
      if (/[0-9A-Fa-f]/.test(h1) && /[0-9A-Fa-f]/.test(h2)) {
        i += 2;
        continue;
      }
    }
    return false;
  }
  return true;
}

/**
 * 对齐 Legado AnalyzeUrl.queryEncoder（RFC3986 UNRESERVED ∪ !$%&()*+,/:;=?@[]^`{|}）：
 * 对整段 query 做百分号编码，保留 `+&=` 等分隔/字面量；已有 `%XX` 不二次编码。
 */
function encodeLegadoQueryString(params: string, charset?: string): string {
  if (!params) return "";
  if (isLegadoEncodedQuery(params)) return params;
  const cs = charset?.trim().toLowerCase();
  let out = "";
  for (let i = 0; i < params.length; ) {
    const c = params[i]!;
    if (c === "%" && i + 2 < params.length) {
      const h1 = params[i + 1]!;
      const h2 = params[i + 2]!;
      if (/[0-9A-Fa-f]/.test(h1) && /[0-9A-Fa-f]/.test(h2)) {
        out += params.slice(i, i + 3);
        i += 3;
        continue;
      }
    }
    // queryEncoder 另允许 `%`（非法 `%` 单独出现时仍百分号编码）
    if (c.charCodeAt(0) < 128 && (LEGADO_QUERY_SAFE.test(c) || c === "%")) {
      out += c;
      i += 1;
      continue;
    }
    // 按 Unicode 码点切片，避免把代理对拆开
    const cp = params.codePointAt(i)!;
    const char = String.fromCodePoint(cp);
    i += char.length;
    if (!cs || cs === "utf-8" || cs === "utf8") {
      out += encodeURIComponent(char);
      continue;
    }
    const buf = iconv.encode(char, cs);
    out += Array.from(buf)
      .map((b) => `%${b.toString(16).padStart(2, "0").toUpperCase()}`)
      .join("");
  }
  return out;
}

function augmentGorgonHeaders(
  headers: Record<string, string>,
  requestUrl: string,
): Record<string, string> {
  if (!hasGorgonHeader(headers)) return headers;
  const out = { ...headers };
  if (!out["X-SS-STUB"] && !out["x-ss-stub"]) {
    out["X-SS-STUB"] = EMPTY_BODY_MD5_STUB;
  }
  if (!out["X-SS-DP"] && !out["x-ss-dp"]) {
    out["X-SS-DP"] = requestUrl.match(/[?&]aid=(\d+)/)?.[1] ?? "1967";
  }
  if (!out["Cookie"]?.trim()) delete out["Cookie"];
  return out;
}

/** 对齐 Legado：仅剥离 `,{"method":…}` 类 UrlOption，勿切断 query 内逗号 */
function stripUrlOptionSuffix(url: string): string {
  const m = PARAM_JSON_PATTERN.exec(url);
  if (!m || m.index == null) return url.trim();
  const tail = url.slice(m.index + m[0].length).trimStart();
  if (!tail.startsWith("{")) return url.trim();
  return url.slice(0, m.index).trim();
}

function resolveGetRequestUrl(
  url: string,
  urlNoQuery: string,
  fieldMap: Map<string, string>,
  headers: Record<string, string>,
  method: string,
): string {
  const plainUrl = stripUrlOptionSuffix(url);
  // Legado POST：urlNoQuery 可带 query（product 等），勿剥成光 path
  if (method !== "GET") {
    if (urlNoQuery.includes("?")) return stripUrlOptionSuffix(urlNoQuery);
    if (plainUrl.includes("?")) return plainUrl;
    return stripUrlOptionSuffix(urlNoQuery);
  }
  if (hasGorgonHeader(headers) && plainUrl.includes("?")) return plainUrl;
  if (fieldMap.size > 0) return buildQueryUrl(urlNoQuery, fieldMap);
  if (plainUrl.includes("?")) return plainUrl;
  return urlNoQuery;
}

export function normalizeUrlFetchOptions(options: UrlFetchOptions): UrlFetchOptions {
  const normalized: UrlFetchOptions = { ...options };
  if (normalized.headers) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(normalized.headers)) {
      headers[key] = legadoJsonValueToString(value);
    }
    normalized.headers = headers;
  }
  if (normalized.body != null && typeof normalized.body !== "string") {
    const bodyText = legadoJsonValueToString(normalized.body);
    if (bodyText) normalized.body = bodyText;
    else delete normalized.body;
  }
  if (normalized.headers && hasGorgonHeader(normalized.headers)) {
    if (!normalized.headers["Cookie"]?.trim()) delete normalized.headers["Cookie"];
  }
  return normalized;
}

export function splitUrlFetchOptions(ruleUrl: string): {
  urlPart: string;
  options: UrlFetchOptions;
} {
  const m = PARAM_JSON_PATTERN.exec(ruleUrl);
  if (!m || m.index == null) return { urlPart: ruleUrl, options: {} };
  const tail = ruleUrl.slice(m.index + 1).trim();
  if (!tail.startsWith("{")) return { urlPart: ruleUrl, options: {} };
  const parsed = parseLegadoUrlSuffixJson(tail);
  const options = normalizeUrlFetchOptions({
    headers: parsed.headers,
    method: parsed.method,
    body: parsed.body,
    charset: parsed.charset,
    type: parsed.type,
    webView: parsed.webView,
    webJs: parsed.webJs ?? parsed.js,
    bodyJs: parsed.bodyJs,
    webViewDelayTime: parsed.webViewDelayTime,
  });
  return { urlPart: ruleUrl.slice(0, m.index), options };
}

export function encodeSearchKey(key: string, charset?: string): string {
  const cs = charset?.trim().toLowerCase();
  if (!cs || cs === "utf-8" || cs === "utf8") {
    return encodeURIComponent(key);
  }

  const buf = iconv.encode(key, cs);
  return Array.from(buf)
    .map((b) => `%${b.toString(16).padStart(2, "0").toUpperCase()}`)
    .join("");
}

function isUtf8Charset(charset?: string): boolean {
  const cs = charset?.trim().toLowerCase();
  return !cs || cs === "utf-8" || cs === "utf8";
}

function hasUrlEncoded(str: string): boolean {
  return /%[0-9A-Fa-f]{2}/.test(str);
}

/** Legado EncoderUtils.escape */
function escapeFieldValue(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122)
    ) {
      out += char;
      continue;
    }
    const prefix = code < 16 ? "%0" : code < 256 ? "%" : "%u";
    out += prefix + code.toString(16);
  }
  return out;
}

function encodeFieldValue(value: string, charset?: string): string {
  if (!value) return "";
  const cs = charset?.trim().toLowerCase();
  if (cs === "escape") return escapeFieldValue(value);
  if (!cs || cs === "utf-8" || cs === "utf8") {
    if (hasUrlEncoded(value)) return value;
    return encodeURIComponent(value);
  }

  return encodeSearchKey(value, cs);
}

function analyzeFields(
  fieldsTxt: string,
  charset?: string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of fieldsTxt.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? "" : part.slice(eq + 1);
    map.set(key, encodeFieldValue(value, charset));
  }
  return map;
}

function isJsonOrXml(text: string): boolean {
  const t = text.trim();
  return t.startsWith("{") || t.startsWith("[") || t.startsWith("<");
}

function buildQueryUrl(base: string, fieldMap: Map<string, string>): string {
  if (fieldMap.size === 0) return base;
  const query = Array.from(fieldMap.entries())
    .map(([k, v]) => `${encodeURIComponent(k)}=${v}`)
    .join("&");
  return `${base}?${query}`;
}

function buildFormBody(
  fieldMap: Map<string, string>,
  charset?: string,
): string | Buffer {
  const body = Array.from(fieldMap.entries())
    .map(([k, v]) => `${encodeURIComponent(k)}=${v}`)
    .join("&");
  if (!isUtf8Charset(charset)) {
    return iconv.encode(body, charset!.trim());
  }
  return body;
}

export type AnalyzeUrlOptions = {
  mUrl: string;
  key?: string;
  page?: number;
  baseUrl?: string;
  source?: BookSourceRecord;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  host?: JsExtensionHost;
  logs?: string[];

  /** ruleContent.webJs 等场景传入，优先于 URL 内嵌 webJs */
  webJs?: string;
  /** 正文 sourceRegex（预留） */
  sourceRegex?: string;

  /** 与 AnalyzeRule 共享，对齐 Legado RuleData.variableMap */
  ruleVariables?: Record<string, string>;
};

export class AnalyzeUrl {
  ruleUrl = "";
  url = "";
  body: string | null = null;
  headerMap: Record<string, string> = {};
  private host: JsExtensionHost;
  private source?: BookSourceRecord;
  private key?: string;
  private page?: number;
  private baseUrl: string;
  private urlFetchOptions: UrlFetchOptions = {};
  /** 不含 UrlOption 的请求路径（Legado `url`；`ruleUrl` 可仍带 `,{}`） */
  private urlPartForFetch = "";
  private method = "GET";
  private urlNoQuery = "";
  private fieldMap = new Map<string, string>();
  private urlReady = false;
  private headersResolved = false;
  private extraHeaders: Record<string, string> = {};

  /** searchUrl @js 中 java.put 写入的变量（与 bookList 规则共享） */
  private ruleVariables: Record<string, string>;
  private extraWebJs?: string;
  private sourceRegex?: string;

  constructor(opts: AnalyzeUrlOptions) {
    this.source = opts.source;
    this.key = opts.key;
    this.page = opts.page;
    this.baseUrl = normalizeBookSourceBaseUrl(opts.baseUrl ?? "");
    this.host =
      opts.host ??
      createJsExtensionHost(opts.source ?? emptySource(), opts.logs ?? []);
    this.extraHeaders = { ...(opts.headers ?? {}) };
    this.headerMap = {
      ...buildSourceRequestHeaders(opts.source),
      ...this.extraHeaders,
    };
    this.ruleUrl = opts.mUrl;
    this.ruleVariables = opts.ruleVariables ?? {};
    this.extraWebJs = opts.webJs?.trim() || undefined;
    this.sourceRegex = opts.sourceRegex?.trim() || undefined;
  }

  getRuleVariables(): Record<string, string> {
    return this.ruleVariables;
  }

  /** 供 bookList 中 java.ajax(u) 使用：含 fetch 选项的完整 URL 字符串 */
  getAjaxUrl(): string {
    // Legado：`ruleUrl` 在切 UrlOption 后仍保留 `,{}`；优先原串
    if (/,\s*\{/.test(this.ruleUrl)) {
      return resolveAbsoluteUrl(this.baseUrl || this.url, this.ruleUrl);
    }
    const opts = this.urlFetchOptions;
    if (!opts || Object.keys(opts).length === 0) return this.url;
    return `${this.url},${JSON.stringify(opts)}`;
  }

  putVariable(key: string, value: unknown): string {
    const s = String(value ?? "");
    this.ruleVariables[key] = s;
    return s;
  }

  getVariable(key: string): string {
    return this.ruleVariables[key] ?? "";
  }

  buildAnalyzeUrlJava(): Record<string, unknown> {
    const au = this;
    const base = this.host.javaBindings;
    const baseGet = base.get as (arg: unknown, header?: unknown) => unknown;
    return {
      ...base,
      ruleUrl: this.ruleUrl,
      url: this.url || this.baseUrl,
      put: (key: string, value: unknown) => au.putVariable(key, value),
      get: (key: unknown, header?: unknown) => {
        const text = String(key ?? "").trim();
        if (isHttpGetKey(key, header)) {
          return baseGet(key, header);
        }
        const variable = au.getVariable(text);
        if (variable) return variable;
        return baseGet(key);
      },
    };
  }

  private syncUrlVariable(): void {
    if (this.url) {
      this.ruleVariables.url = this.getAjaxUrl();
    }
  }

  private async resolveHeaderMap(): Promise<void> {
    if (this.headersResolved) return;
    this.headersResolved = true;
    if (!this.source) return;
    const resolved = await resolveSourceRequestHeaders(this.source, {
      baseUrl: this.baseUrl || this.source.bookSourceUrl,
      host: this.host,
    });
    this.headerMap = { ...resolved, ...this.extraHeaders };
  }

  private async ensureUrlReady(): Promise<void> {
    if (this.urlReady) return;
    await this.resolveHeaderMap();
    await this.analyzeJs();
    await this.replaceKeyPageJs();
    this.analyzeUrl();
    this.syncUrlVariable();
    this.urlReady = true;
  }

  private async analyzeJs(): Promise<void> {
    let result = this.ruleUrl;
    const trimmed = this.ruleUrl.trim();
    if (trimmed.startsWith("@js:") && !trimmed.includes("<js>")) {
      const { jsPart, rest } = splitAtJsRule(trimmed);
      const js = jsPart.replace(/^@js:\n?/, "");
      result = String(
        await evalJsAsync(js, {
          source: this.source,
          result,
          baseUrl: this.baseUrl,
          key: this.key,
          page: this.page,
          host: this.host,
          java: this.buildAnalyzeUrlJava(),
        }),
      );
      if (rest) result = rest.replace("@result", String(result));
      this.ruleUrl = result;
      return;
    }
    let start = 0;
    const re = /<js>([\s\S]*?)<\/js>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.ruleUrl))) {
      if (m.index > start) {
        const part = this.ruleUrl.slice(start, m.index).trim();
        if (part) result = part.replace("@result", String(result));
      }
      const js = m[1] ?? "";
      result = String(
        await evalJsAsync(js, {
          source: this.source,
          result,
          baseUrl: this.baseUrl,
          key: this.key,
          page: this.page,
          host: this.host,
          java: this.buildAnalyzeUrlJava(),
        }),
      );
      start = m.index + m[0].length;
    }
    if (this.ruleUrl.length > start) {
      const part = this.ruleUrl.slice(start).trim();
      if (part) result = part.replace("@result", String(result));
    }
    this.ruleUrl = result;
  }

  private async applyTemplateAsync(text: string): Promise<string> {
    let out = typeof text === "string" ? text : text == null ? "" : String(text);
    if (this.key != null) {
      out = out.replace(/\{\{key\}\}/g, this.key);
    }
    if (this.page != null) {
      out = out.replace(/\{\{page\}\}/g, String(this.page));
    }
    if (this.source) {
      out = out.replace(
        /\{\{source\.key\}\}/g,
        encodeURIComponent(this.source.bookSourceUrl),
      );
    }
    if (out.includes("{{")) {
      const re = /\{\{([\s\S]*?)\}\}/g;
      let cursor = 0;
      let rebuilt = "";
      let m: RegExpExecArray | null;
      while ((m = re.exec(out)) !== null) {
        rebuilt += out.slice(cursor, m.index);
        const expr = (m[1] ?? "").trim();
        /**
         * AnalyzeUrl 无列表项 JSON 上下文。`$..docId##.*_` 等须在规则解析阶段展开；
         * 若残留在 URL 里，勿当 Rhino JS（会 SyntaxError: Unexpected token '.'）。
         */
        if (
          expr === "result" ||
          isLegadoJsonPathExpr(expr) ||
          isLegadoEmbeddedRuleExpr(expr)
        ) {
          rebuilt += "";
          cursor = m.index + m[0].length;
          continue;
        }
        const v = await evalJsAsync(expr, {
          source: this.source,
          result: out,
          baseUrl: this.baseUrl,
          key: this.key,
          page: this.page,
          host: this.host,
          java: this.buildAnalyzeUrlJava(),
        });
        if (typeof v === "number" && v % 1 === 0) {
          rebuilt += String(Math.trunc(v));
        } else {
          rebuilt += String(v ?? "");
        }
        cursor = m.index + m[0].length;
      }
      rebuilt += out.slice(cursor);
      out = rebuilt;
    }
    if (this.page != null) {
      out = out.replace(/<([^>]+)>/g, (_, inner) => {
        const pages = String(inner).split(",");
        const idx = Math.max(0, this.page! - 1);
        return (pages[idx] ?? pages[pages.length - 1] ?? "").trim();
      });
    }
    return out;
  }

  private async replaceKeyPageJs(): Promise<void> {
    /**
     * 对齐 Legado AnalyzeUrl：先整串 `replaceKeyPageJs`（含 `{{js}}`），再在 analyzeUrl
     * 阶段切 UrlOption。若先 `splitUrlFetchOptions`，会把
     * `{{String(java.connect(\`…search.html,{…}\`))}}` 在模板内的 `,{}` 处截断，
     * `{{…}}` 永不执行，相对路径变成字面 `{{String(java.connect…`。
     *
     * Legado `analyzeUrl()` 只从 `ruleUrl` 解析出 `url`/`UrlOption`，**不改写** `ruleUrl`；
     * `BookList.getInfoItem` 用 `ruleUrl`（可含 `,{}`）作为 bookUrl。勿把 `ruleUrl` 剥成 path。
     */
    this.ruleUrl = await this.applyTemplateAsync(this.ruleUrl);
    const split = splitUrlFetchOptions(this.ruleUrl);
    this.urlFetchOptions = { ...split.options };
    this.urlPartForFetch = split.urlPart;
    if (typeof this.urlFetchOptions.body === "string" && this.urlFetchOptions.body) {
      this.urlFetchOptions.body = await this.applyTemplateAsync(
        this.urlFetchOptions.body,
      );
    }
  }

  private analyzeUrl(): void {
    let u = (this.urlPartForFetch || this.ruleUrl).trim();
    if (u.startsWith("data:")) {
      this.parseDataUrl(u);
      return;
    }
    if (!/^https?:\/\//i.test(u)) {
      u = resolveAbsoluteUrl(this.baseUrl, u);
    } else {
      u = normalizeHttpUrlPath(u);
    }
    const charset = this.urlFetchOptions.charset;
    this.method =
      this.urlFetchOptions.method?.toUpperCase() === "POST" ? "POST" : "GET";

    // Legado：POST 保留 URL 上的 query（如 ?product=…），表单在 body；
    // GET 才把 query 拆进 fieldMap。
    if (this.method === "POST") {
      this.url = u;
      this.urlNoQuery = u;
      this.fieldMap = new Map();
      if (this.urlFetchOptions.body != null) {
        const postBody = this.urlFetchOptions.body;
        if (!isJsonOrXml(postBody)) {
          this.fieldMap = analyzeFields(postBody, charset);
          this.body = null;
        } else {
          this.body = postBody;
        }
      }
      return;
    }

    const qPos = u.indexOf("?");
    if (qPos >= 0) {
      this.urlNoQuery = u.slice(0, qPos);
      const queryPart = u.slice(qPos + 1);
      const signedGet = hasGorgonHeader(this.urlFetchOptions.headers);
      if (signedGet || isLegadoEncodedQuery(queryPart)) {
        this.url = u;
        this.fieldMap = new Map();
      } else if (charset?.trim().toLowerCase() === "escape") {
        // Legado：charset=escape 时走逐字段 EncoderUtils.escape
        this.fieldMap = analyzeFields(queryPart, charset);
        this.url = buildQueryUrl(this.urlNoQuery, this.fieldMap);
      } else {
        // 对齐 queryEncoder：整段编码并保留字面量 `+`（勿拆参后 encodeURIComponent → %2B）
        this.url = `${this.urlNoQuery}?${encodeLegadoQueryString(queryPart, charset)}`;
        this.fieldMap = new Map();
      }
    } else {
      this.urlNoQuery = u;
      this.url = u;
    }
  }

  private parseDataUrl(u: string): void {
    const m = u.match(/^data:([^;,]+)?(?:;([^,]*))?,(.*)$/i);
    if (!m) {
      this.url = u;
      return;
    }
    const dataType = m[1] ?? "";
    const meta = m[2] ?? "";
    let payload = m[3] ?? "";
    if (meta.includes("base64")) {
      payload = Buffer.from(payload, "base64").toString("utf8");
    }
    this.body = payload;
    this.url = u;
    this.type = dataType;
  }
  type?: string;

  /** Legado：UrlOption.type 非空时 body 为 hex（供 java.hexDecodeToString） */
  private applyTypeHexBody(body: string): string {
    const optionType = this.urlFetchOptions.type?.trim();
    if (!optionType) return body;
    return Buffer.from(body, "utf8").toString("hex");
  }

  /** POST 表单体：与 fetchStrResponse 同编码，供 webView loadURL.postData */
  private buildWebViewRequestPayload(): {
    method?: string;
    postData?: string | Buffer;
    headers: Record<string, string>;
  } {
    const headers: Record<string, string> = {
      ...this.headerMap,
      ...this.urlFetchOptions.headers,
    };
    if (this.method !== "POST") return { headers };
    const charset = this.urlFetchOptions.charset;
    let requestBody: string | Buffer | undefined;
    if (this.fieldMap.size > 0 && this.body == null) {
      requestBody = buildFormBody(this.fieldMap, charset);
    } else if (this.body != null) {
      requestBody = !isUtf8Charset(charset)
        ? iconv.encode(String(this.body), charset!.trim())
        : String(this.body);
    }
    if (
      requestBody != null &&
      !headers["Content-Type"] &&
      !headers["content-type"]
    ) {
      const bodyText =
        typeof requestBody === "string" ? requestBody.trim() : "";
      headers["Content-Type"] =
        bodyText.startsWith("{") || bodyText.startsWith("[")
          ? "application/json; charset=UTF-8"
          : "application/x-www-form-urlencoded";
    }
    return { method: "POST", postData: requestBody, headers };
  }

  async getStrResponse(opts?: { skipRateLimit?: boolean }): Promise<StrResponse> {
    return withSourceRateLimit(
      this.source,
      () => this.getStrResponseInner(),
      opts?.skipRateLimit === true,
    );
  }

  private async getStrResponseInner(): Promise<StrResponse> {
    await this.ensureUrlReady();
    if (this.url.startsWith("data:")) {
      if (this.body == null) {
        throw new Error(`无效 data URL（缺少正文）: ${this.url.slice(0, 96)}`);
      }
      return {
        url: this.url,
        body: this.applyTypeHexBody(this.body),
        headers: {},
      };
    }

    const webJs =
      this.extraWebJs ||
      this.urlFetchOptions.webJs?.trim() ||
      undefined;
    const useWebView = this.urlFetchOptions.webView === true;
    const webPayload = this.buildWebViewRequestPayload();

    if (useWebView && (this.method === "GET" || this.method === "POST")) {
      const webBody = await runBackstageWebView({
        url: this.url,
        // 无自定义 webJs 时取 outerHTML；延时由 backstageWebView 对齐 Legado：1000 + webViewDelayTime
        js: webJs,
        source: this.source,
        host: this.host,
        delayMs: this.urlFetchOptions.webViewDelayTime ?? undefined,
        method: webPayload.method,
        postData: webPayload.postData,
        headers: webPayload.headers,
      });
      const body = this.urlFetchOptions.type?.trim()
        ? this.applyTypeHexBody(webBody)
        : webBody;
      return { url: this.url, body, headers: {} };
    }

    let res = await fetchStrResponse(this.url, {
      source: this.source,
      headers: { ...this.headerMap, ...this.urlFetchOptions.headers },
      method: this.method,
      body: this.body ?? undefined,
      fieldMap: this.fieldMap,
      urlNoQuery: this.urlNoQuery,
      charset: this.urlFetchOptions.charset,
      host: this.host,
      logs: this.host.logs,
      skipRateLimit: true,
    });
    const bodyJs = this.urlFetchOptions.bodyJs?.trim();
    if (bodyJs) {
      const nextBody = await evalJsAsync(bodyJs, {
        source: this.source,
        result: res.body,
        baseUrl: this.baseUrl,
        key: this.key,
        page: this.page,
        host: this.host,
        java: this.buildAnalyzeUrlJava(),
      });
      if (nextBody != null && nextBody !== "") {
        res = { ...res, body: String(nextBody) };
      }
    }
    if (webJs) {
      const webBody = await runBackstageWebView({
        html: res.body,
        url: res.url,
        js: webJs,
        source: this.source,
        host: this.host,
        delayMs: this.urlFetchOptions.webViewDelayTime ?? undefined,
      });
      if (webBody) {
        res = { ...res, body: webBody };
      }
    }
    if (this.sourceRegex) {
      const re = new RegExp(this.sourceRegex);
      const m = res.body.match(re);
      if (m?.[0]) {
        res = { ...res, body: m[0] };
      }
    }
    if (this.urlFetchOptions.type?.trim()) {
      return { ...res, body: this.applyTypeHexBody(res.body) };
    }
    return res;
  }

  /** loginCheckJs：重新解析 URL 并再次请求 */
  initUrl(): this {
    this.urlReady = false;
    this.headersResolved = false;
    return this;
  }

  evalJS(script: string, result?: unknown): unknown {
    return evalJs(script, {
      source: this.source,
      result,
      baseUrl: this.baseUrl,
      key: this.key,
      page: this.page,
      host: this.host,
    });
  }
}

export async function fetchStrResponse(
  urlStr: string,
  opts: {
    source?: BookSourceRecord;
    headers?: Record<string, string>;
    method?: string;
    body?: string;
    charset?: string;
    fieldMap?: Map<string, string>;
    urlNoQuery?: string;
    host?: JsExtensionHost;
    logs?: string[];
    redirect?: RequestRedirect;
    skipRateLimit?: boolean;
    proxy?: string;
  } = {},
): Promise<StrResponse> {
  return withSourceRateLimit(
    opts.source,
    () => fetchStrResponseInner(urlStr, opts),
    opts.skipRateLimit === true,
  );
}

async function fetchStrResponseInner(
  urlStr: string,
  opts: {
    source?: BookSourceRecord;
    headers?: Record<string, string>;
    method?: string;
    body?: string;
    charset?: string;
    fieldMap?: Map<string, string>;
    urlNoQuery?: string;
    host?: JsExtensionHost;
    logs?: string[];
    redirect?: RequestRedirect;
    proxy?: string;
  } = {},
): Promise<StrResponse> {
  let url = urlStr.trim();
  let method = opts.method ?? "GET";
  let body = opts.body;
  let charset = opts.charset;
  let fieldMap = opts.fieldMap ?? new Map<string, string>();
  let urlNoQuery = opts.urlNoQuery ?? url;
  let headers = { ...opts.headers };
  if (opts.source) {
    const resolved = await resolveSourceRequestHeaders(opts.source, {
      baseUrl: normalizeBookSourceBaseUrl(opts.source.bookSourceUrl),
      host: opts.host,
      logs: opts.logs,
    });
    headers = { ...resolved, ...headers };
  }
  const extracted = extractProxyFromHeaders(headers);
  headers = extracted.headers;
  const proxy = opts.proxy?.trim() || extracted.proxy;

  const split = splitUrlFetchOptions(url);
  if (split.options && Object.keys(split.options).length > 0) {
    url = split.urlPart;
    urlNoQuery = split.urlPart;
    headers = { ...headers, ...split.options.headers };
    if (split.options.method) method = split.options.method;
    if (split.options.body != null) body = split.options.body;
    if (split.options.charset) charset = split.options.charset;
    const isPost = method.toUpperCase() === "POST";
    const qPos = url.indexOf("?");
    // Legado：仅 GET 拆 query；POST 保留 ?product=… 并在 body 提交表单
    if (qPos >= 0 && !isPost) {
      urlNoQuery = url.slice(0, qPos);
      fieldMap = analyzeFields(url.slice(qPos + 1), charset);
    } else if (isPost && typeof body === "string" && body && !body.trim().startsWith("{") && !body.trim().startsWith("<")) {
      fieldMap = analyzeFields(body, charset);
      body = undefined;
    }
  }

  if (url.startsWith("data:")) {
    const au = new AnalyzeUrl({
      mUrl: url,
      source: opts.source,
      host: opts.host,
    });
    return au.getStrResponse({ skipRateLimit: true });
  }

  if (!/^https?:\/\//i.test(urlNoQuery)) {
    throw new Error(`无效 URL: ${urlNoQuery}`);
  }
  let requestUrl = resolveGetRequestUrl(url, urlNoQuery, fieldMap, headers, method);
  headers = augmentGorgonHeaders(headers, requestUrl);
  if (opts.source?.enabledCookieJar) {
    const ck = cookieHeaderForUrl(requestUrl);
    if (ck) headers.Cookie = headers.Cookie ? `${headers.Cookie}; ${ck}` : ck;
  }

  if (!headers["User-Agent"] && !headers["user-agent"]) {
    headers["User-Agent"] = DEFAULT_BOOK_SOURCE_USER_AGENT;
  }
  let requestBody: string | Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    if (fieldMap.size > 0 && !body) {
      requestBody = buildFormBody(fieldMap, charset);
    } else if (body != null) {
      requestBody = !isUtf8Charset(charset)
        ? iconv.encode(body, charset!.trim())
        : body;
    }
    if (
      requestBody &&
      !headers["Content-Type"] &&
      !headers["content-type"]
    ) {
      // 对齐 Legado：JSON body 用 postJson（application/json），否则 form-urlencoded
      const bodyText =
        typeof requestBody === "string"
          ? requestBody.trim()
          : "";
      headers["Content-Type"] =
        bodyText.startsWith("{") || bodyText.startsWith("[")
          ? "application/json; charset=UTF-8"
          : "application/x-www-form-urlencoded";
    }
  }

  try {
    const netRes = await fetchViaChromiumNet({
      url: requestUrl,
      method,
      headers,
      body: requestBody,
      charset,
      proxy,
      useCookieJar: false,
      redirect: opts.redirect,
      timeoutMs: 15_000,
    });
    if (!netRes.body.trim() && hasGorgonHeader(headers)) {
      opts.logs?.push(
        `[HTTP] X-Gorgon 请求返回空响应 (${netRes.statusCode})：${requestUrl.slice(0, 120)}`,
      );
    }
    if (netRes.statusCode !== 200) {
      const reason = netRes.statusMessage?.trim()
        ? ` ${netRes.statusMessage.trim()}`
        : "";
      const bodyHint = netRes.body.trim()
        ? `，正文 ${netRes.body.length} 字`
        : "，正文为空";
      opts.logs?.push(
        `[HTTP] ${method} ${requestUrl.slice(0, 160)} → ${netRes.statusCode}${reason}${bodyHint}`,
      );
    }
    return {
      url: netRes.url,
      body: netRes.body,
      headers: netRes.headers,
      statusCode: netRes.statusCode,
      statusMessage: netRes.statusMessage,
    };
  } catch (e) {
    appendBookSourceErrorLog(opts.logs ?? [], e, {
      phase: "HTTP 请求",
      sourceName: opts.source?.bookSourceName,
      sourceUrl: opts.source?.bookSourceUrl,
      url: requestUrl,
      method,
    });
    throw e;
  }
}

function emptySource(): BookSourceRecord {
  return {
    bookSourceUrl: "",
    bookSourceName: "",
    bookSourceType: 0,
  };
}

/** Legado java.ajaxAll：并发请求，返回 StrResponse 数组 */
export async function ajaxAllStrResponses(
  host: JsExtensionHost,
  urlList: unknown,
  skipRateLimit?: unknown,
): Promise<ReturnType<typeof toLegadoStrResponse>[]> {
  const urls = Array.isArray(urlList)
    ? urlList.map((u) => String(u ?? ""))
    : Array.from(urlList as Iterable<unknown>).map((u) => String(u ?? ""));
  const skip = skipRateLimit === true;
  const results: ReturnType<typeof toLegadoStrResponse>[] = new Array(urls.length);
  const workers = Math.min(Math.max(urls.length, 1), 8);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= urls.length) return;
      const urlStr = urls[index]!;
      try {
        const res = await new AnalyzeUrl({
          mUrl: urlStr,
          baseUrl: host.source.bookSourceUrl,
          source: host.source,
          host,
          logs: host.logs,
        }).getStrResponse({ skipRateLimit: skip });
        results[index] = toLegadoStrResponse(res, {
          statusCode: res.statusCode,
          message: res.statusMessage,
        });
      } catch (e) {
        appendBookSourceErrorLog(host.logs, e, {
          phase: "java.ajaxAll",
          sourceName: host.source.bookSourceName,
          url: urlStr,
        });
        const msg = e instanceof Error ? e.stack ?? e.message : String(e);
        results[index] = toLegadoStrResponse(
          { url: urlStr, body: msg, headers: {} },
          { statusCode: 500, message: "error" },
        );
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

