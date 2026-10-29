import type { Cheerio } from "cheerio";

/**
 * 对齐 Jsoup 1.16.2（Legado 所用版本）默认 OutputSettings 的 pretty-print 序列化。
 *
 * Legado `@html` / `@all` 走 Jsoup `Elements.outerHtml()`，其换行/缩进决定了
 * 书源 `##` 替换正则（默认 `.` 不跨行）能看到的“行”边界：
 * 例如分页站点常用 `##(\s*.*【1】.*)?\s*标记` 清理分页导航——Jsoup 输出里
 * 分页导航独占一行，正则只吃掉那一行；而 cheerio 原样序列化时导航与正文
 * 末句同行，会把最后一句正文一并删掉。
 *
 * `script` / `style` 子节点对齐 Jsoup DataNode：原样输出，不实体转义、不折叠空白。
 */

/** Jsoup Tag.java blockTags：isBlock=true 且默认 formatAsBlock=true */
const JSOUP_BLOCK_TAGS = new Set([
  "html", "head", "body", "frameset", "script", "noscript", "style", "meta",
  "link", "title", "frame", "noframes", "section", "nav", "aside", "hgroup",
  "header", "footer", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol",
  "pre", "div", "blockquote", "hr", "address", "figure", "figcaption", "form",
  "fieldset", "ins", "del", "dl", "dt", "dd", "li", "table", "caption",
  "thead", "tfoot", "tbody", "colgroup", "col", "tr", "th", "td", "video",
  "audio", "canvas", "details", "menu", "plaintext", "template", "article",
  "main", "svg", "math", "center", "dir", "applet", "marquee", "listing",
]);

/** Jsoup inlineTags ∪ formatAsInlineTags：formatAsBlock=false */
const JSOUP_FORMAT_INLINE_TAGS = new Set([
  // inlineTags
  "object", "base", "font", "tt", "i", "b", "u", "big", "small", "em",
  "strong", "dfn", "code", "samp", "kbd", "var", "cite", "abbr", "time",
  "acronym", "mark", "ruby", "rt", "rp", "rtc", "a", "img", "br", "wbr",
  "map", "q", "sub", "sup", "bdo", "iframe", "embed", "span", "input",
  "select", "textarea", "label", "button", "optgroup", "option", "legend",
  "datalist", "keygen", "output", "progress", "meter", "area", "param",
  "source", "track", "summary", "command", "device", "basefont", "bgsound",
  "menuitem", "data", "bdi", "s", "strike", "nobr", "rb", "text",
  "mi", "mo", "msup", "mn", "mtext",
  // formatAsInlineTags
  "title", "p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "address",
  "li", "th", "td", "script", "style", "ins", "del",
]);

/** Jsoup emptyTags：void 元素，html 语法下输出 `<br>`（无闭合） */
const JSOUP_EMPTY_TAGS = new Set([
  "meta", "link", "base", "frame", "img", "br", "wbr", "embed", "hr",
  "input", "keygen", "col", "command", "device", "area", "basefont",
  "bgsound", "menuitem", "param", "source", "track",
]);

const JSOUP_PRESERVE_WS_TAGS = new Set(["pre", "plaintext", "title", "textarea"]);

/** 未知标签 Tag.valueOf：isBlock=false（isInline=true）、formatAsBlock=true */
function tagIsBlock(name: string): boolean {
  return JSOUP_BLOCK_TAGS.has(name);
}
function tagIsInline(name: string): boolean {
  return !tagIsBlock(name);
}
function tagFormatAsBlock(name: string): boolean {
  return !JSOUP_FORMAT_INLINE_TAGS.has(name);
}

type AnyNode = {
  type?: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: AnyNode[];
  parent?: AnyNode | null;
  prev?: AnyNode | null;
  next?: AnyNode | null;
};

function isElementNode(node: AnyNode | null | undefined): boolean {
  const t = node?.type;
  return t === "tag" || t === "script" || t === "style";
}

function elementName(node: AnyNode): string {
  return String(node.name ?? "").toLowerCase();
}

/** StringUtil.isWhitespace：仅 ASCII 空白（不含 nbsp / 全角空格） */
function isJsoupWhitespaceCode(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d;
}

function isBlankText(node: AnyNode): boolean {
  const data = typeof node.data === "string" ? node.data : "";
  for (let i = 0; i < data.length; i++) {
    if (!isJsoupWhitespaceCode(data.charCodeAt(i))) return false;
  }
  return true;
}

/** Element.preserveWhitespace：向上找 pre/textarea 等祖先 */
function inPreserveWhitespace(node: AnyNode | null | undefined): boolean {
  let cur = node;
  let hops = 0;
  while (cur && hops < 6) {
    if (isElementNode(cur) && JSOUP_PRESERVE_WS_TAGS.has(elementName(cur))) {
      return true;
    }
    cur = cur.parent ?? null;
    hops += 1;
  }
  return false;
}

function parentElement(node: AnyNode): AnyNode | null {
  const p = node.parent;
  return p && isElementNode(p) ? p : null;
}

/** Node.isEffectivelyFirst：首个子节点，或仅隔一个空白文本节点 */
function isEffectivelyFirst(node: AnyNode): boolean {
  const prev = node.prev ?? null;
  if (!prev) return true;
  const prev2 = prev.prev ?? null;
  return !prev2 && prev.type === "text" && isBlankText(prev);
}

/** Element.isFormatAsBlock（outline 恒为 false） */
function isFormatAsBlock(node: AnyNode): boolean {
  if (tagIsBlock(elementName(node))) return true;
  const parent = parentElement(node);
  return parent != null && tagFormatAsBlock(elementName(parent));
}

/** Element.isInlineable */
function isInlineable(node: AnyNode): boolean {
  const name = elementName(node);
  if (!tagIsInline(name)) return false;
  const parent = parentElement(node);
  return (
    (parent == null || tagIsBlock(elementName(parent))) &&
    !isEffectivelyFirst(node) &&
    name !== "br"
  );
}

function shouldIndent(node: AnyNode): boolean {
  return (
    isFormatAsBlock(node) && !isInlineable(node) && !inPreserveWhitespace(node.parent)
  );
}

/** 累积器：记录总长度，供“accum 非空才换行”的判断 */
type Accum = { parts: string[]; len: number };

function push(out: Accum, s: string): void {
  if (!s) return;
  out.parts.push(s);
  out.len += s.length;
}

/** indentAmount=1、maxPaddingWidth=30 */
function indent(out: Accum, depth: number): void {
  push(out, "\n" + " ".repeat(Math.min(depth, 30)));
}

/** Entities.escape（html 语法 / base 模式 / UTF-8） */
function escapeHtml(
  text: string,
  inAttribute: boolean,
  normaliseWhite: boolean,
  stripLeading: boolean,
  trimTrailing: boolean,
): string {
  let out = "";
  let lastWasWhite = false;
  let reachedNonWhite = false;
  let skipped = false;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (normaliseWhite) {
      if (isJsoupWhitespaceCode(c)) {
        if (stripLeading && !reachedNonWhite) continue;
        if (lastWasWhite) continue;
        if (trimTrailing) {
          skipped = true;
          continue;
        }
        out += " ";
        lastWasWhite = true;
        continue;
      }
      lastWasWhite = false;
      reachedNonWhite = true;
      if (skipped) {
        out += " ";
        skipped = false;
      }
    }
    // 隐形字符（zero width space / soft hyphen）
    if (c === 8203 || c === 173) continue;
    if (c === 0x26) out += "&amp;";
    else if (c === 0xa0) out += "&nbsp;";
    else if (c === 0x3c) out += inAttribute ? "<" : "&lt;";
    else if (c === 0x3e) out += inAttribute ? ">" : "&gt;";
    else if (c === 0x22) out += inAttribute ? "&quot;" : '"';
    else out += ch;
  }
  return out;
}

function serializeAttributes(node: AnyNode, out: Accum): void {
  const attribs = node.attribs ?? {};
  for (const key of Object.keys(attribs)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_:.-]*$/.test(key)) continue;
    const val = attribs[key] ?? "";
    push(out, ` ${key}="${escapeHtml(val, true, false, false, false)}"`);
  }
}

function serializeText(node: AnyNode, out: Accum, depth: number): void {
  const data = typeof node.data === "string" ? node.data : "";
  const parent = parentElement(node);
  const normaliseWhite = !inPreserveWhitespace(node.parent);
  const parentName = parent ? elementName(parent) : "";
  const trimLikeBlock =
    parent != null && (tagIsBlock(parentName) || tagFormatAsBlock(parentName));
  let trimLeading = false;
  let trimTrailing = false;
  const first = !node.prev;
  const blank = isBlankText(node);

  if (normaliseWhite) {
    trimLeading = (trimLikeBlock && first) || node.parent?.type === "root";
    trimTrailing = trimLikeBlock && !node.next;

    // 空白文本节点：若相邻节点已换行/是块级，直接跳过（避免多余空行）
    const next = node.next ?? null;
    const prev = node.prev ?? null;
    const couldSkip =
      (next != null && isElementNode(next) && shouldIndent(next)) ||
      (next != null && next.type === "text" && isBlankText(next)) ||
      (prev != null &&
        isElementNode(prev) &&
        (tagIsBlock(elementName(prev)) || elementName(prev) === "br"));
    if (couldSkip && blank) return;

    if (
      (first && parent != null && tagFormatAsBlock(parentName) && !blank) ||
      (!first && prev != null && isElementNode(prev) && elementName(prev) === "br")
    ) {
      indent(out, depth);
    }
  }

  push(out, escapeHtml(data, false, normaliseWhite, trimLeading, trimTrailing));
}

function serializeNode(node: AnyNode, out: Accum, depth: number): void {
  const type = node.type;
  if (type === "text") {
    serializeText(node, out, depth);
    return;
  }
  if (type === "comment") {
    const parent = parentElement(node);
    if (parent && isEffectivelyFirst(node) && tagFormatAsBlock(elementName(parent))) {
      indent(out, depth);
    }
    push(out, `<!--${node.data ?? ""}-->`);
    return;
  }
  if (type === "directive" || type === "cdata") {
    return;
  }
  if (!isElementNode(node)) return;

  const name = elementName(node);
  const children = node.children ?? [];

  if (shouldIndent(node) && out.len > 0) {
    indent(out, depth);
  }
  push(out, `<${name}`);
  serializeAttributes(node, out);
  const isEmptyTag = JSOUP_EMPTY_TAGS.has(name);
  if (!children.length && isEmptyTag) {
    push(out, ">");
    return;
  }
  push(out, ">");
  // Jsoup：script/style 内容为 DataNode，outerHtml 原样写出（勿 escape / 折叠空白）
  if (name === "script" || name === "style") {
    for (const child of children) {
      if (child.type === "text") {
        push(out, typeof child.data === "string" ? child.data : "");
      }
    }
    push(out, `</${name}>`);
    return;
  }
  for (const child of children) serializeNode(child, out, depth + 1);
  if (
    children.length &&
    tagFormatAsBlock(name) &&
    !inPreserveWhitespace(node.parent)
  ) {
    indent(out, depth);
  }
  push(out, `</${name}>`);
}

/** Jsoup `Element.outerHtml()`（pretty-print） */
export function jsoupPrettyOuterHtml(node: unknown): string {
  const out: Accum = { parts: [], len: 0 };
  serializeNode(node as AnyNode, out, 0);
  return out.parts.join("");
}

/** Jsoup `Elements.outerHtml()`：多元素以 `\n` 相接 */
export function jsoupPrettyElementsOuterHtml(el: Cheerio<any>): string {
  const parts: string[] = [];
  el.each((_, node) => {
    parts.push(jsoupPrettyOuterHtml(node));
  });
  return parts.join("\n");
}
