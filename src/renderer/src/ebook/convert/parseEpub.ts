import JSZip from "jszip";
import type { EbookMarkdownArtifacts } from "./ebookTypes";
import {
  EbookMarkdownFragmentRegistry,
  formatMdBlockImage,
  formatMdExternalLink,
  formatMdInternalLink,
  isMdExternalLinkHref,
  mdInternalLinkForLogicalTarget,
  spanAnchorForLogicalTarget,
} from "./ebookMarkdownEmit";
import { injectStemOnlyMdLinkAnchors } from "./ebookStemOnlyMdLinks";
import {
  anchorContainsOnlyImage,
  findInternalLinkAnchorParent,
  getElementLinkHref,
  isEbookLinkIconStyleLabel,
  isInsideNoterefContext,
  isInternalLinkAnchorHref,
  resolveLinkIconHoverTip,
  resolveLinkIconVisibleLabel,
  shouldTreatImgAsLinkIcon,
} from "./ebookLinkIconHeuristics";
import { extractEpubEmbeddedTocEntries } from "./ebookEpubNav";
import { injectEpubTocAnchorsIntoLines } from "./ebookTocAnchorInjection";
import {
  compactFootnoteLinkFragment,
  footnoteRefLogicalTargetFromBody,
  isFootnoteBodyLogicalTarget,
  isFootnoteRefRawElementId,
} from "./ebookFootnoteLinkFragments";
import { type EpubSpineSectionRange } from "./ebookSpineLineMatch";
import { yieldToUi } from "../yieldToUi";

function parseXml(doc: Document, selector: string, attr: string): string | null {
  const el = doc.querySelector(selector);
  const v = el?.getAttribute(attr);
  return v && v.trim() ? v.trim() : null;
}

/**
 * 将「当前 XHTML 在 ZIP 内的目录」为基准，解析 href 得到 ZIP 内 posix 路径。
 * 必须用章节所在目录（如 OEBPS/Text），不能用 OPF 目录；否则 ../Images/… 会错到包根下。
 */
function resolveInZip(htmlDirInZip: string, href: string): string {
  const pathOnly = href.split("#")[0]!.trim();
  const stack = htmlDirInZip.replace(/^\//, "").split("/").filter(Boolean);
  for (const seg of pathOnly.split("/")) {
    if (seg === "..") {
      if (stack.length > 0) stack.pop();
      continue;
    }
    if (seg && seg !== ".") stack.push(seg);
  }
  return stack.join("/");
}

/** ZIP 内路径 → 内链键用「仅文件名 + # + 片段」，与 EPUB 里 `href="part.xhtml#id"` 一致，避免冗长 `OEBPS/Text/…` */
function epubLinkKeyFromZipPath(zipPath: string): string {
  const norm = zipPath.replace(/\\/g, "/").trim();
  const seg = norm.split("/").pop();
  return seg && seg.length > 0 ? seg : norm;
}

/** 元素 `id` 属性 → 锚点键 `epub-NNNN#fragment` */
function makeEpubElementAnchorId(ctx: EpubImageContext, idAttr: string): string {
  const frag = compactFootnoteLinkFragment(idAttr.trim());
  return `${ctx.linkStem}#${frag}`;
}

function spanAnchorForElementId(
  ctx: EpubImageContext,
  rawId: string | null | undefined,
): string {
  const idAttr = rawId?.trim();
  if (!idAttr) return "";
  const logical = makeEpubElementAnchorId(ctx, idAttr);
  const frag = compactFootnoteLinkFragment(idAttr);
  return spanAnchorForLogicalTarget(ctx.fragments, logical, frag);
}

/** noteref 回跳锚点：`<span id="fr_…">`（脚注正文链回用） */
function noterefBackAnchorSpanForTarget(
  ctx: EpubImageContext,
  footnoteBodyTargetId: string,
): string {
  const refLogical = footnoteRefLogicalTargetFromBody(footnoteBodyTargetId);
  if (!refLogical) return "";
  const rawRefId = refLogical.slice(refLogical.lastIndexOf("#") + 1);
  return spanAnchorForLogicalTarget(
    ctx.fragments,
    refLogical,
    compactFootnoteLinkFragment(rawRefId),
  );
}

function anchorKeyOf(el: Element): string | undefined {
  return (
    el.getAttribute("id")?.trim() ||
    el.getAttribute("name")?.trim() ||
    undefined
  );
}

/** 非脚注回跳 id 仍放在链接前；noteref→脚注 的 `fr_*` 与内链成对放在链接后。 */
function appendAnchorIdMarkBeforeIfNeeded(
  acc: { text: string },
  ctx: EpubImageContext,
  anchorKey: string | undefined,
  footnoteBodyTargetId: string | null,
): void {
  if (!anchorKey) return;
  const deferRef =
    footnoteBodyTargetId &&
    isFootnoteBodyLogicalTarget(footnoteBodyTargetId) &&
    isFootnoteRefRawElementId(anchorKey);
  if (!deferRef) acc.text += spanAnchorForElementId(ctx, anchorKey);
}

function appendNoterefBackAnchorAfterLinkIfNeeded(
  acc: { text: string },
  ctx: EpubImageContext,
  anchorEl: Element,
  footnoteBodyTargetId: string,
): void {
  if (!isFootnoteBodyLogicalTarget(footnoteBodyTargetId)) return;
  const anchorKey = anchorKeyOf(anchorEl);
  if (anchorKey && isFootnoteRefRawElementId(anchorKey)) {
    acc.text += spanAnchorForElementId(ctx, anchorKey);
    return;
  }
  if (anchorKey) return;
  acc.text += noterefBackAnchorSpanForTarget(ctx, footnoteBodyTargetId);
}

function appendMdLinkToAcc(
  acc: { text: string },
  ctx: EpubImageContext,
  logicalTargetId: string,
  opts: {
    label: string;
    iconRel?: string;
    title?: string;
    alt?: string;
  },
): void {
  const tid = logicalTargetId.trim();
  if (!tid) return;
  if (!tid.includes("#")) {
    acc.text += formatMdInternalLink({
      label: opts.label,
      fragment: tid,
      iconRel: opts.iconRel,
      title: opts.title,
      alt: opts.alt,
    });
    return;
  }
  acc.text += mdInternalLinkForLogicalTarget(ctx.fragments, tid, {
    label: opts.label,
    iconRel: opts.iconRel,
    title: opts.title,
    alt: opts.alt,
    preferredFrag: tid.slice(tid.lastIndexOf("#") + 1),
  });
}

/**
 * 内链 `a[href]` → 逻辑目标 `epub-NNNN#fragment`（写入 `[…](#frag)`）。
 * `http(s):`、`mailto:` 等返回 null。
 */
function resolveEpubInternalLinkTargetId(
  href: string,
  htmlDirInZip: string,
  ctx: EpubImageContext,
): string | null {
  const h = href.trim();
  if (!h || /^https?:\/\//i.test(h) || /^mailto:/i.test(h) || /^tel:/i.test(h)) {
    return null;
  }
  const hashIdx = h.indexOf("#");
  const pathPart = hashIdx >= 0 ? h.slice(0, hashIdx).trim() : h.trim();
  const fragRaw = hashIdx >= 0 ? h.slice(hashIdx + 1) : "";
  const frag = compactFootnoteLinkFragment(fragRaw);

  if (!pathPart) {
    if (!frag) return null;
    return `${ctx.linkStem}#${frag}`;
  }
  const resolvedPath = resolveInZip(htmlDirInZip, pathPart);
  const stem = epubLinkStemForZipPath(ctx, resolvedPath);
  if (!frag) return stem;
  return `${stem}#${frag}`;
}

/** ZIP 内路径大小写与打包工具不一致时仍能命中 */
function findZipFile(zip: JSZip, posixPath: string): JSZip.JSZipObject | null {
  const want = posixPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const direct = zip.file(want);
  if (direct) return direct;
  const low = want.toLowerCase();
  for (const name of Object.keys(zip.files)) {
    const n = name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (n.toLowerCase() === low) return zip.files[name] ?? null;
  }
  return null;
}

type EpubImageContext = {
  zip: JSZip;
  imagesFolderRel: string;
  imageWrites: Array<{ relativePath: string; data: ArrayBuffer }>;
  /** 输出相对路径（小写）是否已被占用（不同 zip 路径撞到同名文件时） */
  usedRelKeys: Set<string>;
  /** ZIP 内路径键 → 已导出的 `![…](rel)` 相对路径；多处以同一文件为 src 时只落盘一次 */
  exportedImageByZipKey: Map<string, string>;
  /** 当前 spine HTML 文档短键（如 `epub-0003`），内链与 `<span id>` 逻辑键用 */
  linkStem: string;
  /** 归一化 ZIP 路径 → `epub-NNNN`（跨章 href 解析） */
  zipPathToLinkStem: Map<string, string>;
  /** 本书首个脚注图标相对路径；纯文字 noteref 复用同一图标 */
  footnoteIconRel?: string;
  fragments: EbookMarkdownFragmentRegistry;
};

/** spine 序第 n 个 HTML 文档 → 短键（与 MOBI `mobi-NNNN` 对齐） */
function epubSpineLinkStem(spineHtmlIndex: number): string {
  return `epub-${String(spineHtmlIndex).padStart(4, "0")}`;
}

function epubLinkStemForZipPath(
  ctx: EpubImageContext,
  zipPath: string,
): string {
  const mapped = ctx.zipPathToLinkStem.get(zipPathCompareKey(zipPath));
  if (mapped) return mapped;
  return epubLinkKeyFromZipPath(zipPath);
}

function getImgHref(el: Element): string {
  const src = el.getAttribute("src")?.trim();
  if (src) return src;
  const xlink = el.getAttributeNS("http://www.w3.org/1999/xlink", "href");
  if (xlink?.trim()) return xlink.trim();
  const href = el.getAttribute("href")?.trim();
  return href ?? "";
}

function safeImageFileBaseFromZipPath(zipPath: string): string {
  const seg = zipPath.replace(/\\/g, "/").split("/").pop() ?? "image.bin";
  const cleaned = seg
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned : "image.bin";
}

async function exportImageRelFromHref(
  zip: JSZip,
  htmlDirInZip: string,
  href: string,
  ctx: EpubImageContext,
): Promise<string | null> {
  const pathOnly = href.split("#")[0]!.trim();
  if (!pathOnly) return null;
  if (/^https?:\/\//i.test(pathOnly) || /^data:/i.test(pathOnly)) return null;
  const zipPath = resolveInZip(htmlDirInZip, pathOnly);
  const lowPath = zipPath.toLowerCase();
  if (!/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(lowPath)) return null;

  const zipKey = zipPathCompareKey(zipPath);
  const already = ctx.exportedImageByZipKey.get(zipKey);
  if (already) return already;

  const zf = findZipFile(zip, zipPath);
  if (!zf || zf.dir) return null;
  const data = await zf.async("arraybuffer");
  if (data.byteLength === 0) return null;

  const originalBase = safeImageFileBaseFromZipPath(zipPath);
  const dot = originalBase.lastIndexOf(".");
  const stem0 = dot > 0 ? originalBase.slice(0, dot) : originalBase;
  const ext0 = dot > 0 ? originalBase.slice(dot) : "";

  let rel = "";
  for (let n = 0; ; n += 1) {
    const fname = n === 0 ? originalBase : `${stem0}_${n}${ext0}`;
    const tryRel = `${ctx.imagesFolderRel}/${fname}`;
    if (!ctx.usedRelKeys.has(tryRel.toLowerCase())) {
      rel = tryRel;
      break;
    }
  }

  ctx.usedRelKeys.add(rel.toLowerCase());
  ctx.exportedImageByZipKey.set(zipKey, rel);
  ctx.imageWrites.push({ relativePath: rel, data });
  return rel;
}

async function appendImageLineFromHref(
  zip: JSZip,
  htmlDirInZip: string,
  href: string,
  ctx: EpubImageContext,
  out: string[],
): Promise<void> {
  const rel = await exportImageRelFromHref(zip, htmlDirInZip, href, ctx);
  if (rel) out.push(formatMdBlockImage(rel));
}

function resolveInternalLinkTargetForLinkIcon(
  imgEl: Element,
  htmlDirInZip: string,
  ctx: EpubImageContext,
): { anchor: Element; targetId: string } | null {
  const directAnchor = findInternalLinkAnchorParent(imgEl);
  if (directAnchor) {
    const href = directAnchor.getAttribute("href")?.trim() ?? "";
    const tid = resolveEpubInternalLinkTargetId(href, htmlDirInZip, ctx);
    if (tid) return { anchor: directAnchor, targetId: tid };
  }
  if (isInsideNoterefContext(imgEl)) {
    let cur: Element | null = imgEl.parentElement;
    while (cur) {
      if (cur.tagName.toLowerCase() === "a") {
        const href = cur.getAttribute("href")?.trim() ?? "";
        if (isInternalLinkAnchorHref(href)) {
          const tid = resolveEpubInternalLinkTargetId(href, htmlDirInZip, ctx);
          if (tid) return { anchor: cur, targetId: tid };
        }
      }
      cur = cur.parentElement;
    }
  }
  return null;
}

async function appendInlineLinkIconToAcc(
  acc: { text: string },
  imgEl: Element,
  anchorEl: Element,
  targetId: string,
  ctx: EpubImageContext,
  htmlDirInZip: string,
): Promise<void> {
  const href = getImgHref(imgEl);
  const rel = href
    ? await exportImageRelFromHref(ctx.zip, htmlDirInZip, href, ctx)
    : null;
  const label = resolveLinkIconVisibleLabel(imgEl, anchorEl);
  const hoverTip = resolveLinkIconHoverTip(imgEl, anchorEl);
  const iconRel = rel ?? undefined;
  if (iconRel && !ctx.footnoteIconRel) {
    ctx.footnoteIconRel = iconRel;
  }
  const slash = hoverTip.indexOf("/");
  const title = slash >= 0 ? hoverTip.slice(0, slash) : hoverTip;
  const alt = slash >= 0 ? hoverTip.slice(slash + 1) : undefined;
  const anchorKey = anchorKeyOf(anchorEl);
  appendAnchorIdMarkBeforeIfNeeded(acc, ctx, anchorKey, targetId);
  appendMdLinkToAcc(acc, ctx, targetId, {
    label,
    iconRel,
    title,
    alt,
  });
  appendNoterefBackAnchorAfterLinkIfNeeded(acc, ctx, anchorEl, targetId);
}

async function tryAppendInlineLinkIconFromAnchor(
  acc: { text: string },
  anchorEl: Element,
  ctx: EpubImageContext,
  htmlDirInZip: string,
): Promise<boolean> {
  const onlyImg = anchorContainsOnlyImage(anchorEl);
  if (!onlyImg) return false;
  const href = getElementLinkHref(anchorEl);
  if (!isInternalLinkAnchorHref(href)) return false;
  const tid = resolveEpubInternalLinkTargetId(href, htmlDirInZip, ctx);
  if (!tid) return false;
  await appendInlineLinkIconToAcc(
    acc,
    onlyImg,
    anchorEl,
    tid,
    ctx,
    htmlDirInZip,
  );
  return true;
}

async function readZipUtf8(zip: JSZip, path: string): Promise<string | null> {
  const f = findZipFile(zip, path);
  if (!f) return null;
  return f.async("string");
}

function normalizeSpace(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/** 与 spine 解析出的 ZIP 内路径比对（大小写/斜杠统一） */
function zipPathCompareKey(posixPath: string): string {
  return posixPath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

const EPUB_OPS = "http://www.idpf.org/2007/ops";

function getEpubTypeAttr(el: Element): string | null {
  const a =
    el.getAttribute("epub:type") || el.getAttributeNS(EPUB_OPS, "type");
  return a?.trim() ? a.trim() : null;
}

function epubTypeHas(el: Element, needle: string): boolean {
  const raw = getEpubTypeAttr(el);
  if (!raw) return false;
  const low = needle.toLowerCase();
  return raw.split(/\s+/).some((p) => p.toLowerCase() === low);
}

function isNoteTypedElement(el: Element): boolean {
  return (
    epubTypeHas(el, "footnote") ||
    epubTypeHas(el, "endnote") ||
    epubTypeHas(el, "rearnote")
  );
}

function isNoteGroupContainer(el: Element): boolean {
  return (
    epubTypeHas(el, "footnotes") ||
    epubTypeHas(el, "endnotes") ||
    epubTypeHas(el, "rearnotes")
  );
}

/** 脚注/尾注锚点 id：`footnote_1`、`fn1`、`n1`、`ft-1-1`、`en001` 等 */
function looksLikeNoteAnchorId(rawId: string | null | undefined): boolean {
  const id = rawId?.trim() ?? "";
  if (!id) return false;
  if (/^footnote/i.test(id)) return true;
  if (/^endnote/i.test(id)) return true;
  if (/^ft[-_]/i.test(id)) return true;
  if (/^fn[-_]?\d/i.test(id)) return true;
  if (/^en\d/i.test(id)) return true;
  if (/^n\d+$/i.test(id)) return true;
  return false;
}

const NOTE_LIKE_TAGS = new Set([
  "aside",
  "li",
  "div",
  "section",
  "p",
  "footer",
]);

function listItemLooksLikeNote(li: Element): boolean {
  return (
    isNoteTypedElement(li) ||
    looksLikeNoteAnchorId(li.getAttribute("id")) ||
    looksLikeNoteAnchorId(li.getAttribute("name"))
  );
}

/** EPUB3 脚注/尾注容器：`aside`、`section epub:type="endnotes"` 等（不含 ol/ul，列表走 {@link isFootnoteList}） */
function isFootnoteContainer(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "ol" || tag === "ul") return false;
  if (isNoteTypedElement(el)) return true;
  if (
    (tag === "section" ||
      tag === "div" ||
      tag === "aside" ||
      tag === "footer") &&
    isNoteGroupContainer(el)
  ) {
    return true;
  }
  if (
    NOTE_LIKE_TAGS.has(tag) &&
    (looksLikeNoteAnchorId(el.getAttribute("id")) ||
      looksLikeNoteAnchorId(el.getAttribute("name")))
  ) {
    return true;
  }
  const list = el.querySelector(":scope > ol, :scope > ul");
  if (list) {
    for (const li of list.querySelectorAll(":scope > li")) {
      if (listItemLooksLikeNote(li as Element)) return true;
    }
  }
  return false;
}

/** 章末 `<ol>` / `<ul>` 脚注列表（含 `<li epub:type="endnote">`） */
function isFootnoteList(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag !== "ol" && tag !== "ul") return false;
  if (isNoteGroupContainer(el)) return true;
  const parent = el.parentElement;
  if (parent && isNoteGroupContainer(parent)) return true;
  if (parent && isNoteTypedElement(parent)) return true;
  if (parent && isFootnoteContainer(parent) && parent !== el) {
    if (parent.querySelector(":scope > ol, :scope > ul") === el) return true;
  }
  for (const li of el.querySelectorAll(":scope > li")) {
    if (listItemLooksLikeNote(li as Element)) return true;
  }
  return false;
}

function parseEpubHtmlDocument(html: string): Document {
  const xhtmlDoc = new DOMParser().parseFromString(
    html,
    "application/xhtml+xml",
  );
  if (xhtmlDoc.querySelector("parsererror")) {
    return new DOMParser().parseFromString(html, "text/html");
  }
  return xhtmlDoc;
}

/** 正文中「第〇折/回/章…」类短标题（用于从 h1–h6 里挑出章节行，而非全书名） */
function looksChapterish(s: string): boolean {
  const t = normalizeSpace(s);
  if (t.length === 0 || t.length > 100) return false;
  if (/折/.test(t)) return true;
  if (/^(第[0-9０-９一二三四五六七八九十百千两]+)(折|回|章|卷|篇|幕|部|节)(?=\s|$|[\u4e00-\u9fff])/u.test(t))
    return true;
  return false;
}

/** 文档序第一个 `epub:type` 含给定 token 的元素（跳过 nav 内，避免目录） */
function firstEpubTypedPlainText(doc: Document, typeToken: string): string | null {
  const all = doc.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    const el = all[i]!;
    if (el.closest("nav")) continue;
    if (!epubTypeHas(el, typeToken)) continue;
    const t = normalizeSpace(el.textContent ?? "");
    if (t.length > 0 && t.length <= 120) return t;
  }
  return null;
}

/** 正文内文档序第一个「章节感」标题（h1–h6） */
function firstChapterishHeadingPlain(doc: Document): string | null {
  const heads = doc.querySelectorAll("body h1, body h2, body h3, body h4, body h5, body h6");
  for (const h of heads) {
    const el = h as Element;
    if (el.closest("nav")) continue;
    const t = normalizeSpace(el.textContent ?? "");
    if (t.length > 0 && looksChapterish(t)) return t;
  }
  return null;
}

/**
 * 若 spine 章节把卷标写在 epub:title / doc-title 或单独的 h*，而按 body 子树未落到前部行，则补一行。
 * 不使用 `head > title`（常为全书/多章导航文案，易误插入「第n章」等）。
 */
function prependMissingChapterLead(doc: Document, out: string[]): void {
  const sample = out.slice(0, 25).join("\n");
  const missing = (line: string | null): line is string => {
    if (!line) return false;
    const t = normalizeSpace(line);
    if (t.length === 0 || t.length > 120) return false;
    return !sample.includes(t);
  };

  const epubTitle =
    firstEpubTypedPlainText(doc, "title") ??
    firstEpubTypedPlainText(doc, "doc-title");
  if (
    missing(epubTitle) &&
    epubTitle &&
    (looksChapterish(epubTitle) || /折/.test(epubTitle))
  ) {
    out.unshift(epubTitle);
    return;
  }

  const hLine = firstChapterishHeadingPlain(doc);
  if (missing(hLine)) {
    out.unshift(hLine!);
  }
}

/** 块级标签：出现则不应把整段 div 合成一行标题 */
const BLOCK_INNER =
  "p, h1, h2, h3, h4, h5, h6, blockquote, ul, ol, table, figure, section, article, aside, nav, header, footer, dl, pre, address";

function hasBlockStructureInside(el: Element): boolean {
  if (el.querySelector(BLOCK_INNER) !== null) return true;
  /** 仅含插图、无 p/h* 的容器若走「合成一行」分支会漏掉 img（textContent 为空） */
  if (el.querySelector("img, image") !== null) return true;
  /**
   * 含 `<a>` 时不能整段 textContent 合成一行：`<a id="…"></a>` 无文本，会漏掉 `<span id>`；
   * 有 href 的链接也会丢失 MD 内链。
   */
  if (el.querySelector("a[href], a[id], a[name]") !== null) return true;
  return false;
}

/** 在含块级子元素的容器内按 DOM 顺序输出，保留元素之间的文本节点（如 `</a> 第一折 <h3>`） */
async function emitFlowChildNodes(
  el: Element,
  out: string[],
  ctx: EpubImageContext,
  htmlDirInZip: string,
  currentDocZipPath: string,
): Promise<void> {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = normalizeSpace(node.textContent ?? "");
      if (t) out.push(t);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      await emitFlowBlock(node as Element, out, ctx, htmlDirInZip, currentDocZipPath);
    }
  }
}

async function walkInlineNodes(
  parent: Node,
  acc: { text: string },
  htmlDirInZip: string,
  currentDocZipPath: string,
  ctx: EpubImageContext,
): Promise<void> {
  for (const node of parent.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      acc.text += node.textContent ?? "";
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "br" || tag === "hr") {
      acc.text += " ";
      continue;
    }
    /** 注音/括注：不并入正文，避免「第一折」旁多出拼音或半角括号 */
    if (tag === "rt" || tag === "rp") {
      continue;
    }
    if (tag === "a") {
      const anchorKey = anchorKeyOf(el);
      if (
        await tryAppendInlineLinkIconFromAnchor(
          acc,
          el,
          ctx,
          htmlDirInZip,
        )
      ) {
        continue;
      }
      const href = el.getAttribute("href")?.trim() ?? "";
      const label = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (isMdExternalLinkHref(href)) {
        if (anchorKey) acc.text += spanAnchorForElementId(ctx, anchorKey);
        acc.text += formatMdExternalLink({ label, url: href });
      } else {
        const tid = resolveEpubInternalLinkTargetId(href, htmlDirInZip, ctx);
        if (tid) {
          appendAnchorIdMarkBeforeIfNeeded(acc, ctx, anchorKey, tid);
          const hover = resolveLinkIconHoverTip(el, el);
          const slash = hover.indexOf("/");
          appendMdLinkToAcc(acc, ctx, tid, {
            label,
            iconRel:
              label &&
              ctx.footnoteIconRel &&
              isEbookLinkIconStyleLabel(label) &&
              (isInsideNoterefContext(el) || epubTypeHas(el, "noteref"))
                ? ctx.footnoteIconRel
                : undefined,
            title: slash >= 0 ? hover.slice(0, slash) : hover,
            alt: slash >= 0 ? hover.slice(slash + 1) : undefined,
          });
          appendNoterefBackAnchorAfterLinkIfNeeded(acc, ctx, el, tid);
        } else if (label) {
          if (anchorKey) acc.text += spanAnchorForElementId(ctx, anchorKey);
          acc.text += label;
        } else if (anchorKey) {
          acc.text += spanAnchorForElementId(ctx, anchorKey);
        }
      }
      continue;
    }
    const epubNs = "http://www.idpf.org/2007/ops";
    const epubType =
      el.getAttribute("epub:type") || el.getAttributeNS(epubNs, "type");
    if (epubType === "noteref") {
      await walkInlineNodes(el, acc, htmlDirInZip, currentDocZipPath, ctx);
      continue;
    }
    if (
      tag === "span" ||
      tag === "b" ||
      tag === "strong" ||
      tag === "i" ||
      tag === "em" ||
      tag === "u" ||
      tag === "small" ||
      tag === "sub" ||
      tag === "sup" ||
      tag === "code" ||
      tag === "kbd" ||
      tag === "s" ||
      tag === "strike" ||
      tag === "mark" ||
      tag === "cite" ||
      tag === "q" ||
      tag === "ruby" ||
      tag === "rb" ||
      tag === "rtc" ||
      tag === "rbc" ||
      tag === "font" ||
      tag === "big" ||
      tag === "tt" ||
      tag === "ins" ||
      tag === "del" ||
      tag === "bdi" ||
      tag === "bdo" ||
      tag === "data" ||
      tag === "time"
    ) {
      await walkInlineNodes(el, acc, htmlDirInZip, currentDocZipPath, ctx);
    }
  }
}

async function paragraphToLines(
  p: Element,
  out: string[],
  ctx: EpubImageContext,
  htmlDirInZip: string,
  currentDocZipPath: string,
  anchorIdFallback?: string | null,
): Promise<void> {
  const acc = { text: "" };
  const selfId =
    p.getAttribute("id")?.trim() || p.getAttribute("name")?.trim() || "";
  const idAttr = selfId || anchorIdFallback?.trim() || "";
  const idMark = spanAnchorForElementId(ctx, idAttr || null);
  if (idMark) acc.text += idMark;

  function flushTextLines() {
    const raw = normalizeSpace(acc.text);
    acc.text = "";
    if (raw.trim().length > 0) out.push(raw);
  }

  async function visit(node: Node): Promise<void> {
    if (node.nodeType === Node.TEXT_NODE) {
      acc.text += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "img" || tag === "image") {
      if (shouldTreatImgAsLinkIcon({ imgEl: el })) {
        const link = resolveInternalLinkTargetForLinkIcon(
          el,
          htmlDirInZip,
          ctx,
        );
        if (link) {
          await appendInlineLinkIconToAcc(
            acc,
            el,
            link.anchor,
            link.targetId,
            ctx,
            htmlDirInZip,
          );
          return;
        }
      }
      flushTextLines();
      const href = getImgHref(el);
      if (href) {
        await appendImageLineFromHref(
          ctx.zip,
          htmlDirInZip,
          href,
          ctx,
          out,
        );
      }
      return;
    }
    if (tag === "br" || tag === "hr") {
      acc.text += " ";
      return;
    }
    if (tag === "a") {
      const anchorKey = anchorKeyOf(el);
      if (
        await tryAppendInlineLinkIconFromAnchor(
          acc,
          el,
          ctx,
          htmlDirInZip,
        )
      ) {
        return;
      }
      const href = el.getAttribute("href")?.trim() ?? "";
      const label = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (isMdExternalLinkHref(href)) {
        if (anchorKey) acc.text += spanAnchorForElementId(ctx, anchorKey);
        acc.text += formatMdExternalLink({ label, url: href });
      } else {
        const tid = resolveEpubInternalLinkTargetId(href, htmlDirInZip, ctx);
        if (tid) {
          appendAnchorIdMarkBeforeIfNeeded(acc, ctx, anchorKey, tid);
          const hover = resolveLinkIconHoverTip(el, el);
          const slash = hover.indexOf("/");
          appendMdLinkToAcc(acc, ctx, tid, {
            label,
            iconRel:
              label &&
              ctx.footnoteIconRel &&
              isEbookLinkIconStyleLabel(label) &&
              (isInsideNoterefContext(el) || epubTypeHas(el, "noteref"))
                ? ctx.footnoteIconRel
                : undefined,
            title: slash >= 0 ? hover.slice(0, slash) : hover,
            alt: slash >= 0 ? hover.slice(slash + 1) : undefined,
          });
          appendNoterefBackAnchorAfterLinkIfNeeded(acc, ctx, el, tid);
        } else if (label) {
          if (anchorKey) acc.text += spanAnchorForElementId(ctx, anchorKey);
          acc.text += label;
        } else if (anchorKey) {
          acc.text += spanAnchorForElementId(ctx, anchorKey);
        }
      }
      return;
    }
    const epubNs = "http://www.idpf.org/2007/ops";
    const epubType =
      el.getAttribute("epub:type") || el.getAttributeNS(epubNs, "type");
    if (epubType === "noteref") {
      await walkInlineNodes(el, acc, htmlDirInZip, currentDocZipPath, ctx);
      return;
    }
    const nestedImg = el.querySelector("img, image");
    if (!nestedImg) {
      await walkInlineNodes(el, acc, htmlDirInZip, currentDocZipPath, ctx);
      return;
    }
    for (const c of el.childNodes) {
      await visit(c);
    }
  }

  for (const c of p.childNodes) {
    await visit(c);
  }
  flushTextLines();
}

async function emitFootnoteListItems(
  listEl: Element,
  containerFallbackId: string | null,
  out: string[],
  ctx: EpubImageContext,
  htmlDirInZip: string,
  currentDocZipPath: string,
): Promise<void> {
  const items = [...listEl.querySelectorAll(":scope > li")];
  for (const li of items) {
    const liId =
      li.getAttribute("id")?.trim() || li.getAttribute("name")?.trim() || "";
    const fallback =
      !liId && items.length === 1 && containerFallbackId
        ? containerFallbackId
        : null;
    await paragraphToLines(
      li,
      out,
      ctx,
      htmlDirInZip,
      currentDocZipPath,
      fallback,
    );
  }
}

/** 脚注块：保证 `<span id="f_*">` 与正文内容同一行，避免仅锚点独占行导致跳转落空 */
async function emitFootnoteBlock(
  el: Element,
  out: string[],
  ctx: EpubImageContext,
  htmlDirInZip: string,
  currentDocZipPath: string,
): Promise<void> {
  const tag = el.tagName.toLowerCase();
  const containerId =
    el.getAttribute("id")?.trim() || el.getAttribute("name")?.trim() || null;

  if (tag === "ol" || tag === "ul") {
    await emitFootnoteListItems(
      el,
      containerId,
      out,
      ctx,
      htmlDirInZip,
      currentDocZipPath,
    );
    return;
  }

  const directList = el.querySelector(":scope > ol, :scope > ul");
  if (directList) {
    await emitFootnoteListItems(
      directList,
      containerId,
      out,
      ctx,
      htmlDirInZip,
      currentDocZipPath,
    );
    return;
  }

  const childAsides = el.querySelectorAll(":scope > aside");
  if (childAsides.length > 0) {
    for (const aside of childAsides) {
      await emitFootnoteBlock(
        aside as Element,
        out,
        ctx,
        htmlDirInZip,
        currentDocZipPath,
      );
    }
    return;
  }

  const nestedList = el.querySelector("ol, ul");
  if (nestedList && el.tagName.toLowerCase() !== "li") {
    await emitFootnoteListItems(
      nestedList,
      containerId,
      out,
      ctx,
      htmlDirInZip,
      currentDocZipPath,
    );
    return;
  }

  await paragraphToLines(
    el,
    out,
    ctx,
    htmlDirInZip,
    currentDocZipPath,
    containerId,
  );
}

async function emitFigure(
  fig: Element,
  out: string[],
  ctx: EpubImageContext,
  htmlDirInZip: string,
  currentDocZipPath: string,
): Promise<void> {
  const figId = spanAnchorForElementId(ctx, fig.getAttribute("id"));
  if (figId) out.push(figId);
  const cap = fig.querySelector("figcaption");
  if (cap) {
    await paragraphToLines(cap, out, ctx, htmlDirInZip, currentDocZipPath);
  }
  for (const img of fig.querySelectorAll("img, image")) {
    if (cap?.contains(img)) continue;
    const href = getImgHref(img as Element);
    if (href) {
      await appendImageLineFromHref(ctx.zip, htmlDirInZip, href, ctx, out);
    }
  }
}

/** 仅行内/短语级子树：按段落逻辑走 childNodes，避免 `body` 下裸 `<span>` 被 `children` 遍历漏掉 */
const EMIT_AS_INLINE_PARAGRAPH =
  "a, span, b, strong, i, em, u, small, cite, kbd, code, mark, abbr, dfn, q, s, strike, sub, sup";

async function emitFlowBlock(
  el: Element,
  out: string[],
  ctx: EpubImageContext,
  htmlDirInZip: string,
  currentDocZipPath: string,
): Promise<void> {
  const tag = el.tagName.toLowerCase();

  if (tag === "script" || tag === "style" || tag === "noscript") {
    return;
  }

  if (isFootnoteContainer(el)) {
    await emitFootnoteBlock(el, out, ctx, htmlDirInZip, currentDocZipPath);
    return;
  }

  if (el.matches(EMIT_AS_INLINE_PARAGRAPH)) {
    await paragraphToLines(el, out, ctx, htmlDirInZip, currentDocZipPath);
    return;
  }

  if (tag === "figure") {
    await emitFigure(el, out, ctx, htmlDirInZip, currentDocZipPath);
    return;
  }

  if (tag === "li" && listItemLooksLikeNote(el)) {
    await paragraphToLines(el, out, ctx, htmlDirInZip, currentDocZipPath);
    return;
  }

  if (tag === "ul" || tag === "ol") {
    if (isFootnoteList(el)) {
      const listId =
        el.getAttribute("id")?.trim() || el.getAttribute("name")?.trim() || null;
      await emitFootnoteListItems(
        el,
        listId,
        out,
        ctx,
        htmlDirInZip,
        currentDocZipPath,
      );
      return;
    }
    const listId = spanAnchorForElementId(ctx, el.getAttribute("id"));
    if (listId) out.push(listId);
    for (const li of el.querySelectorAll(":scope > li")) {
      await paragraphToLines(li, out, ctx, htmlDirInZip, currentDocZipPath);
    }
    return;
  }

  if (tag === "p" || tag === "blockquote") {
    await paragraphToLines(el, out, ctx, htmlDirInZip, currentDocZipPath);
    return;
  }

  if (/^h[1-6]$/.test(tag)) {
    await paragraphToLines(el, out, ctx, htmlDirInZip, currentDocZipPath);
    return;
  }

  if (tag === "img" || tag === "image") {
    const href = getImgHref(el);
    if (href) {
      await appendImageLineFromHref(ctx.zip, htmlDirInZip, href, ctx, out);
    }
    return;
  }

  if (
    tag === "div" ||
    tag === "section" ||
    tag === "article" ||
    tag === "header" ||
    tag === "aside" ||
    tag === "nav" ||
    tag === "main" ||
    tag === "footer"
  ) {
    const wrapId = spanAnchorForElementId(ctx, el.getAttribute("id"));
    if (!hasBlockStructureInside(el)) {
      let t = normalizeSpace(el.textContent ?? "");
      if (wrapId) t = t ? wrapId + t : wrapId;
      if (t) out.push(t);
      return;
    }
    if (wrapId) out.push(wrapId);
    await emitFlowChildNodes(el, out, ctx, htmlDirInZip, currentDocZipPath);
    return;
  }

  if (tag === "table" || tag === "dl" || tag === "pre" || tag === "address") {
    const blockId = spanAnchorForElementId(ctx, el.getAttribute("id"));
    if (el.querySelector("img, image")) {
      if (blockId) out.push(blockId);
      await emitFlowChildNodes(el, out, ctx, htmlDirInZip, currentDocZipPath);
      return;
    }
    let t = normalizeSpace(el.textContent ?? "");
    if (blockId) t = t ? blockId + t : blockId;
    if (t) out.push(t);
    return;
  }

  /** 未知标签且无元素子节点：整段 textContent 作为一行（含 svg:text、带命名空间的章节标签等） */
  if (el.childElementCount === 0) {
    const leafId = spanAnchorForElementId(ctx, el.getAttribute("id"));
    let t = normalizeSpace(el.textContent ?? "");
    if (leafId) t = t ? leafId + t : leafId;
    if (t) out.push(t);
    return;
  }

  await emitFlowChildNodes(el, out, ctx, htmlDirInZip, currentDocZipPath);
}

async function appendFootnotesOutsideBody(
  doc: Document,
  body: Element | null,
  out: string[],
  ctx: EpubImageContext,
  htmlDirInZip: string,
  currentDocZipPath: string,
): Promise<void> {
  const root = doc.documentElement;
  if (!root) return;
  for (const el of root.querySelectorAll("aside, section, div, footer, ol, ul")) {
    if (body?.contains(el)) continue;
    const node = el as Element;
    const tag = node.tagName.toLowerCase();
    if (tag === "ol" || tag === "ul") {
      if (!isFootnoteList(node)) continue;
      const listId =
        node.getAttribute("id")?.trim() || node.getAttribute("name")?.trim() || null;
      await emitFootnoteListItems(
        node,
        listId,
        out,
        ctx,
        htmlDirInZip,
        currentDocZipPath,
      );
      continue;
    }
    if (!isFootnoteContainer(node)) continue;
    await emitFootnoteBlock(
      node,
      out,
      ctx,
      htmlDirInZip,
      currentDocZipPath,
    );
  }
}

async function xhtmlToLines(
  html: string,
  htmlDirInZip: string,
  ctx: EpubImageContext,
  currentDocZipPath: string,
): Promise<string[]> {
  const doc = parseEpubHtmlDocument(html);
  const body = doc.querySelector("body");
  const out: string[] = [];
  if (body) {
    const bodyIdMark = spanAnchorForElementId(ctx, body.getAttribute("id"));
    if (bodyIdMark) out.push(bodyIdMark);
    for (const child of body.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = normalizeSpace(child.textContent ?? "");
        if (t) out.push(t);
        continue;
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        await emitFlowBlock(
          child as Element,
          out,
          ctx,
          htmlDirInZip,
          currentDocZipPath,
        );
      }
    }
    if (out.length === 0 && body.textContent?.trim()) {
      out.push(normalizeSpace(body.textContent));
    }
    prependMissingChapterLead(doc, out);
  }
  await appendFootnotesOutsideBody(
    doc,
    body,
    out,
    ctx,
    htmlDirInZip,
    currentDocZipPath,
  );
  return out;
}

export async function convertLoadedEpubZip(
  zip: JSZip,
  outputBase: string,
): Promise<EbookMarkdownArtifacts> {
  const containerXml = await readZipUtf8(zip, "META-INF/container.xml");
  if (!containerXml) throw new Error("EPUB 缺少 META-INF/container.xml");

  const cDoc = new DOMParser().parseFromString(containerXml, "application/xml");
  const fullPath =
    parseXml(cDoc, "rootfile", "full-path") ??
    parseXml(cDoc, "n\\:rootfile", "full-path");
  if (!fullPath) throw new Error("EPUB container 未找到 OPF 路径");

  const opfPath = fullPath.replace(/^\//, "").replace(/\\/g, "/");
  const opfDir = opfPath.includes("/")
    ? opfPath.slice(0, opfPath.lastIndexOf("/"))
    : "";

  const opfXml = await readZipUtf8(zip, opfPath);
  if (!opfXml) throw new Error("无法读取 OPF 文件");

  const opfDoc = new DOMParser().parseFromString(opfXml, "application/xml");

  type ManifestEntry = { href: string; media: string; properties: string };
  const manifestById = new Map<string, ManifestEntry>();
  for (const item of opfDoc.querySelectorAll("manifest > item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (!id || !href) continue;
    manifestById.set(id, {
      href,
      media: (item.getAttribute("media-type") ?? "").toLowerCase(),
      properties: (item.getAttribute("properties") ?? "").toLowerCase(),
    });
  }

  const spineIds: string[] = [];
  for (const item of opfDoc.querySelectorAll("spine > itemref")) {
    const idref = item.getAttribute("idref");
    if (idref) spineIds.push(idref);
  }

  await yieldToUi();

  const imagesFolderRel = `${outputBase}.Images`;
  const fragments = new EbookMarkdownFragmentRegistry();
  const imageCtx: EpubImageContext = {
    zip,
    imagesFolderRel,
    imageWrites: [],
    usedRelKeys: new Set(),
    exportedImageByZipKey: new Map(),
    linkStem: "",
    zipPathToLinkStem: new Map(),
    fragments,
  };

  const lines: string[] = [];
  const spineSectionRanges: EpubSpineSectionRange[] = [];
  let spineHtmlIndex = 0;

  /** 先为全部 spine HTML 分配 `epub-NNNN`，避免目录页链接到尚未遍历的文档时落回长路径 */
  for (const id of spineIds) {
    const entry = manifestById.get(id);
    if (!entry) continue;
    const { href, media } = entry;
    if (media.startsWith("image/")) continue;
    const lower = href.toLowerCase();
    const isHtml =
      lower.endsWith(".xhtml") ||
      lower.endsWith(".html") ||
      lower.endsWith(".htm");
    if (!isHtml) continue;
    spineHtmlIndex += 1;
    const zipPath = resolveInZip(opfDir, href);
    imageCtx.zipPathToLinkStem.set(
      zipPathCompareKey(zipPath),
      epubSpineLinkStem(spineHtmlIndex),
    );
  }

  spineHtmlIndex = 0;
  for (const id of spineIds) {
    const entry = manifestById.get(id);
    if (!entry) continue;
    const { href, media } = entry;
    if (media.startsWith("image/")) continue;

    const zipPath = resolveInZip(opfDir, href);
    const lower = href.toLowerCase();
    const isHtml =
      lower.endsWith(".xhtml") ||
      lower.endsWith(".html") ||
      lower.endsWith(".htm");
    if (!isHtml) continue;

    const raw = await readZipUtf8(zip, zipPath);
    if (!raw) continue;

    spineHtmlIndex += 1;
    const linkStem = epubSpineLinkStem(spineHtmlIndex);
    imageCtx.linkStem = linkStem;

    const htmlDirInZip = zipPath.includes("/")
      ? zipPath.slice(0, zipPath.lastIndexOf("/"))
      : "";

    const sectionStartLine = lines.length;
    const chunk = await xhtmlToLines(raw, htmlDirInZip, imageCtx, zipPath);
    for (const ln of chunk) {
      if (ln.trim().length > 0) lines.push(ln);
    }
    lines.push("");
    spineSectionRanges.push({
      stem: linkStem,
      startLine: sectionStartLine,
      endLine: lines.length - 1,
    });
    await yieldToUi();
  }

  const tocEntries = await extractEpubEmbeddedTocEntries({
    zip,
    opfPath,
    opfDoc,
    zipPathToLinkStem: imageCtx.zipPathToLinkStem,
    findZipFile,
  });
  injectEpubTocAnchorsIntoLines(
    lines,
    spineSectionRanges,
    tocEntries,
    fragments,
  );
  injectStemOnlyMdLinkAnchors(lines, spineSectionRanges, fragments);

  const utf8 = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";

  const out: EbookMarkdownArtifacts = { utf8 };
  if (imageCtx.imageWrites.length > 0) {
    out.imageWrites = imageCtx.imageWrites;
  }
  return out;
}

export async function convertEpubToArtifacts(
  buffer: ArrayBuffer,
  outputBase: string,
): Promise<EbookMarkdownArtifacts> {
  const zip = await JSZip.loadAsync(buffer);
  await yieldToUi();
  return convertLoadedEpubZip(zip, outputBase);
}

export async function tryConvertZipAsEpub(
  buffer: ArrayBuffer,
  outputBase: string,
): Promise<EbookMarkdownArtifacts | null> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    if (!findZipFile(zip, "META-INF/container.xml")) return null;
    await yieldToUi();
    return await convertLoadedEpubZip(zip, outputBase);
  } catch {
    return null;
  }
}
