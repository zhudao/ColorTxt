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
import { injectEpubTocAnchorsIntoLines } from "./ebookTocAnchorInjection";
import {
  type EmbeddedTocEntry,
} from "./ebookTocTypes";
import {
  anchorContainsOnlyFb2Image,
  findInternalLinkAnchorParent,
  getElementLinkHref,
  resolveLinkIconHoverTip,
  resolveLinkIconVisibleLabel,
  shouldTreatImgAsLinkIcon,
} from "./ebookLinkIconHeuristics";

function extFromContentType(ct: string): string {
  const t = ct.split(";")[0]!.trim().toLowerCase();
  if (t === "image/jpeg" || t === "image/jpg") return ".jpg";
  if (t === "image/png") return ".png";
  if (t === "image/gif") return ".gif";
  if (t === "image/webp") return ".webp";
  if (t === "image/svg+xml") return ".svg";
  if (t === "image/bmp") return ".bmp";
  return ".bin";
}

function decodeBinaryBase64(innerText: string): Uint8Array | null {
  const compact = innerText.replace(/\s+/g, "");
  if (!compact) return null;
  try {
    const bin = atob(compact);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)!;
    return u8;
  } catch {
    return null;
  }
}

type Fb2ImageCtx = {
  imagesFolderRel: string;
  imageWrites: Array<{ relativePath: string; data: ArrayBuffer }>;
  usedRelKeys: Set<string>;
  idToRel: Map<string, string>;
  fragments: EbookMarkdownFragmentRegistry;
};

function fb2SpanAnchor(
  ctx: Fb2ImageCtx,
  outputBase: string,
  idAttr: string,
): string {
  return spanAnchorForLogicalTarget(
    ctx.fragments,
    `${outputBase}#${idAttr}`,
    idAttr,
  );
}

function appendFb2MdLink(
  acc: { text: string },
  ctx: Fb2ImageCtx,
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

function getFb2ImageHref(el: Element): string {
  const xlink = el.getAttributeNS("http://www.w3.org/1999/xlink", "href")?.trim();
  if (xlink) return xlink;
  const href = el.getAttribute("href")?.trim();
  return href ?? "";
}

function exportImageRelForBinaryId(
  href: string,
  binaryById: Map<string, ArrayBuffer>,
  idToContentType: Map<string, string>,
  ctx: Fb2ImageCtx,
): string | null {
  if (!href.startsWith("#")) return null;
  const id = href.slice(1).trim();
  if (!id) return null;

  const existing = ctx.idToRel.get(id);
  if (existing) return existing;

  const data = binaryById.get(id);
  if (!data || data.byteLength === 0) return null;

  const ct = idToContentType.get(id) ?? "";
  const ext = extFromContentType(ct);
  const safeStem = id.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_").replace(/^\.+/, "") || "image";
  const base = `${safeStem}${ext}`;

  let rel = "";
  const dot = base.lastIndexOf(".");
  const stem0 = dot > 0 ? base.slice(0, dot) : base;
  const ext0 = dot > 0 ? base.slice(dot) : "";
  for (let n = 0; ; n += 1) {
    const fname = n === 0 ? base : `${stem0}_${n}${ext0}`;
    const tryRel = `${ctx.imagesFolderRel}/${fname}`;
    if (!ctx.usedRelKeys.has(tryRel.toLowerCase())) {
      rel = tryRel;
      break;
    }
  }

  ctx.usedRelKeys.add(rel.toLowerCase());
  ctx.idToRel.set(id, rel);
  ctx.imageWrites.push({ relativePath: rel, data });
  return rel;
}

function pushImageLineForBinaryId(
  href: string,
  binaryById: Map<string, ArrayBuffer>,
  idToContentType: Map<string, string>,
  ctx: Fb2ImageCtx,
  out: string[],
): void {
  const rel = exportImageRelForBinaryId(href, binaryById, idToContentType, ctx);
  if (rel) out.push(formatMdBlockImage(rel));
}

function flushAccParagraph(acc: { text: string }, out: string[]): void {
  const raw = acc.text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  acc.text = "";
  if (raw) out.push(raw);
}

function walkFb2Inline(
  el: Element,
  acc: { text: string },
  binaryById: Map<string, ArrayBuffer>,
  idToContentType: Map<string, string>,
  ctx: Fb2ImageCtx,
  out: string[],
  outputBase: string,
): void {
  const selfId = el.getAttribute("id")?.trim() || el.getAttribute("name")?.trim();
  if (selfId) {
    acc.text += fb2SpanAnchor(ctx, outputBase, selfId);
  }

  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      acc.text += node.textContent ?? "";
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const child = node as Element;
    const tag = child.localName.toLowerCase();
    if (tag === "image") {
      if (shouldTreatImgAsLinkIcon({ imgEl: child })) {
        const anchor = findInternalLinkAnchorParent(child);
        if (anchor) {
          const href = getElementLinkHref(anchor);
          if (href.startsWith("#")) {
            const frag = href.slice(1).trim();
            if (frag) {
              const tid = `${outputBase}#${frag}`;
              const imgHref = getFb2ImageHref(child);
              const rel = exportImageRelForBinaryId(
                imgHref,
                binaryById,
                idToContentType,
                ctx,
              );
              const label = resolveLinkIconVisibleLabel(child, anchor);
              const hoverTip = resolveLinkIconHoverTip(child, anchor);
              const slash = hoverTip.indexOf("/");
              appendFb2MdLink(acc, ctx, tid, {
                label,
                iconRel: rel ?? undefined,
                title: slash >= 0 ? hoverTip.slice(0, slash) : hoverTip,
                alt: slash >= 0 ? hoverTip.slice(slash + 1) : undefined,
              });
              continue;
            }
          }
        }
      }
      flushAccParagraph(acc, out);
      const href = getFb2ImageHref(child);
      pushImageLineForBinaryId(href, binaryById, idToContentType, ctx, out);
      continue;
    }
    if (tag === "a") {
      const anchorKey = child.getAttribute("id")?.trim() || child.getAttribute("name")?.trim();
      if (anchorKey) {
        acc.text += fb2SpanAnchor(ctx, outputBase, anchorKey);
      }
      const href = getElementLinkHref(child);
      const onlyImage = anchorContainsOnlyFb2Image(child);
      if (onlyImage && href.startsWith("#")) {
        const frag = href.slice(1).trim();
        if (frag) {
          const tid = `${outputBase}#${frag}`;
          const imgHref = getFb2ImageHref(onlyImage);
          const rel = exportImageRelForBinaryId(
            imgHref,
            binaryById,
            idToContentType,
            ctx,
          );
          const label = resolveLinkIconVisibleLabel(onlyImage, child);
          const hoverTip = resolveLinkIconHoverTip(onlyImage, child);
          const slash = hoverTip.indexOf("/");
          appendFb2MdLink(acc, ctx, tid, {
            label,
            iconRel: rel ?? undefined,
            title: slash >= 0 ? hoverTip.slice(0, slash) : hoverTip,
            alt: slash >= 0 ? hoverTip.slice(slash + 1) : undefined,
          });
          continue;
        }
      }
      const label = (child.textContent ?? "").replace(/\s+/g, " ").trim();
      if (isMdExternalLinkHref(href)) {
        acc.text += formatMdExternalLink({ label, url: href });
      } else if (href.startsWith("#")) {
        const frag = href.slice(1).trim();
        if (frag) {
          const tid = `${outputBase}#${frag}`;
          appendFb2MdLink(acc, ctx, tid, { label: label || "" });
        } else if (label) {
          acc.text += label;
        }
      } else if (label) {
        acc.text += label;
      }
      continue;
    }
    if (tag === "empty-line") {
      acc.text += "\n";
      continue;
    }
    walkFb2Inline(child, acc, binaryById, idToContentType, ctx, out, outputBase);
  }
}

function collectBinaryMaps(doc: Document): {
  binaryById: Map<string, ArrayBuffer>;
  idToContentType: Map<string, string>;
} {
  const binaryById = new Map<string, ArrayBuffer>();
  const idToContentType = new Map<string, string>();
  const list = doc.getElementsByTagNameNS("*", "binary");
  for (let i = 0; i < list.length; i++) {
    const el = list[i]!;
    const id = el.getAttribute("id")?.trim();
    if (!id) continue;
    const ct = el.getAttribute("content-type")?.trim() ?? "";
    const u8 = decodeBinaryBase64(el.textContent ?? "");
    if (!u8 || u8.byteLength === 0) continue;
    const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
    binaryById.set(id, buf);
    idToContentType.set(id, ct);
  }
  return { binaryById, idToContentType };
}

function collectFb2EmbeddedTocEntries(
  body: Element,
  outputBase: string,
): EmbeddedTocEntry[] {
  const out: EmbeddedTocEntry[] = [];
  const walkSection = (el: Element, depth: number) => {
    const ln = el.localName.toLowerCase();
    if (ln !== "section") {
      for (const c of el.children) walkSection(c as Element, depth);
      return;
    }
    const sid = el.getAttribute("id")?.trim() || el.getAttribute("name")?.trim();
    let title: string | null = null;
    for (const c of el.children) {
      if (c.localName.toLowerCase() === "title") {
        title = (c.textContent ?? "").replace(/\s+/g, " ").trim() || null;
        break;
      }
    }
    if (title && sid) {
      out.push({
        title,
        targetId: `${outputBase}#${sid}`,
        level: depth,
      });
    }
    for (const c of el.children) {
      if (c.localName.toLowerCase() === "section") {
        walkSection(c as Element, depth + 1);
      }
    }
  };
  for (const c of body.children) walkSection(c as Element, 0);
  return out;
}

/** 文档序遍历 body：`section` 的 id 单独成行，再处理 title/subtitle/p/v */
function walkFb2Body(
  body: Element,
  binaryById: Map<string, ArrayBuffer>,
  idToContentType: Map<string, string>,
  ctx: Fb2ImageCtx,
  outLines: string[],
  outputBase: string,
): void {
  const walk = (el: Element) => {
    const ln = el.localName.toLowerCase();
    if (ln === "section") {
      const sid = el.getAttribute("id")?.trim() || el.getAttribute("name")?.trim();
      if (sid) {
        outLines.push(fb2SpanAnchor(ctx, outputBase, sid));
      }
      for (const c of el.children) walk(c as Element);
      return;
    }
    if (ln === "title" || ln === "subtitle" || ln === "p" || ln === "v") {
      const acc = { text: "" };
      walkFb2Inline(el, acc, binaryById, idToContentType, ctx, outLines, outputBase);
      flushAccParagraph(acc, outLines);
      return;
    }
    for (const c of el.children) walk(c as Element);
  };
  for (const c of body.children) walk(c as Element);
}

export async function convertFb2ToArtifacts(
  buffer: ArrayBuffer,
  isFbz: boolean,
  outputBase: string,
): Promise<EbookMarkdownArtifacts> {
  let xmlText: string;

  if (isFbz) {
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).filter(
      (n) => !zip.files[n]!.dir && n.toLowerCase().endsWith(".fb2"),
    );
    if (names.length === 0) throw new Error("FBZ 压缩包内未找到 .fb2 文件");
    const fb2Name = names.sort()[0]!;
    xmlText = (await zip.file(fb2Name)!.async("string")) as string;
  } else {
    xmlText = new TextDecoder("utf-8").decode(new Uint8Array(buffer));
  }

  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const title =
    doc.querySelector("description > book-title")?.textContent?.trim() ||
    doc.querySelector("description > title")?.textContent?.trim();

  const bodyList = doc.getElementsByTagNameNS("*", "body");
  const body =
    bodyList.length > 0 ? bodyList[0]! : (doc.querySelector("body") as Element | null);
  if (!body) throw new Error("FB2 缺少 body");

  const { binaryById, idToContentType } = collectBinaryMaps(doc);

  const imagesFolderRel = `${outputBase}.Images`;
  const fragments = new EbookMarkdownFragmentRegistry();
  const ctx: Fb2ImageCtx = {
    imagesFolderRel,
    imageWrites: [],
    usedRelKeys: new Set(),
    idToRel: new Map(),
    fragments,
  };

  const outLines: string[] = [];
  if (title) {
    outLines.push(`# ${title}`, "");
  }

  walkFb2Body(body, binaryById, idToContentType, ctx, outLines, outputBase);

  const tocEntries = collectFb2EmbeddedTocEntries(body, outputBase);
  const sectionRanges = [
    {
      stem: outputBase,
      startLine: 0,
      endLine: Math.max(0, outLines.length - 1),
    },
  ];
  injectEpubTocAnchorsIntoLines(
    outLines,
    sectionRanges,
    tocEntries,
    fragments,
  );

  const utf8 = outLines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  const out: EbookMarkdownArtifacts = { utf8 };
  if (ctx.imageWrites.length > 0) out.imageWrites = ctx.imageWrites;
  return out;
}
