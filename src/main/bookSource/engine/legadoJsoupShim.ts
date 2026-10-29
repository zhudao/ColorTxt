import type { AnyNode, Element as DomElement } from "domhandler";
import type { Cheerio, CheerioAPI } from "cheerio";
import { getBookSourceJsHost } from "./bookSourceJsContext";
import { fetchViaChromiumNet } from "./chromiumNetFetch";
import { normalizeLegadoCssAttrContains } from "./legadoAttrSelector";
import { loadCheerioHtml } from "./legadoDefaultRule";
import { prepareSyncBookSourceHeaders } from "./syncBookSourceFetch";

/**
 * Legado / Rhino `org.jsoup.*` 兼容层（cheerio 实现）。
 * 书源常用：Jsoup.parse / Jsoup.connect().get() / select / selectFirst / attr / text
 */

type JsoupNode = {
  select(cssQuery: string): JsoupElements;
  selectFirst(cssQuery: string): JsoupElement | null;
  attr(attributeKey: string): string;
  text(): string;
  html(): string;
  outerHtml(): string;
  hasClass(className: string): boolean;
  id(): string;
  tagName(): string;
  className(): string;
  ownText(): string;
  parent(): JsoupElement | null;
  children(): JsoupElements;
  toString(): string;
  /** 对齐 Rhino：JSON.stringify(Element) → outerHtml 字符串 */
  toJSON(): string;
};

type JsoupElement = JsoupNode;

type JsoupElements = {
  size(): number;
  get(index: number): JsoupElement | null;
  first(): JsoupElement | null;
  last(): JsoupElement | null;
  select(cssQuery: string): JsoupElements;
  selectFirst(cssQuery: string): JsoupElement | null;
  attr(attributeKey: string): string;
  text(): string;
  html(): string;
  outerHtml(): string;
  hasClass(className: string): boolean;
  isEmpty(): boolean;
  toArray(): JsoupElement[];
  forEach(callback: (el: JsoupElement, index: number) => void): void;
  toString(): string;
  [Symbol.iterator](): Iterator<JsoupElement>;
};

function isElementNode(node: AnyNode | undefined | null): node is DomElement {
  return Boolean(node && node.type === "tag");
}

function wrapElement($: CheerioAPI, node: AnyNode): JsoupElement {
  const el = $(node);

  const api: JsoupElement = {
    select(cssQuery: string) {
      // Jsoup Collector：根节点自身若匹配也入选；cheerio.find 只含后代
      const css = normalizeLegadoCssAttrContains(cssQuery);
      const descendants = el.find(css);
      const merged = el.is(css) ? el.add(descendants) : descendants;
      return wrapElements($, merged);
    },
    selectFirst(cssQuery: string) {
      const all = api.select(cssQuery);
      return all.first();
    },
    attr(attributeKey: string) {
      return el.attr(attributeKey) ?? "";
    },
    text() {
      // 对齐 Jsoup：仅折叠 code≤0x20；保留全角空格（简介缩进）
      const raw = el
        .clone()
        .find("script, style, noscript")
        .remove()
        .end()
        .text();
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
    },
    html() {
      return el.html() ?? "";
    },
    outerHtml() {
      return $.html(node) ?? "";
    },
    hasClass(className: string) {
      return el.hasClass(className);
    },
    id() {
      return el.attr("id") ?? "";
    },
    tagName() {
      return isElementNode(node) ? node.name : "";
    },
    className() {
      return el.attr("class") ?? "";
    },
    ownText() {
      return el
        .contents()
        .filter((_, n) => n.type === "text")
        .text()
        .trim();
    },
    parent() {
      const p = el.parent().get(0);
      return p ? wrapElement($, p) : null;
    },
    children() {
      return wrapElements($, el.children());
    },
    toString() {
      return api.outerHtml();
    },
    /**
     * Rhino `JSON.stringify(javaElement)` 走 toString→outerHtml；
     * Node 原生 stringify 会把无枚举字段的对象收成 `{}`，须显式 toJSON。
     */
    toJSON() {
      return api.outerHtml();
    },
  };
  return api;
}

function defineNonEnum(
  obj: object,
  key: string | symbol,
  value: unknown,
): void {
  Object.defineProperty(obj, key, {
    configurable: true,
    writable: true,
    enumerable: false,
    value,
  });
}

/**
 * Jsoup Elements：须为**带数字下标的数组**，方法不可枚举。
 * 书源常用 `for (i in els) { els[i].attr(...) }`（Rhino 下 for-in 只扫下标）；
 * 若返回 `{ size, get, attr, … }` 普通对象，for-in 会扫到方法名，导致
 * `els[i].attr is not a function`。
 */
function wrapElements($: CheerioAPI, selection: Cheerio<AnyNode>): JsoupElements {
  const arr = selection.toArray().map((n) => wrapElement($, n)) as unknown as JsoupElement[] &
    JsoupElements;

  defineNonEnum(arr, "size", function (this: JsoupElement[]) {
    return this.length;
  });
  defineNonEnum(arr, "get", function (this: JsoupElement[], index: number) {
    return this[index] ?? null;
  });
  defineNonEnum(arr, "first", function (this: JsoupElement[] & JsoupElements) {
    return this.get(0);
  });
  defineNonEnum(arr, "last", function (this: JsoupElement[] & JsoupElements) {
    return this.length > 0 ? this.get(this.length - 1) : null;
  });
  defineNonEnum(arr, "select", (cssQuery: string) => {
    const css = normalizeLegadoCssAttrContains(cssQuery);
    const descendants = selection.find(css);
    const selfMatch = selection.filter((_, node) => $(node).is(css));
    const merged = selfMatch.length
      ? selfMatch.add(descendants)
      : descendants;
    return wrapElements($, merged);
  });
  defineNonEnum(arr, "selectFirst", (cssQuery: string) => {
    return (arr as JsoupElements).select(cssQuery).first();
  });
  defineNonEnum(arr, "attr", (attributeKey: string) => {
    return selection.first().attr(attributeKey) ?? "";
  });
  defineNonEnum(arr, "text", () => {
    // 勿用 cheerio `.map().get()`：部分路径会得到节点对象，`join` 成 `[object Object]`
    //（搜索规则用 Elements.text() 拼最新章日期时）
    const parts: string[] = [];
    selection.each((_, n) => {
      const t = wrapElement($, n).text();
      if (t) parts.push(t);
    });
    return parts.join(" ");
  });
  defineNonEnum(arr, "html", () => {
    const parts: string[] = [];
    selection.each((_, n) => {
      parts.push($(n).html() ?? "");
    });
    return parts.join("");
  });
  defineNonEnum(arr, "outerHtml", () => {
    const parts: string[] = [];
    selection.each((_, n) => {
      parts.push($.html(n) ?? "");
    });
    return parts.join("");
  });
  defineNonEnum(arr, "hasClass", (className: string) => {
    return selection.toArray().some((n) => $(n).hasClass(className));
  });
  defineNonEnum(arr, "isEmpty", function (this: JsoupElement[]) {
    return this.length === 0;
  });
  defineNonEnum(arr, "toArray", function (this: JsoupElement[]) {
    return this.slice();
  });
  defineNonEnum(
    arr,
    "forEach",
    function (
      this: JsoupElement[],
      callback: (el: JsoupElement, index: number) => void,
    ) {
      for (let i = 0; i < this.length; i++) {
        callback(this[i]!, i);
      }
    },
  );
  defineNonEnum(arr, "toString", function (this: JsoupElement[] & JsoupElements) {
    return this.outerHtml();
  });

  return arr;
}

function parseHtml(html: unknown): JsoupElement {
  const $ = loadCheerioHtml(String(html ?? ""));
  // Document：select 作用于整页（对齐 Jsoup.parse(html).select）
  const doc: JsoupElement = {
    select(cssQuery: string) {
      return wrapElements($, $(normalizeLegadoCssAttrContains(cssQuery)));
    },
    selectFirst(cssQuery: string) {
      const hit = $(normalizeLegadoCssAttrContains(cssQuery)).first();
      const raw = hit.get(0);
      return raw ? wrapElement($, raw) : null;
    },
    attr(attributeKey: string) {
      return $("html").attr(attributeKey) ?? "";
    },
    text() {
      return $.root()
        .clone()
        .find("script, style, noscript")
        .remove()
        .end()
        .text()
        .replace(/\s+/g, " ")
        .trim();
    },
    html() {
      return $("body").html() ?? $.root().html() ?? "";
    },
    outerHtml() {
      return $.html() ?? "";
    },
    hasClass(className: string) {
      return $("html").hasClass(className) || $("body").hasClass(className);
    },
    id() {
      return $("html").attr("id") ?? "";
    },
    tagName() {
      return "#document";
    },
    className() {
      return $("html").attr("class") ?? "";
    },
    ownText() {
      return "";
    },
    parent() {
      return null;
    },
    children() {
      return wrapElements($, $.root().children());
    },
    toString() {
      return doc.outerHtml();
    },
    toJSON() {
      return doc.outerHtml();
    },
  };
  return doc;
}

/** 是否为本引擎的 Jsoup Element 包装（勿当 JSON 对象 / contentIsJson） */
export function isJsoupElementLike(value: unknown): boolean {
  if (value == null || typeof value !== "object") return false;
  const o = value as { attr?: unknown; outerHtml?: unknown; select?: unknown };
  return (
    typeof o.attr === "function" &&
    typeof o.outerHtml === "function" &&
    typeof o.select === "function"
  );
}

/** 将 cheerio 选择结果转为 Jsoup Element 数组，供规则 JS `$[i].select()` / `.attr()` 使用 */
export function cheerioToJsoupList(
  $: CheerioAPI,
  selection: Cheerio<AnyNode>,
): unknown[] {
  return selection.toArray().map((n) => wrapElement($, n));
}

/**
 * 对齐 Legado `AnalyzeRule.getElement`（JSoup）：返回 Elements，可直接 `.text()` / `.attr()`。
 * 书源常见 `java.getElement("@@tag.a.0").text()`（如部分书源发现列表）。
 */
export function jsoupElementsFromElementList(elements: unknown[]): JsoupElements {
  const list = elements.filter(isJsoupElementLike) as JsoupElement[];
  const arr = list as unknown as JsoupElement[] & JsoupElements;

  defineNonEnum(arr, "size", function (this: JsoupElement[]) {
    return this.length;
  });
  defineNonEnum(arr, "get", function (this: JsoupElement[], index: number) {
    return this[index] ?? null;
  });
  defineNonEnum(arr, "first", function (this: JsoupElement[] & JsoupElements) {
    return this.get(0);
  });
  defineNonEnum(arr, "last", function (this: JsoupElement[] & JsoupElements) {
    return this.length > 0 ? this.get(this.length - 1) : null;
  });
  defineNonEnum(arr, "select", (cssQuery: string) => {
    const html = list.map((el) => el.outerHtml()).join("");
    if (!html.trim()) return jsoupElementsFromElementList([]);
    const $ = loadCheerioHtml(html);
    return wrapElements($, $(normalizeLegadoCssAttrContains(cssQuery)));
  });
  defineNonEnum(arr, "selectFirst", (cssQuery: string) => {
    return (arr as JsoupElements).select(cssQuery).first();
  });
  defineNonEnum(arr, "attr", (attributeKey: string) => {
    return list[0]?.attr(attributeKey) ?? "";
  });
  defineNonEnum(arr, "text", () => {
    const parts: string[] = [];
    for (const el of list) {
      const t = el.text();
      if (t) parts.push(t);
    }
    return parts.join(" ");
  });
  defineNonEnum(arr, "html", () => list.map((el) => el.html()).join(""));
  defineNonEnum(arr, "outerHtml", () =>
    list.map((el) => el.outerHtml()).join(""),
  );
  defineNonEnum(arr, "hasClass", (className: string) =>
    list.some((el) => el.hasClass(className)),
  );
  defineNonEnum(arr, "isEmpty", function (this: JsoupElement[]) {
    return this.length === 0;
  });
  defineNonEnum(arr, "toArray", function (this: JsoupElement[]) {
    return this.slice();
  });
  defineNonEnum(
    arr,
    "forEach",
    function (
      this: JsoupElement[],
      callback: (el: JsoupElement, index: number) => void,
    ) {
      for (let i = 0; i < this.length; i++) {
        callback(this[i]!, i);
      }
    },
  );
  defineNonEnum(arr, "toString", function (this: JsoupElement[] & JsoupElements) {
    return this.outerHtml();
  });

  return arr;
}

/**
 * `java.getElement` 返回值：HTML → Elements（可 .text/.attr）；JSON → 单对象或列表。
 */
export function asLegadoJavaGetElementResult(items: unknown[]): unknown {
  if (!items.length) return jsoupElementsFromElementList([]);
  if (items.every(isJsoupElementLike)) {
    return jsoupElementsFromElementList(items);
  }
  // 对齐 Legado AnalyzeByJSonPath.getObject：单结果直接返回
  if (items.length === 1) return items[0];
  return items;
}

/**
 * 部分书源对 `JSON.stringify(Elements)` 后再当 HTML 解析，
 * 依赖属性值被写成 `\&quot;…\&quot;` 的形态用正则取标题/链接。
 * Cheerio 直接解析 JSON 字符串会截断含空格的属性；先 JSON.parse 再拼 HTML 后，
 * 在规则 JS 里把干净的 `<a class="g">` 还原成正则期望的转义形态。
 *
 * 另：站点真实属性顺序常是「标题 data-* → base64 data-*」，而书源 try 分支正则
 * 假定 mangled class 后先出现 mangled base64、再出现明文标题；不重排则会
 * `match(...)[1]` 抛错、落入 catch 并用 `java.log(e)` 刷屏（功能仍可用）。
 */
export function mangleLegadoObfuscatedAnchorHtml(html: string): string {
  if (!/class\s*=\s*"g"/i.test(html)) return html;
  if (!/data-[a-z0-9]+\s*=\s*"[A-Za-z0-9+/]+={0,2}"/i.test(html)) return html;

  const base64AttrRe =
    /\s+(data-[a-z0-9]+)\s*=\s*"([A-Za-z0-9+/]+={0,2})"/gi;
  const base64Attrs: string[] = [];
  let withoutBase64 = html.replace(base64AttrRe, (_m, name: string, val: string) => {
    base64Attrs.push(` ${name}="\\&quot;${val}\\&quot;"`);
    return "";
  });
  if (!base64Attrs.length) return html;

  withoutBase64 = withoutBase64.replace(
    /class\s*=\s*"g"/gi,
    'class="\\&quot;g\\&quot;"',
  );

  // 插到 mangled class 之后，满足 try 正则：class → base64 → title
  return withoutBase64.replace(
    /class="\\&quot;g\\&quot;"/i,
    (m) => `${m}${base64Attrs.join("")}`,
  );
}

/**
 * 对齐 Legado/Rhino：JSON 对象作规则链 result 时，Java Map.toString 形如
 * `{firstImageUrl=["",""], bigAvaImg=http://…, blogInfo={…}}`（数组值近 Gson）。
 * 书源常用 `result.match(/firstImageUrl=…/)`，裸 object 无 match。
 */
export function legadoJavaMapStyleString(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return `[${value.map((v) => legadoJavaMapStyleString(v)).join(", ")}]`;
    }
  }
  if (typeof value === "object") {
    if (isJsoupElementLike(value)) {
      try {
        return String((value as { outerHtml: () => string }).outerHtml() ?? "");
      } catch {
        return String(value);
      }
    }
    const entries: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "function") continue;
      entries.push(`${k}=${legadoJavaMapStyleString(v)}`);
    }
    return `{${entries.join(", ")}}`;
  }
  return String(value);
}

const LEGADO_STRING_METHOD_NAMES = new Set([
  "match",
  "replace",
  "replaceAll",
  "split",
  "indexOf",
  "lastIndexOf",
  "substring",
  "substr",
  "slice",
  "trim",
  "trimStart",
  "trimEnd",
  "charAt",
  "charCodeAt",
  "startsWith",
  "endsWith",
  "includes",
  "concat",
  "toLowerCase",
  "toUpperCase",
  "padStart",
  "padEnd",
  "repeat",
  "search",
  "localeCompare",
]);

/**
 * 纯 JSON 对象：保留字段访问，并挂上 String 方法（对 Map 风格 toString 生效）。
 */
export function wrapLegadoJsonResultForJs(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const mapStr = (): string => legadoJavaMapStyleString(value);
  return new Proxy(value, {
    get(target, prop, receiver) {
      if (prop === Symbol.toPrimitive) {
        return (_hint?: string) => mapStr();
      }
      if (prop === "toString" || prop === "valueOf") {
        return () => mapStr();
      }
      if (typeof prop === "string" && LEGADO_STRING_METHOD_NAMES.has(prop)) {
        const fn = (String.prototype as unknown as Record<string, unknown>)[prop];
        if (typeof fn === "function") {
          return (fn as (...args: unknown[]) => unknown).bind(mapStr());
        }
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Record<string, unknown>;
}

/** 规则 JS 的 result/src：Element 需保留 .attr；仅字符串侧做混淆锚点转义兼容 */
export function bindJsHtmlValue(value: unknown): unknown {
  // 对齐 Legado getString 链：JsonPath 标量进 @js 须为字符串（部分书源 bid→s.slice）
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    // 对齐 Java AbstractCollection/Elements.toString：`[html1, html2]`（逗号+空格）
    // 部分书源书源：`String(result).slice(1,-1).split(/, (?=<li…)/)`
    if (
      value.length > 0 &&
      value.every(
        (x) =>
          isJsoupElementLike(x) ||
          (typeof x === "string" && /^\s*</.test(x)),
      )
    ) {
      return wrapLegadoHtmlListForJs(value);
    }
    return value;
  }
  if (isJsoupElementLike(value)) {
    const clean = String(
      (value as { outerHtml: () => string }).outerHtml() ?? "",
    );
    const mangled = mangleLegadoObfuscatedAnchorHtml(clean);
    if (mangled === clean) return value;
    // 字段规则 JS 只用 String(result)/正则；换成 mangled 字符串以免丢标题
    return mangled;
  }
  if (typeof value === "string") return mangleLegadoObfuscatedAnchorHtml(value);
  // JSON 列表项 / $.post 等：须能 result.match / result.replace（部分书源 coverUrl 等）
  if (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { match?: unknown }).match !== "function"
  ) {
    return wrapLegadoJsonResultForJs(value as Record<string, unknown>);
  }
  return value;
}

/**
 * 规则链 XPath/Default getElements → @js：`String(result)` 须像 Java Elements
 * `[el1, el2, …]`，不能是 JS Array 的无括号逗号拼接。
 */
function wrapLegadoHtmlListForJs(items: unknown[]): unknown[] {
  const texts = items.map((item) => {
    if (isJsoupElementLike(item)) {
      try {
        return String(
          (item as { outerHtml: () => string }).outerHtml() ?? "",
        );
      } catch {
        return String(item ?? "");
      }
    }
    return String(item ?? "");
  });
  const arr = items.slice() as unknown[];
  defineNonEnum(arr, "toString", () => `[${texts.join(", ")}]`);
  defineNonEnum(arr, "valueOf", () => `[${texts.join(", ")}]`);
  return arr;
}

/**
 * 对齐 org.jsoup.Jsoup.connect(url)：可链式 header/timeout，`.get()`/`.post()` 同步拉页并 parse。
 * 常见用法：`org.jsoup.Jsoup.connect(url).get()` 后接选择器规则。
 */
function createJsoupConnection(url: string): Record<string, unknown> {
  const state: {
    url: string;
    headers: Record<string, string>;
    method: string;
    body: string | null;
  } = {
    url: String(url ?? "").trim(),
    headers: {},
    method: "GET",
    body: null,
  };

  const self: Record<string, unknown> = {};
  const chain = (): typeof self => self;

  /**
   * 异步拉页（`fetchViaChromiumNet`）。勿用 spawnSync：搜索 lastChapter 等
   * 会对每条结果 `.get()`，同步子进程会卡死主进程 UI。
   * 规则侧由 `injectLegadoAsyncAwaits` 自动补 `await`。
   */
  const fetchDocument = async (): Promise<JsoupElement> => {
    if (!state.url) return parseHtml("");
    const host = getBookSourceJsHost();
    const headers = prepareSyncBookSourceHeaders(
      state.url,
      { ...state.headers },
      host?.source,
    );
    const res = await fetchViaChromiumNet({
      url: state.url,
      method: state.method,
      headers,
      body: state.body,
    });
    return parseHtml(res.body);
  };

  Object.assign(self, {
    url(u: unknown) {
      state.url = String(u ?? "").trim();
      return chain();
    },
    userAgent(ua: unknown) {
      state.headers["User-Agent"] = String(ua ?? "");
      return chain();
    },
    header(name: unknown, value: unknown) {
      state.headers[String(name ?? "")] = String(value ?? "");
      return chain();
    },
    headers(map: unknown) {
      if (map && typeof map === "object") {
        for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
          state.headers[k] = String(v ?? "");
        }
      }
      return chain();
    },
    timeout(_ms: unknown) {
      return chain();
    },
    ignoreContentType(_v?: unknown) {
      return chain();
    },
    ignoreHttpErrors(_v?: unknown) {
      return chain();
    },
    followRedirects(_v?: unknown) {
      return chain();
    },
    referrer(ref: unknown) {
      state.headers.Referer = String(ref ?? "");
      return chain();
    },
    cookie(name: unknown, value: unknown) {
      const prev = state.headers.Cookie ?? state.headers.cookie ?? "";
      const pair = `${String(name ?? "")}=${String(value ?? "")}`;
      state.headers.Cookie = prev ? `${prev}; ${pair}` : pair;
      return chain();
    },
    method(m: unknown) {
      state.method = String(m ?? "GET").toUpperCase();
      return chain();
    },
    requestBody(body: unknown) {
      state.body = body == null ? null : String(body);
      return chain();
    },
    data(body: unknown) {
      state.body = body == null ? null : String(body);
      if (state.method === "GET") state.method = "POST";
      return chain();
    },
    postData(body: unknown) {
      state.body = body == null ? null : String(body);
      state.method = "POST";
      return chain();
    },
    get() {
      state.method = "GET";
      state.body = null;
      return fetchDocument();
    },
    post() {
      state.method = "POST";
      return fetchDocument();
    },
    async execute() {
      const doc = await fetchDocument();
      return {
        statusCode: () => 200,
        body: () => doc.outerHtml(),
        parse: () => doc,
      };
    },
  });
  return self;
}

/** 顶层 `org` / `Packages.org` */
export function createOrgPackage(): Record<string, unknown> {
  return {
    jsoup: {
      Jsoup: {
        parse: parseHtml,
        connect(url: unknown) {
          return createJsoupConnection(String(url ?? ""));
        },
      },
    },
  };
}
