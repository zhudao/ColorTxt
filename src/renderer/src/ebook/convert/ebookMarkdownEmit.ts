/**
 * 电子书转换 → Markdown：锚点 `<span id>`、内/外链 `[…](#frag)` / `[…](https://…)`、块级图 `![…](rel)`。
 */

const MD_LINK_HINT_MAX = 40;

/** 全书 fragment 唯一；logicalKey 如 `epub-0003#f_1` */
export class EbookMarkdownFragmentRegistry {
  private readonly used = new Set<string>();
  private readonly logicalToGlobal = new Map<string, string>();

  allocate(logicalKey: string, preferredFrag: string): string {
    const key = logicalKey.trim();
    const existing = this.logicalToGlobal.get(key);
    if (existing) return existing;

    const base = sanitizeFragment(preferredFrag.trim() || "a");
    let candidate = base;
    let n = 2;
    while (this.used.has(candidate)) {
      candidate = `${base}_${n}`;
      n += 1;
    }
    this.used.add(candidate);
    this.logicalToGlobal.set(key, candidate);
    return candidate;
  }

  resolve(logicalKey: string): string | undefined {
    return this.logicalToGlobal.get(logicalKey.trim());
  }
}

function sanitizeFragment(frag: string): string {
  return frag.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^-+/, "") || "a";
}

export function formatSpanAnchor(fragment: string): string {
  const id = fragment.trim();
  if (!id) return "";
  return `<span id="${escapeHtmlAttr(id)}"></span>`;
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeMdLinkTitle(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function truncateHint(s: string, max = MD_LINK_HINT_MAX): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return [...t].length <= max ? t : [...t].slice(0, max).join("");
}

export function formatMdLinkTitleAttr(title?: string, alt?: string): string {
  const t = truncateHint(title ?? "");
  const a = truncateHint(alt ?? "");
  if (!t && !a) return "";
  return ` "${escapeMdLinkTitle(`${t}/${a}`)}"`;
}

export type MdInternalLinkParams = {
  label: string;
  fragment: string;
  iconRel?: string;
  title?: string;
  alt?: string;
};

/** 内链三形态：有 icon → ![](icon)；有文案 → [文案]；否则 [] */
export function formatMdInternalLink(params: MdInternalLinkParams): string {
  const frag = params.fragment.trim();
  if (!frag) return params.label;

  const titleAttr = formatMdLinkTitleAttr(params.title, params.alt);
  const icon = params.iconRel?.trim();
  if (icon) {
    const alt = truncateHint(params.alt || params.title || "") || "注";
    return `[![${escapeMdLabel(alt)}](${icon})](#${frag}${titleAttr})`;
  }

  const label = params.label.replace(/\s+/g, " ").trim();
  if (label.length > 0) {
    return `[${escapeMdLabel(label)}](#${frag}${titleAttr})`;
  }
  return `[](#${frag}${titleAttr})`;
}

function escapeMdLabel(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function escapeMdUrl(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\)/g, "\\)");
}

export function isMdExternalLinkHref(href: string): boolean {
  const h = href.trim();
  return /^https?:\/\//i.test(h) || /^mailto:/i.test(h);
}

export type MdExternalLinkParams = {
  label: string;
  url: string;
  title?: string;
  alt?: string;
};

/** 外链：`[文案](https://…)`；无文案时 `[](url)` */
export function formatMdExternalLink(params: MdExternalLinkParams): string {
  const url = params.url.trim();
  if (!url) return params.label;
  const titleAttr = formatMdLinkTitleAttr(params.title, params.alt);
  const label = params.label.replace(/\s+/g, " ").trim();
  if (label.length > 0) {
    return `[${escapeMdLabel(label)}](${escapeMdUrl(url)}${titleAttr})`;
  }
  return `[](${escapeMdUrl(url)}${titleAttr})`;
}

export function formatMdBlockImage(rel: string, alt = ""): string {
  const url = rel.trim();
  if (!url) return "";
  return `![${escapeMdLabel(alt.trim() || " ")}](${url})`;
}

/** 从 logical target（`stem#frag` 或 `stem`）得到 `#fragment` 用全局 id */
export function globalFragmentForLogicalTarget(
  registry: EbookMarkdownFragmentRegistry,
  logicalTargetId: string,
  preferredFrag?: string,
): string {
  const tid = logicalTargetId.trim();
  const hash = tid.lastIndexOf("#");
  const pref =
    preferredFrag?.trim() ||
    (hash >= 0 ? tid.slice(hash + 1) : tid.replace(/[^a-zA-Z0-9_-]/g, "_"));
  return registry.allocate(tid, pref);
}

export function spanAnchorForLogicalTarget(
  registry: EbookMarkdownFragmentRegistry,
  logicalTargetId: string,
  preferredFrag?: string,
): string {
  const frag = globalFragmentForLogicalTarget(
    registry,
    logicalTargetId,
    preferredFrag,
  );
  return formatSpanAnchor(frag);
}

export function mdInternalLinkForLogicalTarget(
  registry: EbookMarkdownFragmentRegistry,
  logicalTargetId: string,
  opts: {
    label: string;
    iconRel?: string;
    title?: string;
    alt?: string;
    preferredFrag?: string;
  },
): string {
  const frag = globalFragmentForLogicalTarget(
    registry,
    logicalTargetId,
    opts.preferredFrag,
  );
  return formatMdInternalLink({
    label: opts.label,
    fragment: frag,
    iconRel: opts.iconRel,
    title: opts.title,
    alt: opts.alt,
  });
}

/** ATX 标题前缀：`level` 0 → `#`，1 → `##`，… 最多 6 个 */
export function atxHeadingPrefix(level: number): string {
  const n = Math.min(6, Math.max(1, Math.floor(level) + 1));
  return "#".repeat(n) + " ";
}
