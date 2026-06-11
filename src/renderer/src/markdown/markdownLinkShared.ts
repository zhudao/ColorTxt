/**
 * Markdown 内链 sidecar 与 Monaco 装饰共用类型。
 */

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
  >,
  options?: MdLinkHoverMessageOptions,
): string {
  const externalUrl = hit.externalUrl?.trim();
  if (externalUrl) {
    const tip = hit.hoverTip?.trim() || hit.label?.trim();
    return tip && tip !== "·" ? `${tip}\n${externalUrl}` : externalUrl;
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

/** 解析 `"title/alt"` title 属性 */
export function parseMdLinkTitleAttr(raw: string | undefined): {
  title?: string;
  alt?: string;
} {
  const t = raw?.trim();
  if (!t) return {};
  const slash = t.indexOf("/");
  if (slash < 0) return { title: t };
  return {
    title: t.slice(0, slash).trim() || undefined,
    alt: t.slice(slash + 1).trim() || undefined,
  };
}

export const MD_LINK_EMPTY_PLACEHOLDER = "\u200b";

/**
 * 内部 MD 链接：`[文案](#frag)` 或 `[![](path)](#frag)`（label 内可含 `![alt](url)`）。
 */
export const RE_MD_INTERNAL_LINK =
  /\[(?:!\[([^\]]*)\]\(([^)]+)\)|([^\]]*))\]\((#[^)\s"]+)(?:\s+"((?:\\.|[^"\\])*)")?\)/g;

/** 外链：`[文案](https://…)` / `[文案](mailto:…)`，label 内可含 `![alt](url)` 图标 */
export const RE_MD_EXTERNAL_LINK =
  /\[(?:!\[([^\]]*)\]\(([^)]+)\)|([^\]]*))\]\((https?:\/\/[^)\s"]+|mailto:[^)\s"]+)(?:\s+"((?:\\.|[^"\\])*)")?\)/g;

export type ParsedMdInternalLink = {
  full: string;
  index: number;
  textLabel: string;
  iconAlt: string;
  iconRel?: string;
  fragment: string;
  titleAttr?: string;
};

export function parseMdInternalLinkFromMatch(
  m: RegExpExecArray,
): ParsedMdInternalLink | null {
  const fragment = (m[4] ?? "").replace(/^#/, "").trim();
  if (!fragment) return null;
  const iconRel = m[2]?.trim();
  const hasIcon = Boolean(iconRel && m[0]!.includes("!["));
  return {
    full: m[0]!,
    index: m.index!,
    textLabel: (m[3] ?? "").trim(),
    iconAlt: (m[1] ?? "").trim(),
    iconRel: hasIcon ? iconRel : undefined,
    fragment,
    titleAttr: m[5],
  };
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

export function parseMdExternalLinkFromMatch(
  m: RegExpExecArray,
): ParsedMdExternalLink | null {
  const url = (m[4] ?? "").trim();
  if (!url || !isAllowedMdExternalUrl(url)) return null;
  const iconRel = m[2]?.trim();
  const hasIcon = Boolean(iconRel && m[0]!.includes("!["));
  return {
    full: m[0]!,
    index: m.index!,
    textLabel: (m[3] ?? "").trim(),
    iconAlt: (m[1] ?? "").trim(),
    iconRel: hasIcon ? iconRel : undefined,
    url,
    titleAttr: m[5],
  };
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
