/**
 * MOBI → Markdown：基于 foliate-js 的 mobi.js 解析 PDB/MOBI6/KF8，
 * 输出 `<span id>`、MD 内/外链与块级 `![…](rel)`。
 */
import { inflate } from "pako";
import { MOBI, isMOBI } from "./mobi/foliateMobi.js";
import {
  EbookMarkdownFragmentRegistry,
  formatMdBlockImage,
  formatMdExternalLink,
  formatMdInternalLink,
  globalFragmentForLogicalTarget,
  formatSpanAnchor,
  isMdExternalLinkHref,
  mdInternalLinkForLogicalTarget,
  spanAnchorForLogicalTarget,
} from "./ebookMarkdownEmit";
import {
  queueTocHeadingMutations,
  resolveTocInjectLineIdx,
} from "./ebookTocAnchorInjection";
import { injectStemOnlyMdLinkAnchors } from "./ebookStemOnlyMdLinks";
import {
  applyLineMutations,
  sectionRangeByStem,
  type EpubSpineSectionRange,
  type LineMutation,
} from "./ebookSpineLineMatch";
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
import {
  compactFootnoteLinkFragment,
  footnoteRefLogicalTargetFromBody,
  isFootnoteBodyLogicalTarget,
  isFootnoteRefRawElementId,
} from "./ebookFootnoteLinkFragments";
import { yieldToUi } from "../yieldToUi";
import type { EbookMarkdownArtifacts } from "./ebookTypes";

/** 与 PDB `slice` / `arrayBuffer` 接口兼容 */
class ArrayBufferMobiFile {
  constructor(private readonly buf: ArrayBuffer) {}

  slice(start: number, end?: number) {
    const lo = Math.max(0, start);
    const hi =
      end === undefined ? this.buf.byteLength : Math.min(this.buf.byteLength, end);
    const part = this.buf.slice(lo, hi);
    return {
      arrayBuffer: () => Promise.resolve(part),
    };
  }
}

type InnerMobi = {
  loadResource(index: number): Promise<ArrayBuffer>;
  getNCX?: () => Promise<unknown>;
};

type FoliateTocNode = {
  label?: string;
  href?: string;
  subitems?: FoliateTocNode[];
};

type OpenedMobiBook = {
  mobi: InnerMobi;
  sections: Array<{ createDocument?: () => Promise<Document> }>;
  metadata?: { title?: string };
  destroy?: () => void;
  /** MOBI6/KF8：foliate 在 book 实例上提供的内链解析（KF8 为 async） */
  resolveHref?: (href: string) => unknown;
  splitTOCHref?: (href: string) => unknown;
  toc?: FoliateTocNode[];
};

/** `filepos:123` → 锚点 `id="filepos123"` 所在片段（与 foliate 插入的锚点一致） */
type MobiFileposEntry = { sectionIndex: number; anchorId: string };

const FILEPOS_ID_RE = /^filepos\d+$/i;

/**
 * 扫描全书各片段中的 `id="filepos…"`，供 `href="filepos:…"` 解析（MOBI6 正文内链主要靠此机制）。
 */
async function buildMobiFileposAnchorMap(
  book: OpenedMobiBook,
): Promise<Map<string, MobiFileposEntry>> {
  const map = new Map<string, MobiFileposEntry>();
  for (let si = 0; si < book.sections.length; si++) {
    const sec = book.sections[si];
    if (!sec || typeof sec.createDocument !== "function") continue;
    let doc: Document;
    try {
      doc = await sec.createDocument();
    } catch {
      continue;
    }
    if (doc.querySelector("parsererror")) continue;
    const nodes = doc.querySelectorAll("[id]");
    for (let i = 0; i < nodes.length; i++) {
      const rawId = nodes[i]!.getAttribute("id")?.trim();
      if (!rawId || !FILEPOS_ID_RE.test(rawId)) continue;
      const m = /^filepos(\d+)$/i.exec(rawId);
      if (!m) continue;
      const digits = m[1]!;
      const entry: MobiFileposEntry = { sectionIndex: si, anchorId: rawId };
      const keys = new Set<string>([
        rawId,
        rawId.toLowerCase(),
        `filepos${digits}`,
        `filepos${parseInt(digits, 10)}`,
      ]);
      for (const k of keys) {
        if (!map.has(k)) map.set(k, entry);
      }
    }
    await yieldToUi();
  }
  return map;
}

/** KF8 等：`href="kindle:pos:…"` 由 foliate 解析到目标元素 id */
async function resolveMobiKindlePosTarget(
  book: OpenedMobiBook,
  href: string,
): Promise<string | null> {
  if (!/^kindle:pos:/i.test(href)) return null;
  const rh = book.resolveHref;
  if (typeof rh !== "function") return null;
  type Res = { index: number; anchor: (d: Document) => Element | null } | undefined;
  let result: Res;
  try {
    result = (await Promise.resolve(rh.call(book, href))) as Res;
  } catch {
    return null;
  }
  if (!result || result.index < 0 || typeof result.anchor !== "function") return null;
  const sec = book.sections[result.index];
  if (!sec || typeof sec.createDocument !== "function") return null;
  let doc: Document;
  try {
    doc = await sec.createDocument();
  } catch {
    return null;
  }
  const el = result.anchor(doc);
  const tid = el?.getAttribute("id")?.trim() || el?.getAttribute("name")?.trim();
  if (tid) return `${mobiSectionStem(result.index)}#${tid}`;
  return mobiSectionStem(result.index);
}

/** 与 foliate `makePosURI` 一致（NCX `pos` → `kindle:pos:`） */
function makeKindlePosHref(fid: number, off: number): string {
  return `kindle:pos:fid:${fid.toString(32).toUpperCase().padStart(4, "0")}:off:${off.toString(32).toUpperCase().padStart(10, "0")}`;
}

/** foliate `view.js` / `progress.js`：优先 `splitTOCHref` 得 spine 节与 fragment */
function splitMobiTocHref(
  href: string,
  book: OpenedMobiBook,
): { sectionIndex: number; fragmentHint?: string } | null {
  const h = href.trim();
  if (!h) return null;
  const st = book.splitTOCHref;
  if (typeof st !== "function") return null;
  try {
    const pair = st.call(book, h) as [number, unknown];
    const sectionIndex = pair?.[0];
    if (typeof sectionIndex !== "number" || sectionIndex < 0) return null;
    const fragPart = pair[1];
    if (typeof fragPart === "string" && fragPart.trim()) {
      return { sectionIndex, fragmentHint: fragPart.trim() };
    }
    return { sectionIndex };
  } catch {
    return null;
  }
}

type NcxTocNode = {
  label?: string;
  pos?: number[];
  children?: NcxTocNode[];
};

function mapNcxNodeToFoliateToc(node: NcxTocNode): FoliateTocNode | null {
  const label = node.label?.replace(/\s+/g, " ").trim();
  const pos = node.pos;
  if (!label || !pos?.length) return null;
  let href: string;
  if (pos.length >= 2) {
    href = makeKindlePosHref(pos[0]!, pos[1]!);
  } else {
    href = `filepos:${pos[0]}`;
  }
  const item: FoliateTocNode = { label, href };
  if (node.children?.length) {
    item.subitems = node.children
      .map(mapNcxNodeToFoliateToc)
      .filter((x): x is FoliateTocNode => x != null);
  }
  return item;
}

/** guide 目录页未解析出 `book.toc` 时，回退 INDX/NCX（与 foliate KF8 同源） */
async function buildMobiTocTreeFromNcx(
  book: OpenedMobiBook,
): Promise<FoliateTocNode[]> {
  const getNCX = book.mobi.getNCX;
  if (typeof getNCX !== "function") return [];
  let ncx: unknown;
  try {
    ncx = await getNCX();
  } catch {
    return [];
  }
  if (!Array.isArray(ncx) || ncx.length === 0) return [];
  return (ncx as NcxTocNode[])
    .map(mapNcxNodeToFoliateToc)
    .filter((x): x is FoliateTocNode => x != null);
}

type MobiImageCtx = {
  imagesFolderRel: string;
  imageWrites: Array<{ relativePath: string; data: ArrayBuffer }>;
  usedRelKeys: Set<string>;
  exportedByKey: Map<string, string>;
  seq: number;
  /** 本书首个脚注图标相对路径；纯文字 noteref 复用同一图标 */
  footnoteIconRel?: string;
  fragments: EbookMarkdownFragmentRegistry;
};

function mobiSpanAnchorForElementId(
  ctx: MobiImageCtx,
  sectionStem: string,
  rawId: string | null | undefined,
): string {
  const idAttr = rawId?.trim();
  if (!idAttr) return "";
  const frag = compactFootnoteLinkFragment(idAttr);
  return spanAnchorForLogicalTarget(
    ctx.fragments,
    `${sectionStem}#${frag}`,
    frag,
  );
}

function noterefBackAnchorSpanForTarget(
  ctx: MobiImageCtx,
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

function appendAnchorIdMarkBeforeIfNeeded(
  acc: { text: string },
  ctx: MobiImageCtx,
  sectionStem: string,
  anchorKey: string | undefined,
  footnoteBodyTargetId: string | null,
): void {
  if (!anchorKey) return;
  const deferRef =
    footnoteBodyTargetId &&
    isFootnoteBodyLogicalTarget(footnoteBodyTargetId) &&
    isFootnoteRefRawElementId(anchorKey);
  if (!deferRef) acc.text += mobiSpanAnchorForElementId(ctx, sectionStem, anchorKey);
}

function appendNoterefBackAnchorAfterLinkIfNeeded(
  acc: { text: string },
  ctx: MobiImageCtx,
  sectionStem: string,
  anchorEl: Element,
  footnoteBodyTargetId: string,
): void {
  if (!isFootnoteBodyLogicalTarget(footnoteBodyTargetId)) return;
  const anchorKey = anchorKeyOf(anchorEl);
  if (anchorKey && isFootnoteRefRawElementId(anchorKey)) {
    acc.text += mobiSpanAnchorForElementId(ctx, sectionStem, anchorKey);
    return;
  }
  if (anchorKey) return;
  acc.text += noterefBackAnchorSpanForTarget(ctx, footnoteBodyTargetId);
}

function appendMobiMdLink(
  acc: { text: string },
  ctx: MobiImageCtx,
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

function normalizeSpace(s: string): string {
  return s.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function sniffImageExt(u8: Uint8Array): string {
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xd8) return ".jpg";
  if (
    u8.length >= 8 &&
    u8[0] === 0x89 &&
    u8[1] === 0x50 &&
    u8[2] === 0x4e &&
    u8[3] === 0x47
  ) {
    return ".png";
  }
  if (u8.length >= 6 && u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) {
    return ".gif";
  }
  if (
    u8.length >= 12 &&
    u8[0] === 0x52 &&
    u8[1] === 0x49 &&
    u8[2] === 0x46 &&
    u8[8] === 0x57 &&
    u8[9] === 0x45 &&
    u8[10] === 0x42 &&
    u8[11] === 0x50
  ) {
    return ".webp";
  }
  return ".bin";
}

function asArrayBuffer(buf: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (buf instanceof ArrayBuffer) return buf;
  const u = buf;
  const out = new ArrayBuffer(u.byteLength);
  new Uint8Array(out).set(u);
  return out;
}

function isNonImageResourceMagic(u8: Uint8Array): boolean {
  if (u8.byteLength < 4) return false;
  const m = String.fromCharCode(u8[0]!, u8[1]!, u8[2]!, u8[3]!);
  return m === "FONT" || m === "VIDE" || m === "AUDI" || m === "RESC" || m === "PAGE";
}

/** recindex / kindle:embed 偶发指向非二进制图（如内嵌 HTML），避免当图片落盘 */
function looksLikeMarkupNotImage(u8: Uint8Array): boolean {
  const n = Math.min(64, u8.byteLength);
  let head = "";
  for (let i = 0; i < n; i++) head += String.fromCharCode(u8[i]!);
  const t = head.trimStart().toLowerCase();
  return (
    t.startsWith("<!doctype") ||
    t.startsWith("<?xml") ||
    t.startsWith("<html") ||
    t.startsWith("<body") ||
    t.startsWith("<div")
  );
}

async function exportImageRelFromBuffer(
  data: ArrayBuffer,
  dedupeKey: string,
  ctx: MobiImageCtx,
): Promise<string | null> {
  if (data.byteLength === 0) return null;
  const u8 = new Uint8Array(data);
  if (isNonImageResourceMagic(u8)) return null;
  if (looksLikeMarkupNotImage(u8)) return null;

  const existing = ctx.exportedByKey.get(dedupeKey);
  if (existing) return existing;

  const ext = sniffImageExt(u8);
  let rel = "";
  for (let n = ctx.seq; ; n += 1) {
    const fname = `img_${n}${ext}`;
    const tryRel = `${ctx.imagesFolderRel}/${fname}`;
    if (!ctx.usedRelKeys.has(tryRel.toLowerCase())) {
      rel = tryRel;
      ctx.seq = n + 1;
      break;
    }
  }
  ctx.usedRelKeys.add(rel.toLowerCase());
  ctx.exportedByKey.set(dedupeKey, rel);
  ctx.imageWrites.push({ relativePath: rel, data });
  return rel;
}

async function pushImageFromBuffer(
  data: ArrayBuffer,
  dedupeKey: string,
  ctx: MobiImageCtx,
  out: string[],
): Promise<void> {
  const rel = await exportImageRelFromBuffer(data, dedupeKey, ctx);
  if (rel) out.push(formatMdBlockImage(rel));
}

async function loadMobiImageFromElement(
  el: Element,
  innerMobi: InnerMobi,
): Promise<{ buf: ArrayBuffer; dedupeKey: string } | null> {
  const recindex = el.getAttribute("recindex")?.trim();
  const src = el.getAttribute("src")?.trim() ?? "";

  let buf: ArrayBuffer | null = null;
  let dedupeKey = "";

  if (recindex && /^\d+$/.test(recindex)) {
    dedupeKey = `rec:${recindex}`;
    try {
      buf = asArrayBuffer(await innerMobi.loadResource(Number(recindex) - 1));
    } catch {
      buf = null;
    }
  } else if (/^kindle:/i.test(src)) {
    const km = src.match(/^kindle:(flow|embed):(\w+)/i);
    if (!km) return null;
    if (km[1]!.toLowerCase() === "flow") return null;
    const id = parseInt(km[2]!, 32);
    if (!Number.isFinite(id)) return null;
    dedupeKey = `kid:${id}`;
    try {
      buf = asArrayBuffer(await innerMobi.loadResource(id - 1));
    } catch {
      buf = null;
    }
  }

  if (!buf) return null;
  return { buf, dedupeKey };
}

async function exportImageRelFromMobiElement(
  el: Element,
  ctx: MobiImageCtx,
  innerMobi: InnerMobi,
): Promise<string | null> {
  const loaded = await loadMobiImageFromElement(el, innerMobi);
  if (!loaded) return null;
  return exportImageRelFromBuffer(loaded.buf, loaded.dedupeKey, ctx);
}

async function resolveMobiAnchorInternalTargetId(
  href: string,
  fileposAttr: string | null | undefined,
  sectionIndex: number,
  numSections: number,
  fileposMap: ReadonlyMap<string, MobiFileposEntry> | undefined,
  book: OpenedMobiBook,
): Promise<string | null> {
  let h = href.trim();
  const fp = fileposAttr?.trim();
  if (!h && fp && /^\d+$/.test(fp)) h = `filepos:${fp}`;
  let tid = resolveMobiInternalLinkTargetId(
    h,
    sectionIndex,
    numSections,
    fileposMap,
  );
  if (!tid) tid = await resolveMobiKindlePosTarget(book, h);
  return tid;
}

async function appendInlineLinkIconToMobiAcc(
  acc: { text: string },
  imgEl: Element,
  anchorEl: Element,
  targetId: string,
  ctx: MobiImageCtx,
  sectionStem: string,
  innerMobi: InnerMobi,
): Promise<void> {
  const rel = await exportImageRelFromMobiElement(imgEl, ctx, innerMobi);
  const label = resolveLinkIconVisibleLabel(imgEl, anchorEl);
  const hoverTip = resolveLinkIconHoverTip(imgEl, anchorEl);
  const iconRel = rel ?? undefined;
  if (iconRel && !ctx.footnoteIconRel) {
    ctx.footnoteIconRel = iconRel;
  }
  const slash = hoverTip.indexOf("/");
  const anchorKey = anchorKeyOf(anchorEl);
  appendAnchorIdMarkBeforeIfNeeded(acc, ctx, sectionStem, anchorKey, targetId);
  appendMobiMdLink(acc, ctx, targetId, {
    label,
    iconRel,
    title: slash >= 0 ? hoverTip.slice(0, slash) : hoverTip,
    alt: slash >= 0 ? hoverTip.slice(slash + 1) : undefined,
  });
  appendNoterefBackAnchorAfterLinkIfNeeded(
    acc,
    ctx,
    sectionStem,
    anchorEl,
    targetId,
  );
}

async function tryAppendInlineLinkIconFromMobiAnchor(
  acc: { text: string },
  anchorEl: Element,
  ctx: MobiImageCtx,
  innerMobi: InnerMobi,
  sectionIndex: number,
  numSections: number,
  fileposMap: ReadonlyMap<string, MobiFileposEntry> | undefined,
  book: OpenedMobiBook,
): Promise<boolean> {
  const onlyImg = anchorContainsOnlyImage(anchorEl);
  if (!onlyImg) return false;
  const href = getElementLinkHref(anchorEl);
  if (!isInternalLinkAnchorHref(href)) return false;
  const tid = await resolveMobiAnchorInternalTargetId(
    href,
    anchorEl.getAttribute("filepos"),
    sectionIndex,
    numSections,
    fileposMap,
    book,
  );
  if (!tid) return false;
  await appendInlineLinkIconToMobiAcc(
    acc,
    onlyImg,
    anchorEl,
    tid,
    ctx,
    mobiSectionStem(sectionIndex),
    innerMobi,
  );
  return true;
}

async function resolveMobiLinkIconTarget(
  imgEl: Element,
  sectionIndex: number,
  numSections: number,
  fileposMap: ReadonlyMap<string, MobiFileposEntry> | undefined,
  book: OpenedMobiBook,
): Promise<{ anchor: Element; targetId: string } | null> {
  const directAnchor = findInternalLinkAnchorParent(imgEl);
  if (directAnchor) {
    const tid = await resolveMobiAnchorInternalTargetId(
      getElementLinkHref(directAnchor),
      directAnchor.getAttribute("filepos"),
      sectionIndex,
      numSections,
      fileposMap,
      book,
    );
    if (tid) return { anchor: directAnchor, targetId: tid };
  }
  if (isInsideNoterefContext(imgEl)) {
    let cur: Element | null = imgEl.parentElement;
    while (cur) {
      if (cur.tagName.toLowerCase() === "a") {
        const href = cur.getAttribute("href")?.trim() ?? "";
        if (isInternalLinkAnchorHref(href)) {
          const tid = await resolveMobiAnchorInternalTargetId(
            href,
            cur.getAttribute("filepos"),
            sectionIndex,
            numSections,
            fileposMap,
            book,
          );
          if (tid) return { anchor: cur, targetId: tid };
        }
      }
      cur = cur.parentElement;
    }
  }
  return null;
}

async function handleMobiImageElement(
  el: Element,
  out: string[],
  ctx: MobiImageCtx,
  innerMobi: InnerMobi,
): Promise<void> {
  const loaded = await loadMobiImageFromElement(el, innerMobi);
  if (!loaded) return;
  await pushImageFromBuffer(loaded.buf, loaded.dedupeKey, ctx, out);
}

async function flushParagraph(acc: { text: string }, out: string[]): Promise<void> {
  const raw = normalizeSpace(acc.text);
  acc.text = "";
  if (raw.length > 0) out.push(raw);
}

/** 内链/锚点逻辑键前缀：按 spine 片段序号区分 HTML 文档（如 `mobi-0003#frag`） */
function mobiSectionStem(sectionIndex: number): string {
  return `mobi-${String(sectionIndex).padStart(4, "0")}`;
}

function resolveMobiInternalLinkTargetId(
  href: string,
  sectionIndex: number,
  numSections: number,
  fileposMap: ReadonlyMap<string, MobiFileposEntry> | undefined,
): string | null {
  const h = href.trim();
  if (!h || /^https?:\/\//i.test(h) || /^mailto:/i.test(h) || /^tel:/i.test(h)) {
    return null;
  }
  if (/^javascript:/i.test(h)) return null;
  if (/^kindle:(?!pos:)/i.test(h)) return null;

  if (/^filepos:/i.test(h)) {
    const dm = /^filepos:(\d+)$/i.exec(h)?.[1];
    if (!dm || !fileposMap) return null;
    const keys = [`filepos${dm}`, `filepos${parseInt(dm, 10)}`];
    for (const k of keys) {
      const e =
        fileposMap.get(k) ?? fileposMap.get(k.toLowerCase());
      if (e) return `${mobiSectionStem(e.sectionIndex)}#${e.anchorId}`;
    }
    return null;
  }

  const hashIdx = h.indexOf("#");
  const pathPart = hashIdx >= 0 ? h.slice(0, hashIdx).trim() : h.trim();
  const fragRaw = hashIdx >= 0 ? h.slice(hashIdx + 1).trim() : "";
  const frag = compactFootnoteLinkFragment(fragRaw);
  const stem = mobiSectionStem(sectionIndex);

  if (!pathPart) {
    if (!frag) return null;
    return `${stem}#${frag}`;
  }

  const bn = pathPart.replace(/\\/g, "/").split("/").pop() ?? pathPart;
  const m = /^mobi-(\d{4})\.xhtml$/i.exec(bn);
  if (m) {
    const idx = parseInt(m[1]!, 10);
    if (Number.isFinite(idx) && idx >= 0 && idx < numSections) {
      const targetStem = mobiSectionStem(idx);
      if (frag) return `${targetStem}#${frag}`;
      return null;
    }
  }

  if (frag) return `${stem}#${frag}`;
  return null;
}

async function walkMobiBlock(
  el: Element,
  out: string[],
  acc: { text: string },
  ctx: MobiImageCtx,
  innerMobi: InnerMobi,
  sectionStem: string,
  sectionIndex: number,
  numSections: number,
  fileposMap: ReadonlyMap<string, MobiFileposEntry> | undefined,
  book: OpenedMobiBook,
): Promise<void> {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      acc.text += node.textContent ?? "";
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const child = node as Element;
    const tag = child.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript") continue;

    if (tag === "img" || tag === "image") {
      if (shouldTreatImgAsLinkIcon({ imgEl: child })) {
        const link = await resolveMobiLinkIconTarget(
          child,
          sectionIndex,
          numSections,
          fileposMap,
          book,
        );
        if (link) {
          await appendInlineLinkIconToMobiAcc(
            acc,
            child,
            link.anchor,
            link.targetId,
            ctx,
            sectionStem,
            innerMobi,
          );
          continue;
        }
      }
      const idAttr = anchorKeyOf(child);
      if (idAttr) {
        acc.text += mobiSpanAnchorForElementId(ctx, sectionStem, idAttr);
      }
      await flushParagraph(acc, out);
      await handleMobiImageElement(child, out, ctx, innerMobi);
      continue;
    }
    if (tag === "br" || tag === "hr") {
      acc.text += " ";
      continue;
    }
    if (tag === "a") {
      const anchorKey = anchorKeyOf(child);
      if (
        await tryAppendInlineLinkIconFromMobiAnchor(
          acc,
          child,
          ctx,
          innerMobi,
          sectionIndex,
          numSections,
          fileposMap,
          book,
        )
      ) {
        continue;
      } else if (anchorContainsOnlyImage(child)) {
        continue;
      }
      let href = child.getAttribute("href")?.trim() ?? "";
      const fpAttr = child.getAttribute("filepos")?.trim();
      if (!href && fpAttr && /^\d+$/.test(fpAttr)) {
        href = `filepos:${fpAttr}`;
      }
      const label = normalizeSpace(child.textContent ?? "");
      if (isMdExternalLinkHref(href)) {
        if (anchorKey) {
          acc.text += mobiSpanAnchorForElementId(ctx, sectionStem, anchorKey);
        }
        await flushParagraph(acc, out);
        out.push(formatMdExternalLink({ label, url: href }));
      } else {
        let tid = resolveMobiInternalLinkTargetId(
          href,
          sectionIndex,
          numSections,
          fileposMap,
        );
        if (!tid) {
          tid = await resolveMobiKindlePosTarget(book, href);
        }
        if (tid) {
          appendAnchorIdMarkBeforeIfNeeded(
            acc,
            ctx,
            sectionStem,
            anchorKey,
            tid,
          );
          const hover = resolveLinkIconHoverTip(child, child);
          const slash = hover.indexOf("/");
          appendMobiMdLink(acc, ctx, tid, {
            label,
            iconRel:
              label &&
              ctx.footnoteIconRel &&
              isEbookLinkIconStyleLabel(label) &&
              isInsideNoterefContext(child)
                ? ctx.footnoteIconRel
                : undefined,
            title: slash >= 0 ? hover.slice(0, slash) : hover,
            alt: slash >= 0 ? hover.slice(slash + 1) : undefined,
          });
          appendNoterefBackAnchorAfterLinkIfNeeded(
            acc,
            ctx,
            sectionStem,
            child,
            tid,
          );
        } else if (label.length > 0) {
          if (anchorKey) {
            acc.text += mobiSpanAnchorForElementId(ctx, sectionStem, anchorKey);
          }
          acc.text += label;
        } else if (anchorKey) {
          acc.text += mobiSpanAnchorForElementId(ctx, sectionStem, anchorKey);
        }
      }
      continue;
    }

    if (
      tag === "p" ||
      tag === "h1" ||
      tag === "h2" ||
      tag === "h3" ||
      tag === "h4" ||
      tag === "h5" ||
      tag === "h6" ||
      tag === "blockquote" ||
      tag === "li" ||
      tag === "dd" ||
      tag === "dt"
    ) {
      await flushParagraph(acc, out);
      const bid = child.getAttribute("id")?.trim() || child.getAttribute("name")?.trim();
      if (bid) {
        acc.text += mobiSpanAnchorForElementId(ctx, sectionStem, bid);
      }
      await walkMobiBlock(
        child,
        out,
        acc,
        ctx,
        innerMobi,
        sectionStem,
        sectionIndex,
        numSections,
        fileposMap,
        book,
      );
      await flushParagraph(acc, out);
      continue;
    }

    if (
      tag === "div" ||
      tag === "section" ||
      tag === "article" ||
      tag === "center" ||
      tag === "span" ||
      tag === "table" ||
      tag === "tbody" ||
      tag === "tr" ||
      tag === "td" ||
      tag === "th" ||
      tag === "font" ||
      tag === "b" ||
      tag === "strong" ||
      tag === "i" ||
      tag === "em"
    ) {
      const idAttr = child.getAttribute("id")?.trim() || child.getAttribute("name")?.trim();
      if (idAttr) {
        acc.text += mobiSpanAnchorForElementId(ctx, sectionStem, idAttr);
      }
      await walkMobiBlock(
        child,
        out,
        acc,
        ctx,
        innerMobi,
        sectionStem,
        sectionIndex,
        numSections,
        fileposMap,
        book,
      );
      continue;
    }

    await walkMobiBlock(
      child,
      out,
      acc,
      ctx,
      innerMobi,
      sectionStem,
      sectionIndex,
      numSections,
      fileposMap,
      book,
    );
  }
}

async function mobiBodyToLines(
  body: HTMLElement,
  ctx: MobiImageCtx,
  innerMobi: InnerMobi,
  sectionIndex: number,
  numSections: number,
  fileposMap: ReadonlyMap<string, MobiFileposEntry> | undefined,
  book: OpenedMobiBook,
): Promise<string[]> {
  const out: string[] = [];
  const acc = { text: "" };
  const stem = mobiSectionStem(sectionIndex);
  await walkMobiBlock(
    body,
    out,
    acc,
    ctx,
    innerMobi,
    stem,
    sectionIndex,
    numSections,
    fileposMap,
    book,
  );
  await flushParagraph(acc, out);
  return out;
}

function unzlibForMobi(data: Uint8Array): Uint8Array {
  try {
    return inflate(data);
  } catch {
    try {
      return inflate(data, { windowBits: 15 });
    } catch {
      return inflate(data, { raw: true });
    }
  }
}

/**
 * 按 foliate `book.toc` + `splitTOCHref` 注入 ATX 目录（不经过 EPUB 式 targetId 扁平化）。
 */
async function injectFoliateMobiTocIntoLines(
  lines: string[],
  sectionRanges: readonly EpubSpineSectionRange[],
  book: OpenedMobiBook,
  registry: EbookMarkdownFragmentRegistry,
): Promise<boolean> {
  let tree = book.toc;
  if (!tree?.length) {
    tree = await buildMobiTocTreeFromNcx(book);
  }
  if (!tree?.length) return false;

  const sectionByStem = sectionRangeByStem(sectionRanges);
  const mutations: LineMutation[] = [];
  const searchStartByStem = new Map<string, number>();
  let tocCounter = 0;

  async function walk(
    items: readonly FoliateTocNode[],
    level: number,
  ): Promise<void> {
    for (const item of items) {
      const title = item.label?.replace(/\s+/g, " ").trim();
      const href = item.href?.trim();
      if (!title || !href) {
        if (item.subitems?.length) await walk(item.subitems, level + 1);
        continue;
      }

      let sectionIndex = -1;
      const split = splitMobiTocHref(href, book);
      if (split) {
        sectionIndex = split.sectionIndex;
      } else if (typeof book.resolveHref === "function") {
        try {
          const res = (await Promise.resolve(book.resolveHref(href))) as {
            index?: number;
          };
          if (typeof res?.index === "number") sectionIndex = res.index;
        } catch {
          // ignore
        }
      }
      if (sectionIndex < 0) {
        if (item.subitems?.length) await walk(item.subitems, level + 1);
        continue;
      }

      const stem = mobiSectionStem(sectionIndex);
      const range = sectionByStem.get(stem);
      if (!range) {
        if (item.subitems?.length) await walk(item.subitems, level + 1);
        continue;
      }

      tocCounter += 1;
      const logicalAnchor = `${stem}#toc_${tocCounter}`;
      const span = formatSpanAnchor(
        globalFragmentForLogicalTarget(registry, logicalAnchor, `toc_${tocCounter}`),
      );
      const searchStart = Math.max(
        range.startLine,
        searchStartByStem.get(stem) ?? range.startLine,
      );

      const lineIdx = resolveTocInjectLineIdx(
        lines,
        searchStart,
        range.endLine,
        title,
      );

      queueTocHeadingMutations(mutations, lines, {
        lineIdx,
        rangeStartLine: range.startLine,
        span,
        title,
        level,
      });
      searchStartByStem.set(
        stem,
        lineIdx != null ? lineIdx + 1 : range.startLine + 1,
      );

      if (item.subitems?.length) await walk(item.subitems, level + 1);
    }
  }

  await walk(tree, 0);
  if (mutations.length > 0) {
    applyLineMutations(lines, mutations);
  }
  return mutations.length > 0;
}

export async function convertMobiToArtifacts(
  buffer: ArrayBuffer,
  outputBase: string,
): Promise<EbookMarkdownArtifacts> {
  const file = new ArrayBufferMobiFile(buffer);
  if (!(await isMOBI(file))) {
    throw new Error("不是有效的 MOBI（BOOKMOBI）文件。");
  }

  const mobi = new MOBI({ unzlib: unzlibForMobi });
  const book = (await mobi.open(file)) as OpenedMobiBook;
  const innerMobi = book.mobi;

  const imagesFolderRel = `${outputBase}.Images`;
  const fragments = new EbookMarkdownFragmentRegistry();
  const ctx: MobiImageCtx = {
    imagesFolderRel,
    imageWrites: [],
    usedRelKeys: new Set(),
    exportedByKey: new Map(),
    seq: 0,
    fragments,
  };

  const lines: string[] = [];
  const sectionRanges: {
    stem: string;
    startLine: number;
    endLine: number;
  }[] = [];

  try {
    const metadataTitle = book.metadata?.title?.trim();

    const numSections = book.sections.length;
    const fileposMap = await buildMobiFileposAnchorMap(book);

    for (let si = 0; si < book.sections.length; si++) {
      const sec = book.sections[si];
      if (!sec || typeof sec.createDocument !== "function") continue;
      let doc: Document;
      try {
        doc = await sec.createDocument();
      } catch {
        continue;
      }
      const perr = doc.querySelector("parsererror");
      if (perr) continue;
      const body = doc.querySelector("body");
      if (!body) continue;

      const sectionStart = lines.length;
      const chunk = await mobiBodyToLines(
        body,
        ctx,
        innerMobi,
        si,
        numSections,
        fileposMap,
        book,
      );
      for (const ln of chunk) {
        if (ln.trim().length > 0) lines.push(ln);
      }
      lines.push("");
      sectionRanges.push({
        stem: mobiSectionStem(si),
        startLine: sectionStart,
        endLine: lines.length - 1,
      });
      await yieldToUi();
    }

    const tocInjected = await injectFoliateMobiTocIntoLines(
      lines,
      sectionRanges,
      book,
      fragments,
    );
    if (metadataTitle && !tocInjected) {
      lines.unshift(`# ${metadataTitle}`, "");
    }
    injectStemOnlyMdLinkAnchors(lines, sectionRanges, fragments);

    const utf8 = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";

    const out: EbookMarkdownArtifacts = { utf8 };
    if (ctx.imageWrites.length > 0) {
      out.imageWrites = ctx.imageWrites;
    }
    return out;
  } finally {
    try {
      book.destroy?.();
    } catch {
      // ignore
    }
  }
}
