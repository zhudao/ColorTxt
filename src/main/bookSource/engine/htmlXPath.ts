import { DOMParser, XMLSerializer, type Document } from "@xmldom/xmldom";
import * as cheerio from "cheerio";
import xpath from "xpath";

/** 忽略 xmldom 解析告警，避免控制台刷屏 */
const silentOnError = (
  _level: "warning" | "error" | "fatalError",
  _msg: string,
  _context: unknown,
): void => {};

/** HTML 中裸 &（非合法实体）转义，避免 xmldom 刷屏 entity not found */
export function escapeBareAmpersands(html: string): string {
  return html.replace(/&(?!([a-zA-Z][a-zA-Z0-9]*|#\d+|#x[\da-fA-F]+);)/g, "&amp;");
}

/**
 * xmldom 遇到未声明前缀的属性（如 SVG `xlink:href` 无 `xmlns:xlink`）会抛
 * `NamespaceError: prefix is non-null and namespace is null`，整页 XPath 失败
 *（部分书源目录 `//ol[@id=chapterList]/*`）。
 */
export function ensureXmldomNamespaceDecls(html: string): string {
  let s = html;
  if (/\bxlink:/i.test(s) && !/\bxmlns:xlink\s*=/i.test(s)) {
    if (/<html\b/i.test(s)) {
      s = s.replace(
        /<html\b([^>]*)>/i,
        `<html$1 xmlns:xlink="http://www.w3.org/1999/xlink">`,
      );
    } else {
      s = `<?xml version="1.0" encoding="UTF-8"?><html xmlns:xlink="http://www.w3.org/1999/xlink">${s}</html>`;
    }
  }
  return s;
}

function prepareHtmlForXmldom(html: string): string {
  return escapeBareAmpersands(ensureXmldomNamespaceDecls(html));
}

export function parseHtmlDocument(html: string): Document {
  const parser = new DOMParser({ onError: silentOnError });
  try {
    return parser.parseFromString(prepareHtmlForXmldom(html), "text/html");
  } catch {
    // 结构破损页面（如 </br>、标签错配）xmldom 会直接抛 fatalError，
    // 导致 nextContentUrl 等 XPath 静默取空；先经 cheerio/parse5 纠错重排再解析
    const fixed = cheerio.load(html).html() ?? html;
    try {
      return parser.parseFromString(prepareHtmlForXmldom(fixed), "text/html");
    } catch {
      // 仍失败时再剥未声明前缀属性（xlink:href → xlink-href）
      const stripped = prepareHtmlForXmldom(fixed).replace(
        /\s([a-zA-Z_][\w.-]*):([a-zA-Z_][\w.-]*)(\s*=\s*(?:"[^"]*"|'[^']*'))/g,
        (full, prefix: string, local: string, eq: string) => {
          if (String(prefix).toLowerCase() === "xmlns") return full;
          return ` ${prefix}-${local}${eq}`;
        },
      );
      return parser.parseFromString(stripped, "text/html");
    }
  }
}

/**
 * xmldom 以 text/html 解析时会挂上 XHTML 默认命名空间，xpath 的 `//ul` 匹配不到节点，
 * 而 `//*[local-name()='ul']` 可以。将路径步中的元素名改写为 local-name 形式。
 * （对齐 Legado/Jsoup：HTML 无命名空间语义。）
 */
export function xpathIgnoreXhtmlDefaultNs(expr: string): string {
  const reserved = new Set([
    "and",
    "or",
    "not",
    "div",
    "mod",
    "true",
    "false",
    "text",
    "node",
    "comment",
    "processing-instruction",
    "ancestor",
    "ancestor-or-self",
    "attribute",
    "child",
    "descendant",
    "descendant-or-self",
    "following",
    "following-sibling",
    "namespace",
    "parent",
    "preceding",
    "preceding-sibling",
    "self",
    "contains",
    "starts-with",
    "string",
    "concat",
    "substring",
    "substring-before",
    "substring-after",
    "string-length",
    "normalize-space",
    "translate",
    "boolean",
    "number",
    "sum",
    "floor",
    "ceiling",
    "round",
    "count",
    "position",
    "last",
    "local-name",
    "namespace-uri",
    "name",
    "id",
  ]);

  let out = "";
  let i = 0;
  while (i < expr.length) {
    const axis = expr.slice(i).match(/^(?:\/\/|\/|\.\.\/|\.\/)/);
    if (axis) {
      out += axis[0];
      i += axis[0].length;
      continue;
    }
    if (expr[i] === "@") {
      const m = expr.slice(i).match(/^@[\w:-]+/);
      out += m ? m[0] : expr[i];
      i += m ? m[0].length : 1;
      continue;
    }
    if (expr[i] === '"' || expr[i] === "'") {
      const q = expr[i]!;
      let j = i + 1;
      while (j < expr.length && expr[j] !== q) j++;
      out += expr.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const prev = out.slice(-1);
    const name = expr.slice(i).match(/^[A-Za-z_][\w.-]*/);
    if (
      name &&
      (out === "" ||
        prev === "/" ||
        prev === "(" ||
        /\s$/.test(out) ||
        out.endsWith("::"))
    ) {
      const n = name[0]!;
      const lower = n.toLowerCase();
      const next = expr[i + n.length];
      const isFunc = next === "(";
      const isAxis = expr.slice(i + n.length, i + n.length + 2) === "::";
      // `div` 作运算符：前后空白（非路径步）
      const asOperator =
        lower === "div" &&
        /\s$/.test(out) &&
        (next === undefined || /\s/.test(next));
      if (
        !isFunc &&
        !isAxis &&
        !asOperator &&
        !(reserved.has(lower) && (/\s$/.test(out) || out === ""))
      ) {
        if (prev === "/" || out === "" || out.endsWith("::") || prev === "(") {
          out += `*[local-name()='${n}']`;
          i += n.length;
          continue;
        }
      }
      out += n;
      i += n.length;
      continue;
    }
    out += expr[i];
    i++;
  }
  return out;
}

/**
 * 部分书源常用的 og:meta XPath，用 cheerio 解析（对齐 Legado + Jsoup 的容错）。
 */
export function xpathViaCheerio(
  rule: string,
  html: string,
  list: boolean,
): unknown | undefined {
  const trimmed = rule.trim();
  const metaAttr = trimmed.match(
    /^\/\/meta\[(@property|@name)=['"]([^'"]+)['"]\]\/@(\w+)$/,
  );
  if (metaAttr) {
    const attrName = metaAttr[1].slice(1);
    const attrVal = metaAttr[2];
    const pick = metaAttr[3];
    const $ = cheerio.load(html);
    const val =
      $(`meta[${attrName}="${attrVal}"]`).attr(pick) ??
      $(`meta[${attrName}='${attrVal}']`).attr(pick) ??
      "";
    return list ? (val ? [val] : []) : val;
  }

  const metaText = trimmed.match(
    /^\/\/meta\[(@property|@name)=['"]([^'"]+)['"]\]\/(?:text\(\)|@content)$/,
  );
  if (metaText) {
    const attrName = metaText[1].slice(1);
    const attrVal = metaText[2];
    const $ = cheerio.load(html);
    const val =
      $(`meta[${attrName}="${attrVal}"]`).attr("content")?.trim() ?? "";
    return list ? (val ? [val] : []) : val;
  }

  // xmldom 解析 HTML 时会丢弃 <script>，Legado/Jsoup 仍可读取 script 文本
  if (/^\/\/script\/text\(\)$/.test(trimmed)) {
    const $ = cheerio.load(html);
    const texts: string[] = [];
    $("script").each((_, el) => {
      const t = $(el).text().trim();
      if (t) texts.push(t);
    });
    return list ? texts : (texts[0] ?? "");
  }

  // //ol[@id="chapterList"]/* 等：用 cheerio 取子节点（避免 xmldom 命名空间整页失败）
  const idChildren = trimmed.match(
    /^\/\/(?:\*|[A-Za-z_][\w.-]*)\[@id=['"]([^'"]+)['"]\]\/\*$/,
  );
  if (idChildren) {
    const $ = cheerio.load(html);
    const kids = $(`[id="${idChildren[1]}"]`).children();
    if (list) {
      return kids.toArray().map((n) => $.html(n) ?? "").filter(Boolean);
    }
    return kids
      .map((_, n) => $(n).text().trim())
      .get()
      .filter(Boolean)
      .join("\n");
  }

  return undefined;
}

function normalizeXPathNodes(raw: unknown): Node[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw as Node[];
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return [];
  }
  return [raw as Node];
}

function serializeXPathNode(node: Node): string {
  const nt = (node as { nodeType?: number }).nodeType;
  // ATTRIBUTE_NODE
  if (nt === 2) {
    return (
      (node as { value?: string; nodeValue?: string }).value ??
      (node as { nodeValue?: string }).nodeValue ??
      ""
    );
  }
  // TEXT_NODE / CDATA
  if (nt === 3 || nt === 4) {
    return (node as { nodeValue?: string }).nodeValue ?? "";
  }
  // ELEMENT_NODE：getElements 需要可再被 Default 规则解析的 HTML 片段
  if (nt === 1) {
    try {
      let html = new XMLSerializer().serializeToString(node as never);
      html = html.replace(/\sxmlns(?::\w+)?="[^"]*"/g, "");
      return html;
    } catch {
      return textOfXPathNode(node);
    }
  }
  return textOfXPathNode(node);
}

/**
 * JsoupXpath（Legado AnalyzeByXPath）扩展函数，标准 XPath 无此语法：
 * - `html()` / `html`：内部 HTML
 * - `outerHtml()`：含自身标签的 HTML
 * - `allText()`：节点下全部文本
 * 例：`//div[@class='content']/html()`
 */
export function splitJsoupXPathExtract(rule: string): {
  baseRule: string;
  extract: "html" | "outerHtml" | "allText" | null;
} {
  const trimmed = rule.trim();
  const m = trimmed.match(/^(.*)\/(html|outerHtml|allText)\(\)?$/i);
  if (!m?.[1]?.trim() || !m[2]) {
    return { baseRule: trimmed, extract: null };
  }
  const name = m[2].toLowerCase();
  const extract =
    name === "html"
      ? "html"
      : name === "outerhtml"
        ? "outerHtml"
        : name === "alltext"
          ? "allText"
          : null;
  if (!extract) return { baseRule: trimmed, extract: null };
  return { baseRule: m[1].trim(), extract };
}

function innerHtmlOfElementNode(node: Node): string {
  const nt = (node as { nodeType?: number }).nodeType;
  if (nt !== 1) return textOfXPathNode(node);
  const children = (node as { childNodes?: ArrayLike<Node> }).childNodes;
  if (!children?.length) return "";
  const ser = new XMLSerializer();
  let out = "";
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child) continue;
    try {
      out += ser.serializeToString(child as never);
    } catch {
      out += textOfXPathNode(child);
    }
  }
  return out.replace(/\sxmlns(?::\w+)?="[^"]*"/g, "");
}

function applyJsoupXPathExtract(
  node: Node,
  extract: "html" | "outerHtml" | "allText",
): string {
  if (extract === "html") return innerHtmlOfElementNode(node);
  if (extract === "outerHtml") return serializeXPathNode(node);
  return textOfXPathNode(node);
}

export function selectXPath(
  rule: string,
  html: string,
  list: boolean,
): unknown {
  const viaCheerio = xpathViaCheerio(rule, html, list);
  if (viaCheerio !== undefined) return viaCheerio;

  const { baseRule, extract } = splitJsoupXPathExtract(rule);
  const doc = parseHtmlDocument(html);
  const expr = xpathIgnoreXhtmlDefaultNs(baseRule);
  let raw: unknown;
  try {
    raw = xpath.select(expr, doc as unknown as Node);
  } catch {
    return list ? [] : "";
  }
  const nodes = normalizeXPathNodes(raw);
  if (!nodes.length) return list ? [] : "";

  if (extract) {
    const parts = nodes.map((n) => applyJsoupXPathExtract(n, extract));
    if (list) return parts;
    return parts.join("\n");
  }

  if (list) {
    // getElements：元素序列化为 HTML；属性/文本节点仍为字符串
    return nodes.map(serializeXPathNode);
  }
  // 对齐 Legado AnalyzeByXPath.getString：多节点用 \n 拼接（如 //*[@id=content]/p/text()）
  if (nodes.length === 1) return textOfXPathNode(nodes[0]!);
  return nodes.map(textOfXPathNode).join("\n");
}

function textOfXPathNode(node: Node): string {
  if ("textContent" in node) {
    return (node as { textContent?: string }).textContent ?? "";
  }
  if ("nodeValue" in node && (node as { nodeValue?: string }).nodeValue != null) {
    return String((node as { nodeValue?: string }).nodeValue);
  }
  if ("value" in node && (node as { value?: string }).value != null) {
    return String((node as { value?: string }).value);
  }
  return "";
}
