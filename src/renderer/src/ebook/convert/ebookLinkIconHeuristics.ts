const EPUB_OPS = "http://www.idpf.org/2007/ops";
const IMG_TAGS = new Set(["img", "image"]);

/** 链接图标占位：alt → 短 title → 默认「注」（过长 title 忽略，避免占满整行） */
const LINK_ICON_LABEL_MAX_GLYPHS = 2;

function acceptLinkIconLabel(candidate: string | null | undefined): string | null {
  const t = candidate?.trim();
  if (!t) return null;
  if ([...t].length <= LINK_ICON_LABEL_MAX_GLYPHS) return t;
  return null;
}

/** 是否适合以图标样式展示的内链占位文案（如「注」） */
export function isEbookLinkIconStyleLabel(
  candidate: string | null | undefined,
): boolean {
  return acceptLinkIconLabel(candidate) != null;
}

export function resolveLinkIconVisibleLabel(
  imgEl: Element,
  anchorEl?: Element | null,
): string {
  const alt = acceptLinkIconLabel(imgEl.getAttribute("alt"));
  if (alt) return alt;
  const aTitle = acceptLinkIconLabel(anchorEl?.getAttribute("title"));
  if (aTitle) return aTitle;
  const imgTitle = acceptLinkIconLabel(imgEl.getAttribute("title"));
  if (imgTitle) return imgTitle;
  return "注";
}

/** 悬停提示：保留完整 alt / title（不受行内占位字数限制） */
export function resolveLinkIconHoverTip(
  imgEl: Element,
  anchorEl?: Element | null,
): string {
  const candidates = [
    imgEl.getAttribute("alt"),
    anchorEl?.getAttribute("title"),
    imgEl.getAttribute("title"),
    anchorEl?.textContent?.replace(/\s+/g, " ").trim(),
  ];
  for (const raw of candidates) {
    const t = raw?.trim();
    if (t) return t;
  }
  return resolveLinkIconVisibleLabel(imgEl, anchorEl);
}

export function getEpubTypeAttr(el: Element): string | null {
  const a =
    el.getAttribute("epub:type") || el.getAttributeNS(EPUB_OPS, "type");
  return a?.trim() ? a.trim() : null;
}

export function epubTypeHas(el: Element, needle: string): boolean {
  const raw = getEpubTypeAttr(el);
  if (!raw) return false;
  const low = needle.toLowerCase();
  return raw.split(/\s+/).some((p) => p.toLowerCase() === low);
}

function isExternalHref(href: string): boolean {
  const h = href.trim();
  return (
    /^https?:\/\//i.test(h) ||
    /^mailto:/i.test(h) ||
    /^tel:/i.test(h) ||
    /^javascript:/i.test(h)
  );
}

/** 父级 `<a href>` 是否为内部链（非 http/mailto 等） */
export function isInternalLinkAnchorHref(href: string): boolean {
  const h = href.trim();
  if (!h || isExternalHref(h)) return false;
  return true;
}

function isWhitespaceTextNode(n: Node): boolean {
  return n.nodeType === Node.TEXT_NODE && !(n.textContent ?? "").trim();
}

/** `<a>` / FB2 链接元素的 href（含 xlink:href） */
export function getElementLinkHref(el: Element): string {
  const xlink = el.getAttributeNS("http://www.w3.org/1999/xlink", "href")?.trim();
  if (xlink) return xlink;
  return el.getAttribute("href")?.trim() ?? "";
}

/** `<a>` 子树是否「仅 img/image（可夹空白文本）」 */
export function anchorContainsOnlyImage(anchor: Element): Element | null {
  let img: Element | null = null;
  for (const n of anchor.childNodes) {
    if (isWhitespaceTextNode(n)) continue;
    if (n.nodeType !== Node.ELEMENT_NODE) return null;
    const el = n as Element;
    const tag = el.tagName.toLowerCase();
    if (!IMG_TAGS.has(tag)) return null;
    if (img) return null;
    img = el;
  }
  return img;
}

/** 是否在 noteref 语义容器内 */
export function isInsideNoterefContext(el: Element): boolean {
  let cur: Element | null = el;
  while (cur) {
    if (epubTypeHas(cur, "noteref")) return true;
    cur = cur.parentElement;
  }
  return false;
}

/** img 的直接父级是否为带内部 href 的 `<a>` */
export function findInternalLinkAnchorParent(imgEl: Element): Element | null {
  const parent = imgEl.parentElement;
  if (!parent || parent.tagName.toLowerCase() !== "a") return null;
  const href = getElementLinkHref(parent);
  if (!isInternalLinkAnchorHref(href)) return null;
  return parent;
}

export type ShouldTreatImgAsLinkIconInput = {
  imgEl: Element;
  /** 为 true 时不在 figure 等块级插图容器内强制独占行（仍可由 anchor 判定） */
  inParagraphFlow?: boolean;
};

/**
 * 第一版：仅结构判定（无 width/height / 文件头尺寸）。
 * - 父级 `<a>` 为内部链
 * - 或 noteref 上下文内的 img
 */
export function shouldTreatImgAsLinkIcon(input: ShouldTreatImgAsLinkIconInput): boolean {
  const { imgEl } = input;
  if (findInternalLinkAnchorParent(imgEl)) return true;
  if (isInsideNoterefContext(imgEl)) return true;
  return false;
}

/** 块级插图：figure 内且无链接包裹的 img（输出独占行 `![…](rel)`） */
export function isBlockIllustrationImg(imgEl: Element): boolean {
  if (findInternalLinkAnchorParent(imgEl)) return false;
  if (isInsideNoterefContext(imgEl)) return false;
  let cur: Element | null = imgEl.parentElement;
  while (cur) {
    const tag = cur.tagName.toLowerCase();
    if (tag === "figure") return true;
    cur = cur.parentElement;
  }
  return false;
}

/** FB2 / 通用：`<a>` 是否仅含单个 image 子元素 */
export function anchorContainsOnlyFb2Image(anchor: Element): Element | null {
  let image: Element | null = null;
  for (const n of anchor.childNodes) {
    if (isWhitespaceTextNode(n)) continue;
    if (n.nodeType !== Node.ELEMENT_NODE) return null;
    const el = n as Element;
    if (el.localName.toLowerCase() !== "image") return null;
    if (image) return null;
    image = el;
  }
  return image;
}
