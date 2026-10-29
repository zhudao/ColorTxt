import { applyRuleRegex, splitRuleRegexSuffix } from "./legadoDefaultRule";
import { compileLegadoRegex } from "./analyzeByRegex";
import { JSONPath } from "jsonpath-plus";
import { looksLikeLegadoJs } from "./legadoRuleSplit";
import { parseLegadoLooseJsonObject } from "./legadoLooseJson";
import { parseLegadoHeaderJson } from "./sourceRequestHeaders";
import { isJsoupElementLike } from "./legadoJsoupShim";

const PUT_PATTERN = /@put:\s*(\{[^}]+\})/gi;
/** Legado 内联 @put 形如 `{bid:id}`；勿匹配 `{{$.path}}` 等 JS/模板占位 */
const INLINE_PUT_PATTERN = /\{(\{[\w]+:[^}]+\})\}/g;
const EVAL_PATTERN = /@get:\{([^}]+)\}|@get:([\w.]+)|\{\{([\s\S]*?)\}\}/gi;

export function sourceVariableCacheKey(sourceUrl: string, key: string): string {
  return `v_${sourceUrl}_${key}`;
}

export function expandLegadoGetRefs(
  rule: string,
  lookup: (key: string) => string,
): string {
  return rule
    .replace(/@get:\{([^}]+)\}/gi, (_, key: string) => lookup(key.trim()))
    .replace(/@get:([\w.]+)/gi, (_, key: string) => lookup(key.trim()));
}

/**
 * `@put`/`@get` 拼出的详情链等：已是最终 URL，不可再当 JsonPath / XPath。
 * 例：`https://example.com/book/123.html`、`/book/123.html`
 * 仍含 `{{…}}` / `@get:` / `{$.…}` 时须先 makeUpRule，不可当字面量
 *（`$.bid` → `<js>…</js>` → `https://…?bookid={{result}}`）。
 * 含 `&&` / `||` / `%%` 的是拼接规则（如 `https://host/&&tag.a@href`），不可整段当字面 URL。
 */
export function isLegadoLiteralUrlRule(rule: string): boolean {
  const t = rule.trim();
  if (!t) return false;
  if (t.includes("{{") || t.includes("{$") || /@get:/i.test(t)) return false;
  // 含 `$1` 等捕获组引用须走 makeUpRule，不可当字面 URL（如部分书源 chapterUrl）
  if (/\$\d{1,2}/.test(t)) return false;
  // 与 splitLegadoCompoundRule 一致：组合符存在时须分段解析
  if (/(?:&&|\|\||%%)/.test(t)) return false;
  if (/^(?:https?:\/\/|data:|javascript:)/i.test(t)) return true;
  // /book/123.html — 勿当 XPath（XPath 多为 /html、//div）
  if (
    /^\/[^/\s]/.test(t) &&
    !t.startsWith("//") &&
    !/^\/(?:html|body|head)\b/i.test(t) &&
    /\.(?:html?|php|aspx?|jsp|json)(?:[?#]|$)/i.test(t)
  ) {
    return true;
  }
  return false;
}

/** 整条规则仅为 @get:key / @get:{key}（Legado AnalyzeRule evalPattern） */
export function parseLegadoPureGetKey(rule: string): string | null {
  const trimmed = rule.trim();
  const braced = trimmed.match(/^@get:\{([^}]+)\}$/i);
  if (braced) return braced[1]!.trim();
  const plain = trimmed.match(/^@get:([\w.]+)$/i);
  if (plain) return plain[1]!.trim();
  return null;
}

/** Legado 规则末尾 {"varName":"extractRule"} 内联存变量 */
export function parseInlinePutFromRule(rule: string): {
  cleanRule: string;
  putMap: Record<string, string>;
} {
  const putMap: Record<string, string> = {};
  const cleanRule = rule
    .replace(INLINE_PUT_PATTERN, (_, json: string) => {
      try {
        const obj = JSON.parse(json) as Record<string, string>;
        for (const [k, v] of Object.entries(obj)) {
          if (k && v != null) putMap[k] = String(v);
        }
      } catch {
        /* ignore invalid inline put */
      }
      return "";
    })
    .trim();
  return { cleanRule, putMap };
}

export function containsCompositeEvalRule(rule: string): boolean {
  const { cleanRule } = parsePutMapFromRule(rule);
  return cleanRule.includes("{{") || /@get:/i.test(cleanRule);
}

/** Legado JSONPath 表达式（含 `$..` 递归路径） */
export function isLegadoJsonPathExpr(expr: string): boolean {
  const path = expr.split("##")[0]?.trim() ?? "";
  if (path.startsWith("$.") || path.startsWith("$..") || path.startsWith("$[")) return true;
  // 裸 JsonPath：book_tag_list[*].title
  return /[\[\]]/.test(path) && /^[\w.[\]*]+$/.test(path);
}

/** Legado 裸 JsonPath（如 book_tag_list[*].title）补全为 $. 前缀；纯字段名返回 null */
export function legadoJsonPathFromRule(rule: string): string | null {
  const path = rule.split("##")[0]?.trim() ?? rule.trim();
  if (!path) return null;
  if (path.startsWith("$.") || path.startsWith("$..") || path.startsWith("$[")) return path;
  /**
   * 对齐 byJsonPath：`path = rule.startsWith("$") ? rule : \`$.\${rule}\``
   * - `.contentsize` → `$..contentsize`
   * - `.rows[*]` → `$..rows[*]`
   * - `rows[*]` → `$.rows[*]`
   */
  if (path.startsWith(".") || /[\[\]]/.test(path)) {
    return `$.${path}`;
  }
  return null;
}

/** Legado SourceRule.isRule：`{{…}}` 内以 @/$/xpath 开头的是嵌套规则，不是 Rhino JS */
export function isLegadoEmbeddedRuleExpr(expr: string): boolean {
  const t = expr.trim();
  if (!t) return false;
  // `$..path` 也以 `$.` 开头；显式包含 `$..` / 带 ## 的 JsonPath
  if (isLegadoJsonPathExpr(t)) return true;
  return (
    t.startsWith("@") ||
    t.startsWith("//")
  );
}

/** {{}} 内是否须 Rhino 求值的 JS 表达式（非 JSONPath / result / 嵌套规则 / book 绑定） */
export function legadoTemplateNeedsJsEval(rule: string): boolean {
  if (!rule.includes("{{")) return false;
  for (const m of rule.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const key = m[1].trim();
    if (key === "result" || isLegadoJsonPathExpr(key)) continue;
    if (isLegadoEmbeddedRuleExpr(key)) continue;
    if (
      key === "title" ||
      key === "chapter.title" ||
      key === "bookName" ||
      key === "book.name" ||
      key === "book.author"
    ) {
      continue;
    }
    return true;
  }
  return false;
}

/** 纯 {{jsonPath}} 模板（可含路径/分隔符字面量），不含 @js: 链 */
export function isLegadoTemplateOnlyRule(rule: string): boolean {
  const t = rule.trim();
  if (!t.includes("{{")) return false;
  if (legadoTemplateNeedsJsEval(t)) return false;
  if (/(?:<js>|@js:)/i.test(t)) return false;
  if (/^@js:/i.test(t) || /^<js>/i.test(t)) return false;
  if (looksLikeLegadoJs(t)) return false;
  const stripped = t.replace(/\{\{[\s\S]*?\}\}/g, "").trim();
  // `@{{$.author}}`：展开后仅剩展示用 @ 前缀，仍视为纯模板
  if (!stripped || stripped === "@") return true;
  if (/[@$]|\$\.|\$\[|^@json:|^@Json:|^@css:/i.test(stripped)) return false;
  return true;
}

/**
 * 整条规则仅为一个或多个 `{{...}}`（可含须 JS 求值的表达式）。
 * 此类规则应在 expand 后直接返回，勿再把展开结果当脚本执行
 *（否则 `{{'xxx'}}` → `xxx` → ReferenceError）。
 */
export function isPureMustacheTemplateRule(rule: string): boolean {
  const t = rule.trim();
  if (!t.includes("{{")) return false;
  if (/(?:<js>|@js:)/i.test(t)) return false;
  return t.replace(/\{\{[\s\S]*?\}\}/g, "").trim() === "";
}

function coercePutStringMap(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k && v != null) out[k] = String(v);
  }
  return out;
}

/** Legado @put:{key:"rule"} — Gson 可解析 key 无引号的类 JSON */
function parsePutJsonObject(raw: string): Record<string, string> | null {
  const t = raw.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return null;
  try {
    return coercePutStringMap(JSON.parse(t) as Record<string, unknown>);
  } catch {
    /* lenient Legado 格式 */
  }
  try {
    const normalized = t.replace(
      /([\{,]\s*)([A-Za-z_$][\w$]*)\s*:/g,
      '$1"$2":',
    );
    return coercePutStringMap(JSON.parse(normalized) as Record<string, unknown>);
  } catch {
    return null;
  }
}

function parsePutKeyValueFallback(raw: string): Record<string, string> {
  const t = raw.trim();
  const inner = t.startsWith("{") && t.endsWith("}") ? t.slice(1, -1) : t;
  const out: Record<string, string> = {};
  for (const part of inner.split(",")) {
    const m = part.trim().match(/^([^:]+?)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1].trim().replace(/^['"]|['"]$/g, "");
    const val = m[2].trim().replace(/^['"]|['"]$/g, "");
    if (key) out[key] = val;
  }
  return out;
}

export function parsePutMapFromRule(rule: string): {
  cleanRule: string;
  putMap: Record<string, string>;
} {
  const putMap: Record<string, string> = {};
  let working = rule
    .replace(PUT_PATTERN, (_, raw: string) => {
      const parsed = parsePutJsonObject(raw) ?? parsePutKeyValueFallback(raw);
      Object.assign(putMap, parsed);
      return "";
    })
    .trim();
  const inline = parseInlinePutFromRule(working);
  working = inline.cleanRule;
  Object.assign(putMap, inline.putMap);
  return { cleanRule: working, putMap };
}

export function isLegadoInlineRule(expr: string): boolean {
  const t = expr.trim();
  return (
    t.startsWith("@") ||
    isLegadoJsonPathExpr(t) ||
    t.startsWith("//") ||
    t.startsWith("/")
  );
}

export function extractUrlFetchOptionsSuffix(url: string): string {
  const m = /,\s*(?=\{(?!\{))/.exec(url);
  if (m?.index == null || m.index <= 0) return "";
  return url.slice(m.index);
}

export type LegadoUrlFetchOptions = {
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  charset?: string;
  /** Legado UrlOption.type：非空时 getStrResponse 返回 hex 编码正文 */
  type?: string;
  webView?: boolean;
  webJs?: string;
  /** 兼容 UrlOption.js（部分源写作 js 而非 webJs） */
  js?: string;
  bodyJs?: string;
  webViewDelayTime?: number;
};

function stringifyLegadoHeaderMap(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) out[k] = "";
    else out[k] = String(v);
  }
  return out;
}

/** Legado URL 后缀 JSON：可能是 {"headers":{...}}，也可能是 java.get("headers") 的扁平 header 对象 */
function isLegadoFlatHeaderMap(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  if (!keys.length) return false;
  const reserved = new Set([
    "method",
    "body",
    "charset",
    "headers",
    "redirect",
    "proxy",
    "webView",
    "webJs",
    "js",
    "type",
    "retry",
    "webViewDelayTime",
    "serverID",
  ]);
  if (keys.some((k) => reserved.has(k))) return false;
  return keys.every(
    (k) =>
      typeof obj[k] === "string" ||
      typeof obj[k] === "number" ||
      typeof obj[k] === "boolean",
  );
}

function coerceUrlOptionBody(body: unknown): string {
  if (typeof body === "string") return body;
  if (body == null) return "";
  // POST JSON body 常为对象；String(obj) → "[object Object]" 会导致正文接口空响应
  if (typeof body === "object") {
    try {
      return JSON.stringify(body);
    } catch {
      return "";
    }
  }
  return String(body);
}

export function parseLegadoUrlSuffixJson(raw: string): LegadoUrlFetchOptions {
  // 书源常见 body: '{"a":1}'（单引号包着内层双引号 JSON）；标准 JSON.parse 会失败
  let parsed = parseLegadoLooseJsonObject(raw);
  if (!parsed) {
    const loose = parseLegadoHeaderJson(raw);
    if (loose && Object.keys(loose).length > 0) {
      return { headers: loose };
    }
    return {};
  }

  const pickUrlOptionFields = (
    headers?: Record<string, string>,
  ): LegadoUrlFetchOptions => {
    const webViewRaw = parsed!.webView;
    const webView =
      webViewRaw === true ||
      webViewRaw === "true" ||
      webViewRaw === 1 ||
      webViewRaw === "1";
    const delayRaw = parsed!.webViewDelayTime;
    const webViewDelayTime =
      typeof delayRaw === "number" && Number.isFinite(delayRaw)
        ? delayRaw
        : typeof delayRaw === "string" && delayRaw.trim()
          ? Number(delayRaw)
          : undefined;
    return {
      headers,
      method: typeof parsed!.method === "string" ? parsed!.method : undefined,
      body: parsed!.body != null ? coerceUrlOptionBody(parsed!.body) : undefined,
      charset: typeof parsed!.charset === "string" ? parsed!.charset : undefined,
      type: typeof parsed!.type === "string" ? parsed!.type : undefined,
      webView: webView || undefined,
      webJs: typeof parsed!.webJs === "string" ? parsed!.webJs : undefined,
      js: typeof parsed!.js === "string" ? parsed!.js : undefined,
      bodyJs: typeof parsed!.bodyJs === "string" ? parsed!.bodyJs : undefined,
      webViewDelayTime:
        webViewDelayTime != null && Number.isFinite(webViewDelayTime)
          ? webViewDelayTime
          : undefined,
    };
  };

  if (
    parsed.headers &&
    typeof parsed.headers === "object" &&
    !Array.isArray(parsed.headers)
  ) {
    return pickUrlOptionFields(
      stringifyLegadoHeaderMap(parsed.headers as Record<string, unknown>),
    );
  }

  // 仅有 method/body 的 UrlOption（无 headers）较常见
  const hasReservedOptionKey = [
    "method",
    "body",
    "charset",
    "type",
    "webView",
    "webJs",
    "js",
    "retry",
    "webViewDelayTime",
    "serverID",
    "origin",
  ].some((k) => Object.prototype.hasOwnProperty.call(parsed!, k));
  if (hasReservedOptionKey) {
    return pickUrlOptionFields();
  }

  if (isLegadoFlatHeaderMap(parsed)) {
    return { headers: stringifyLegadoHeaderMap(parsed) };
  }
  return {};
}

export function splitUrlAndRuleVariables(url: string): {
  url: string;
  variables: Record<string, string>;
} {
  const m = /,\s*(?=\{)/.exec(url);
  if (m?.index == null || m.index <= 0) return { url, variables: {} };
  const tail = url.slice(m.index + 1).trim();
  if (!tail.startsWith("{")) return { url: url.slice(0, m.index).trim(), variables: {} };
  const opts = parseLegadoUrlSuffixJson(tail);
  const variables: Record<string, string> = {};
  if (opts.headers) variables.headers = JSON.stringify(opts.headers);
  return { url: url.slice(0, m.index).trim(), variables };
}

export type MakeUpRuleResult = {
  rule: string;
  replaceRegex: string;
  replacement: string;
  replaceFirst: boolean;
};

/** Legado 规则末尾 ##正则##替换；忽略 {{}} 内部的 ## */
export function splitMakeUpRegexSuffix(text: string): MakeUpRuleResult {
  let braceDepth = 0;
  for (let i = 0; i < text.length - 1; i++) {
    if (text.startsWith("{{", i)) {
      braceDepth++;
      i++;
      continue;
    }
    if (text.startsWith("}}", i)) {
      braceDepth = Math.max(0, braceDepth - 1);
      i++;
      continue;
    }
    if (braceDepth > 0) continue;
    if (text[i] !== "#" || text[i + 1] !== "#") continue;

    const tail = text.slice(i + 2);
    const end = tail.indexOf("##");
    if (end < 0) {
      return {
        rule: text.slice(0, i).trim(),
        replaceRegex: tail.trim(),
        replacement: "",
        replaceFirst: false,
      };
    }
    let replacement = tail.slice(end + 2);
    let replaceFirst = false;
    if (replacement.endsWith("#")) {
      replaceFirst = true;
      replacement = replacement.slice(0, -1);
    }
    return {
      rule: text.slice(0, i).trim(),
      replaceRegex: tail.slice(0, end).trim(),
      replacement,
      replaceFirst,
    };
  }
  return {
    rule: text.trim(),
    replaceRegex: "",
    replacement: "",
    replaceFirst: false,
  };
}

export function applyMakeUpRegex(value: string, meta: MakeUpRuleResult): string {
  if (!meta.replaceRegex) return value;
  // 对齐 Legado SourceRule.makeUpRule：`rule = ruleStrS[0].trim()` 后再 replaceRegex。
  // 部分书源 kind：`{{…##·|\d.*}}##.*\s` 展开后带尾部空白时，不 trim 会使 `.*\s` 整段匹配成空。
  const text = value.trim();
  const regex = {
    pattern: meta.replaceRegex,
    replacement: meta.replacement,
  };
  if (meta.replaceFirst) {
    try {
      const re = compileLegadoRegex(regex.pattern, "");
      if (!re) return value;
      const m = text.match(re);
      if (!m?.[0]) return value;
      return m[0].replace(re, regex.replacement);
    } catch {
      return value;
    }
  }
  return applyRuleRegex(text, regex);
}

export function extractEvalSegments(rule: string): {
  hasEval: boolean;
  literalParts: string[];
  evalParts: Array<{ type: "get" | "js"; expr: string }>;
} {
  const evalParts: Array<{ type: "get" | "js"; expr: string }> = [];
  const literalParts: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(EVAL_PATTERN.source, "gi");
  while ((m = re.exec(rule))) {
    literalParts.push(rule.slice(last, m.index));
    if (m[1]) evalParts.push({ type: "get", expr: m[1] });
    else if (m[2]) evalParts.push({ type: "get", expr: m[2] });
    else if (m[3]) evalParts.push({ type: "js", expr: m[3] });
    last = m.index + m[0].length;
  }
  literalParts.push(rule.slice(last));
  return {
    hasEval: evalParts.length > 0,
    literalParts,
    evalParts,
  };
}

export function isPlainRuleObject(content: unknown): content is Record<string, unknown> {
  // getElements 返回的 Jsoup Element 也是 object，不可当 JSON 条目走 readJsonField
  //（否则 `{{@@.class@text##…}}` 等列表 kind 规则会整段取空）
  return (
    content != null &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    !isJsoupElementLike(content)
  );
}

/** JSONPath / 规则取值：字符串、数字、布尔、图片对象 `{ orign: "url" }` */
export function coerceLegadoMediaUrl(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return value % 1 === 0 ? String(Math.trunc(value)) : String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    const t = value.trim();
    return t && t !== "[object Object]" ? t : "";
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown> & { text?: unknown };
    // Jsoup Element/Elements：书源 JSON 字段误存节点时用 .text()
    if (typeof o.text === "function") {
      try {
        const t = String(o.text.call(value) ?? "").trim();
        if (t && t !== "[object Object]") return t;
      } catch {
        /* fall through */
      }
    }
    for (const key of ["orign", "origin", "raw", "url", "imgUrl", "bigUrl"]) {
      const v = o[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}

/** getElement / 规则链：取 JSON 子节点，保留 object（readJsonField 会 stringify） */
export function readJsonNestedValue(
  content: Record<string, unknown>,
  fieldRule: string,
): unknown {
  const { baseRule, regex } = splitRuleRegexSuffix(fieldRule.trim());
  const key = baseRule.trim();
  if (!key) return undefined;
  let val: unknown;
  const jsonPath = legadoJsonPathFromRule(key);
  if (jsonPath || key.startsWith("$.") || key.startsWith("$[")) {
    const path = jsonPath ?? key;
    try {
      const results = JSONPath({ path, json: content, wrap: false });
      if (Array.isArray(results)) {
        const joinMulti = path.includes("..") || path.includes("[*]");
        val = joinMulti ? results : (results[0] ?? "");
      } else {
        val = results;
      }
    } catch {
      return undefined;
    }
  } else {
    const parts = key.split(".");
    let cur: unknown = content;
    for (const p of parts) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[p];
    }
    val = cur;
  }
  if (val == null || val === "") return undefined;
  if (regex) {
    const s = typeof val === "string" ? val : coerceLegadoMediaUrl(val);
    return applyRuleRegex(s, regex);
  }
  return val;
}

/** 列表项已是 `$.data` 子对象时，误写 `$.data.authorName` 等路径的回退 */
function jsonFieldPathFallbacks(path: string): string[] {
  const out: string[] = [];
  if (path.startsWith("$.data.")) {
    out.push(`$.${path.slice("$.data.".length)}`);
  }
  if (path.includes(".data.expand.")) {
    out.push(path.replace(/\.data\.expand\./g, ".expand."));
  }
  return out.filter((p, i, arr) => p !== path && arr.indexOf(p) === i);
}

function readJsonPathFieldValue(
  content: Record<string, unknown>,
  path: string,
): string {
  try {
    const results = JSONPath({ path, json: content, wrap: false });
    if (Array.isArray(results)) {
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
        return results
          .map((v) => coerceLegadoMediaUrl(v))
          .filter(Boolean)
          .join(sep);
      }
      return coerceLegadoMediaUrl(results[0]);
    }
    return coerceLegadoMediaUrl(results);
  } catch {
    return "";
  }
}

export function readJsonField(content: Record<string, unknown>, fieldRule: string): string {
  const { baseRule, regex } = splitRuleRegexSuffix(fieldRule.trim());
  const key = baseRule.trim();
  if (!key) return "";
  let val = "";
  const jsonPath = legadoJsonPathFromRule(key);
  if (jsonPath || key.startsWith("$.") || key.startsWith("$[")) {
    const path = jsonPath ?? key;
    const paths = [path, ...jsonFieldPathFallbacks(path)];
    for (const p of paths) {
      val = readJsonPathFieldValue(content, p);
      if (val) break;
    }
  } else {
    const parts = key.split(".");
    let cur: unknown = content;
    for (const p of parts) {
      if (cur == null || typeof cur !== "object") return "";
      cur = (cur as Record<string, unknown>)[p];
    }
    if (cur == null) return "";
    if (Array.isArray(cur)) {
      val = cur
        .map((v) => coerceLegadoMediaUrl(v))
        .filter(Boolean)
        .join("\n");
    } else if (typeof cur === "object") val = JSON.stringify(cur);
    else val = String(cur);
  }
  if (regex) val = applyRuleRegex(val, regex);
  return val;
}
