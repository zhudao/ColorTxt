/**
 * Markdown 内链 sidecar 与 Monaco 装饰共用类型。
 * 链接/图标链解析基于 marked `Lexer.lexInline`（与 AI 助手同一套 Markdown 规则）。
 */

import { Lexer, type Tokens } from "marked";

export const MD_FOOTNOTE_HOVER_MAX_CHARS = 600;

/** 带图标的内链在 Monaco 中的单字占位（全角空格，与 1em 图标宽对齐） */
export const MD_LINK_ICON_PLACEHOLDER = "\u3000";

export type MdInternalLinkOccurrence = {
  physicalLine: number;
  startColumn: number;
  endColumnExclusive: number;
  targetId: string;
  label: string;
  iconRel?: string;
  hoverTip?: string;
  builtinLinkIcon?: boolean;
  /** `http(s):` / `mailto:` 外链；有值时点击用系统浏览器打开 */
  externalUrl?: string;
  /** 行内字形图 `![alt](url)`（非链接、非独占行插图） */
  inlineImage?: boolean;
};

export type MdCompactLinkHit = {
  startColumn: number;
  endColumnExclusive: number;
  targetId: string;
  iconRel?: string;
  label?: string;
  hoverTip?: string;
  builtinLinkIcon?: boolean;
  externalUrl?: string;
  inlineImage?: boolean;
};

export type MdInternalLinkSidecar = {
  idToPhysicalLine: Map<string, number>;
  hitsByDisplayLine: Map<number, MdCompactLinkHit[]>;
  leadingMdLinkLabelsByDisplayLine: Map<number, string[]>;
};

export function createMdInternalLinkSidecar(): MdInternalLinkSidecar {
  return {
    idToPhysicalLine: new Map(),
    hitsByDisplayLine: new Map(),
    leadingMdLinkLabelsByDisplayLine: new Map(),
  };
}

export function isFootnoteRefFragment(frag: string): boolean {
  const f = frag.trim();
  return (
    /^fr_/i.test(f) ||
    /^er_/i.test(f) ||
    /^footnote_ref_/i.test(f) ||
    /^endnote_ref_/i.test(f)
  );
}

/** 悬停展示纯文本不渲染 Monaco 内链图标，去掉展示层占位避免大片空白 */
export function stripMdLinkDisplayPlaceholdersFromText(text: string): string {
  let s = text.split(MD_LINK_ICON_PLACEHOLDER).join("");
  s = s.split(MD_LINK_EMPTY_PLACEHOLDER).join("");
  return s.trim();
}

export function extractMdFootnoteHoverTextFromLine(rawLine: string): string {
  const visible = stripMdLinkDisplayPlaceholdersFromText(rawLine);
  if (!visible) return "";
  return visible.length > MD_FOOTNOTE_HOVER_MAX_CHARS
    ? visible.slice(0, MD_FOOTNOTE_HOVER_MAX_CHARS)
    : visible;
}

export type MdLinkHoverMessageOptions = {
  resolveFootnoteLineText?: (targetId: string) => string | undefined;
};

export function mdLinkDecorationHoverMessage(
  hit: Pick<
    MdCompactLinkHit,
    | "label"
    | "hoverTip"
    | "builtinLinkIcon"
    | "targetId"
    | "iconRel"
    | "externalUrl"
    | "inlineImage"
  >,
  options?: MdLinkHoverMessageOptions,
): string {
  const externalUrl = hit.externalUrl?.trim();
  if (externalUrl) {
    const tip = hit.hoverTip?.trim() || hit.label?.trim();
    return tip && tip !== "·" ? `${tip}\n${externalUrl}` : externalUrl;
  }
  if (hit.inlineImage) {
    return hit.hoverTip?.trim() || hit.label?.trim() || "";
  }
  const targetId = hit.targetId?.trim();
  const hash = targetId?.lastIndexOf("#") ?? -1;
  if (targetId && hash >= 0 && options?.resolveFootnoteLineText) {
    const fromLine = options.resolveFootnoteLineText(targetId)?.trim();
    if (fromLine) return fromLine;
  }
  const tip = hit.hoverTip?.trim() || hit.label?.trim();
  if (!tip || tip === "·") return "内部跳转";
  if ((hit.builtinLinkIcon || hit.iconRel) && tip === "注" && !hit.hoverTip?.trim()) {
    return "内部跳转";
  }
  return tip;
}

/** 阅读器剥离 MD 链接语法时扫描的行特征（内链 + 外链） */
export function lineContainsMdStripLink(raw: string): boolean {
  return (
    raw.includes("](#") ||
    /]\(https?:\/\//i.test(raw) ||
    /]\(mailto:/i.test(raw)
  );
}

/** 含需剥离的 MD 行内图（`![…](…)`；独占行插图仍留给 View Zone） */
export function lineContainsMdInlineImage(raw: string): boolean {
  return raw.includes("![");
}

/** 只读展示需扫描剥离的 MD 标记（内/外链、行内图、由调用方另判 span 锚点） */
export function lineContainsMdStripMarkup(raw: string): boolean {
  return lineContainsMdStripLink(raw) || lineContainsMdInlineImage(raw);
}

export function isAllowedMdExternalUrl(url: string): boolean {
  const u = url.trim();
  return /^https?:\/\//i.test(u) || /^mailto:/i.test(u);
}

export function shiftMdLinkHitColumns(
  hit: MdCompactLinkHit,
  columnDelta: number,
): void {
  if (columnDelta === 0) return;
  hit.startColumn = Math.max(1, hit.startColumn + columnDelta);
  hit.endColumnExclusive = Math.max(
    hit.startColumn + 1,
    hit.endColumnExclusive + columnDelta,
  );
}

function countDeletedDisplayLinesBefore(
  line: number,
  deletedAsc: readonly number[],
): number {
  let lo = 0;
  let hi = deletedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (deletedAsc[mid]! < line) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function shiftMdInternalLinkSidecarDisplayLines(
  sidecar: MdInternalLinkSidecar,
  deletedDisplayLinesDesc: readonly number[],
): void {
  if (deletedDisplayLinesDesc.length === 0) return;
  const deleted = new Set(deletedDisplayLinesDesc);
  const deletedAsc = [...deleted].sort((a, b) => a - b);
  const remapLine = (line: number): number | null => {
    if (deleted.has(line)) return null;
    return line - countDeletedDisplayLinesBefore(line, deletedAsc);
  };
  const newHits = new Map<number, MdCompactLinkHit[]>();
  for (const [line, hits] of sidecar.hitsByDisplayLine) {
    const nl = remapLine(line);
    if (nl != null) newHits.set(nl, hits);
  }
  sidecar.hitsByDisplayLine = newHits;
  const newLeading = new Map<number, string[]>();
  for (const [line, labels] of sidecar.leadingMdLinkLabelsByDisplayLine) {
    const nl = remapLine(line);
    if (nl != null) newLeading.set(nl, labels);
  }
  sidecar.leadingMdLinkLabelsByDisplayLine = newLeading;
}

/** 解析链接 `"title"` 属性 */
export function parseMdLinkTitleAttr(raw: string | undefined): {
  title?: string;
} {
  const t = raw?.trim();
  return t ? { title: t } : {};
}

export const MD_LINK_EMPTY_PLACEHOLDER = "\u200b";

/** 还原 label 内 `\[`、`\]`、`\\` 等转义（仅处理反斜杠转义） */
export function unescapeMdLabel(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

/** marked `helpers.ts` — 匹配成对 `[]` / `()`，支持 `\` 转义 */
function findClosingBracket(str: string, brackets: string): number {
  if (str.indexOf(brackets[1]!) === -1) return -1;
  let level = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "\\") {
      i++;
    } else if (str[i] === brackets[0]) {
      level++;
    } else if (str[i] === brackets[1]) {
      level--;
      if (level < 0) return i;
    }
  }
  return -1;
}

/** 从 `![` 后第一个 `[` 起找匹配的 `]`（alt 内可嵌套 `[…]`） */
function findMdBracketCloseIndex(s: string, openBracket: number): number {
  if (s[openBracket] !== "[") return -1;
  let i = openBracket + 1;
  let depth = 0;
  while (i < s.length) {
    if (s[i] === "\\" && i + 1 < s.length) {
      i += 2;
      continue;
    }
    if (s[i] === "[") {
      depth++;
      i++;
      continue;
    }
    if (s[i] === "]") {
      if (depth === 0) return i;
      depth--;
      i++;
      continue;
    }
    i++;
  }
  return -1;
}

/** marked 将 label 内 `![alt](href)` 留在 link.text；href 用 findClosingBracket(`()`) */
function parseInlineImageFromLinkText(
  text: string,
): { alt: string; href: string } | null {
  const src = text.trim();
  if (!src.startsWith("![")) return null;
  const altOpen = 1;
  if (src[altOpen] !== "[") return null;
  const altClose = findMdBracketCloseIndex(src, altOpen);
  if (altClose < 0) return null;
  const alt = src.slice(altOpen + 1, altClose);
  if (src[altClose + 1] !== "(") return null;
  const hrefSrc = src.slice(altClose + 2);
  const parenClose = findClosingBracket(hrefSrc, "()");
  if (parenClose < 0) return null;
  const href = hrefSrc.slice(0, parenClose).trim();
  return href ? { alt, href } : null;
}

function tryLexLinkAt(line: string, open: number): Tokens.Link | null {
  const sub = line.slice(open);
  if (!sub.startsWith("[")) return null;
  const tokens = Lexer.lexInline(sub);
  const first = tokens[0];
  if (!first || first.type !== "link") return null;
  const link = first as Tokens.Link;
  if (!sub.startsWith(link.raw)) return null;
  return link;
}

/** `![alt](url)`：避免把其中的 `[](url)` 误当成链接（会留下孤立的 `!`） */
function tryLexImageAt(line: string, bang: number): Tokens.Image | null {
  const sub = line.slice(bang);
  if (!sub.startsWith("![")) return null;
  const tokens = Lexer.lexInline(sub);
  const first = tokens[0];
  if (!first || first.type !== "image") return null;
  const img = first as Tokens.Image;
  if (!sub.startsWith(img.raw)) return null;
  return img;
}

/** 若 `[` 属于 `![…](…)`，返回应跳过到的下一扫描位置 */
function skipIndexAfterMdImageBracket(
  line: string,
  openBracket: number,
): number | null {
  if (openBracket <= 0 || line[openBracket - 1] !== "!") return null;
  const img = tryLexImageAt(line, openBracket - 1);
  if (!img) return null;
  return openBracket - 1 + img.raw.length;
}

function parsedFromMarkedLink(
  tok: Tokens.Link,
  index: number,
): ParsedMdInternalLink | ParsedMdExternalLink | null {
  const href = tok.href.trim();
  const icon = parseInlineImageFromLinkText(tok.text);
  const common = {
    full: tok.raw,
    index,
    textLabel: icon ? "" : unescapeMdLabel(tok.text),
    iconAlt: icon ? unescapeMdLabel(icon.alt) : "",
    iconRel: icon?.href ? unescapeMdLabel(icon.href) : undefined,
    titleAttr: tok.title?.trim() || undefined,
  };
  if (href.startsWith("#")) {
    const fragment = href.slice(1).trim();
    if (!fragment || /^#https?:/i.test(href)) return null;
    return { ...common, fragment };
  }
  if (isAllowedMdExternalUrl(href)) {
    return { ...common, url: href };
  }
  return null;
}

export type ParsedMdInternalLink = {
  full: string;
  index: number;
  textLabel: string;
  iconAlt: string;
  iconRel?: string;
  fragment: string;
  titleAttr?: string;
};

export function scanMdInternalLinkAt(
  line: string,
  from: number,
): ParsedMdInternalLink | null {
  let pos = from;
  while (pos < line.length) {
    const open = line.indexOf("[", pos);
    if (open < 0) return null;
    const afterImage = skipIndexAfterMdImageBracket(line, open);
    if (afterImage != null) {
      pos = afterImage;
      continue;
    }
    const tok = tryLexLinkAt(line, open);
    if (!tok) {
      pos = open + 1;
      continue;
    }
    const parsed = parsedFromMarkedLink(tok, open);
    if (!parsed || !("fragment" in parsed)) {
      pos = open + 1;
      continue;
    }
    return parsed;
  }
  return null;
}

export type ParsedMdExternalLink = {
  full: string;
  index: number;
  textLabel: string;
  iconAlt: string;
  iconRel?: string;
  url: string;
  titleAttr?: string;
};

export function scanMdExternalLinkAt(
  line: string,
  from: number,
): ParsedMdExternalLink | null {
  let pos = from;
  while (pos < line.length) {
    const open = line.indexOf("[", pos);
    if (open < 0) return null;
    const afterImage = skipIndexAfterMdImageBracket(line, open);
    if (afterImage != null) {
      pos = afterImage;
      continue;
    }
    const tok = tryLexLinkAt(line, open);
    if (!tok) {
      pos = open + 1;
      continue;
    }
    const parsed = parsedFromMarkedLink(tok, open);
    if (!parsed || !("url" in parsed)) {
      pos = open + 1;
      continue;
    }
    return parsed;
  }
  return null;
}

export type NextMdLinkScan =
  | { kind: "internal"; link: ParsedMdInternalLink }
  | { kind: "external"; link: ParsedMdExternalLink };

export type ParsedMdStandaloneImage = {
  full: string;
  index: number;
  alt: string;
  url: string;
  title?: string;
};

export type NextMdStripToken =
  | NextMdLinkScan
  | { kind: "image"; image: ParsedMdStandaloneImage };

function parsedStandaloneImageAt(
  line: string,
  bang: number,
): ParsedMdStandaloneImage | null {
  const img = tryLexImageAt(line, bang);
  if (!img) return null;
  const url = (img.href ?? "").trim();
  if (!url) return null;
  return {
    full: img.raw,
    index: bang,
    alt: img.text ?? "",
    url,
    title: img.title?.trim() || undefined,
  };
}

export function scanNextMdLinkAt(
  line: string,
  from: number,
): NextMdLinkScan | null {
  let pos = from;
  while (pos < line.length) {
    const open = line.indexOf("[", pos);
    if (open < 0) return null;
    const afterImage = skipIndexAfterMdImageBracket(line, open);
    if (afterImage != null) {
      pos = afterImage;
      continue;
    }
    const tok = tryLexLinkAt(line, open);
    if (tok) {
      const parsed = parsedFromMarkedLink(tok, open);
      if (parsed) {
        return "fragment" in parsed
          ? { kind: "internal", link: parsed }
          : { kind: "external", link: parsed };
      }
    }
    pos = open + 1;
  }
  return null;
}

/** 内/外链或独立 `![alt](url)`（`[![icon](u)](#f)` 优先作链接） */
export function scanNextMdStripTokenAt(
  line: string,
  from: number,
): NextMdStripToken | null {
  let pos = from;
  while (pos < line.length) {
    const bang = line.indexOf("![", pos);
    const open = line.indexOf("[", pos);
    if (open < 0 && bang < 0) return null;

    const linkFirst = open >= 0 && (bang < 0 || open < bang);
    if (linkFirst) {
      const afterImage = skipIndexAfterMdImageBracket(line, open);
      if (afterImage != null) {
        pos = afterImage;
        continue;
      }
      const tok = tryLexLinkAt(line, open);
      if (tok) {
        const parsed = parsedFromMarkedLink(tok, open);
        if (parsed) {
          return "fragment" in parsed
            ? { kind: "internal", link: parsed }
            : { kind: "external", link: parsed };
        }
      }
      pos = open + 1;
      continue;
    }

    if (bang < 0) return null;
    const image = parsedStandaloneImageAt(line, bang);
    if (!image) {
      pos = bang + 2;
      continue;
    }
    return { kind: "image", image };
  }
  return null;
}

export function scanMdInternalLinksOnLine(
  line: string,
): ParsedMdInternalLink[] {
  const out: ParsedMdInternalLink[] = [];
  let from = 0;
  while (from < line.length) {
    const link = scanMdInternalLinkAt(line, from);
    if (!link) {
      from += 1;
      continue;
    }
    out.push(link);
    from = link.index + link.full.length;
  }
  return out;
}

export function stripMdLinksFromLine(line: string): string {
  let result = "";
  let last = 0;
  let from = 0;
  while (from < line.length) {
    const hit = scanNextMdStripTokenAt(line, from);
    if (!hit) break;
    if (hit.kind === "image") {
      result += line.slice(last, hit.image.index);
      last = hit.image.index + hit.image.full.length;
      from = last;
      continue;
    }
    const { link } = hit;
    result += line.slice(last, link.index);
    last = link.index + link.full.length;
    from = last;
  }
  result += line.slice(last);
  return result;
}

export function visibleTextForMdLinkLabel(
  label: string,
  iconRel?: string,
  builtinLinkIcon?: boolean,
): string {
  if (iconRel) {
    return MD_LINK_ICON_PLACEHOLDER;
  }
  if (builtinLinkIcon) {
    return MD_LINK_EMPTY_PLACEHOLDER;
  }
  return label.length > 0 ? label : MD_LINK_EMPTY_PLACEHOLDER;
}

/** 整行仅一处独立 `![…](…)`（非 `[![](icon)](#frag)`），留给块级插图 View Zone */
export function isExclusiveBlockMarkdownImageLine(line: string): boolean {
  const trimmed = line.replace(/<span[^>]*><\/span>/gi, "").trim();
  if (!trimmed.startsWith("![")) return false;
  const img = tryLexImageAt(trimmed, 0);
  return Boolean(img && img.raw === trimmed);
}
