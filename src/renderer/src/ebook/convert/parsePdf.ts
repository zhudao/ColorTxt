import {
  AnnotationType,
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { EbookMarkdownArtifacts } from "./ebookTypes";
import {
  atxHeadingPrefix,
  EbookMarkdownFragmentRegistry,
  formatMdBlockImage,
  formatSpanAnchor,
  globalFragmentForLogicalTarget,
  mdInternalLinkForLogicalTarget,
  spanAnchorForLogicalTarget,
} from "./ebookMarkdownEmit";
import {
  pushTocAnchorAndHeading,
  queueTocHeadingMutations,
} from "./ebookTocAnchorInjection";
import {
  dedupeEmbeddedTocEntries,
  type EmbeddedTocEntry,
} from "./ebookTocTypes";
import { chapterTitleForDisplay } from "../../chapter";
import { plainTextForEbookTitleMatch } from "../ebookTitleMatch";
import { yieldToUi } from "../yieldToUi";
import {
  applyLineMutations,
  findLineByFragmentInSpineSection,
  type LineMutation,
} from "./ebookSpineLineMatch";
import {
  allocPdfImageRelPath,
  buildPdfImageCatalog,
  configurePdfImageDecoders,
  decodePdfXObjectImage,
  type PdfImageCatalog,
} from "./parsePdfImages";

let workerConfigured = false;

/**
 * 打包进渲染进程的 pdfjs-dist 静态目录（cmaps / wasm 等）。
 * 相对当前页面，开发态与 `loadFile` 生产页都能命中（勿用根路径 `/pdfjs/`）。
 */
function pdfjsBundledAssetUrl(subdir: string): string {
  return new URL(`pdfjs/${subdir}/`, document.baseURI).href;
}

/** 行内空白折叠与多余空行压缩（在已含 `\n` 的抽取串上使用）。 */
function normalizePdfExtractedPageText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").replace(/[ \t\f\v]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type PdfTextPiece = {
  str: string;
  hasEOL: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

function extractPdfTextPieces(items: unknown[]): PdfTextPiece[] {
  const out: PdfTextPiece[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const o = item as {
      str?: unknown;
      hasEOL?: boolean;
      transform?: unknown;
      width?: unknown;
      height?: unknown;
    };
    const str = typeof o.str === "string" ? o.str : "";
    const hasEOL = Boolean(o.hasEOL);
    if (!str && !hasEOL) continue;

    const tr = Array.isArray(o.transform) ? (o.transform as number[]) : null;
    const w = typeof o.width === "number" ? o.width : 0;
    const h =
      typeof o.height === "number"
        ? o.height
        : tr && tr.length >= 4
          ? Math.abs(tr[3]!)
          : 0;

    let x0 = 0;
    let y0 = 0;
    let x1 = 0;
    let y1 = 0;
    if (tr && tr.length >= 6) {
      const [a, b, c, d, e, f] = tr;
      const corners: [number, number][] = [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ].map(([tx, ty]) => [a! * tx + c! * ty + e!, b! * tx + d! * ty + f!]);
      const xs = corners.map((p) => p[0]!);
      const ys = corners.map((p) => p[1]!);
      x0 = Math.min(...xs);
      x1 = Math.max(...xs);
      y0 = Math.min(...ys);
      y1 = Math.max(...ys);
    }

    out.push({ str, hasEOL, x0, y0, x1, y1 });
  }
  return out;
}

function rectsOverlapPdf(
  ax0: number,
  ay0: number,
  ax1: number,
  ay1: number,
  bx0: number,
  by0: number,
  bx1: number,
  by1: number,
  slack = 1,
): boolean {
  return (
    ax1 + slack >= bx0 - slack &&
    ax0 - slack <= bx1 + slack &&
    ay1 + slack >= by0 - slack &&
    ay0 - slack <= by1 + slack
  );
}

function linkAnnotationHitRect(ann: Record<string, unknown>): [number, number, number, number] | null {
  const qp = ann.quadPoints;
  if (qp && typeof qp === "object" && "length" in qp && (qp as Float32Array).length >= 8) {
    const arr = qp as Float32Array;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < arr.length; i += 2) {
      const x = arr[i]!;
      const y = arr[i + 1]!;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (Number.isFinite(minX)) return [minX, minY, maxX, maxY];
  }
  const rect = ann.rect;
  if (Array.isArray(rect) && rect.length >= 4) {
    return [rect[0] as number, rect[1] as number, rect[2] as number, rect[3] as number];
  }
  return null;
}

type DocLinkResolve = {
  getDestination: (name: string) => Promise<unknown>;
  getPageIndex: (ref: object) => Promise<number>;
};

/** pdf.js `getOutline()` 节点（PDF 文档大纲 / 书签） */
type PdfOutlineNode = {
  title: string;
  dest: unknown;
  items?: PdfOutlineNode[];
};

type PdfDocWithOutline = DocLinkResolve & {
  getOutline: () => Promise<PdfOutlineNode[] | null>;
};

type PdfTocEntry = EmbeddedTocEntry & {
  /** PDF 书签 dest 纵坐标（与 textContent transform 同系），用于同页多节定位 */
  destY?: number;
};

type PdfPagePlain = {
  plain: string;
  /** 与 `plain.split("\n")` 等长；每行抽取文本的纵向中心 */
  lineYs: number[];
};

function destTopYFromPdfDestArray(d: readonly unknown[]): number | undefined {
  const xyzIdx = d.findIndex(
    (x) =>
      x === "XYZ" ||
      (typeof x === "object" &&
        x != null &&
        "name" in x &&
        (x as { name?: string }).name === "XYZ"),
  );
  if (xyzIdx >= 0 && xyzIdx + 2 < d.length) {
    const top = d[xyzIdx + 2];
    if (typeof top === "number" && Number.isFinite(top)) return top;
  }
  if (d[1] === "XYZ" && typeof d[3] === "number" && Number.isFinite(d[3])) {
    return d[3];
  }
  return undefined;
}

async function resolvePdfDest(
  doc: DocLinkResolve,
  dest: unknown,
): Promise<{ page: number; y?: number } | null> {
  let resolved = dest;
  if (typeof resolved === "string") {
    resolved = await doc.getDestination(resolved);
    if (!resolved) return null;
  }
  const page = await pdfDestToOneBasedPage(doc, resolved);
  if (page == null) return null;
  const y = Array.isArray(resolved)
    ? destTopYFromPdfDestArray(resolved)
    : undefined;
  return { page, y };
}

function findPdfLineByDestY(
  lines: readonly string[],
  lineCenterY: readonly number[],
  start: number,
  end: number,
  destY: number,
  title: string,
  usedLines: ReadonlySet<number>,
): number | null {
  const want = chapterTitleForDisplay(title);
  const maxPlainLen = Math.max(32, (want?.length ?? 0) * 2);
  let best: number | null = null;
  let bestDist = Infinity;
  for (let i = start; i <= end; i++) {
    if (usedLines.has(i)) continue;
    const y = lineCenterY[i];
    if (!Number.isFinite(y)) continue;
    const plain = chapterTitleForDisplay(
      plainTextForEbookTitleMatch(lines[i] ?? ""),
    );
    if (plain.length > maxPlainLen) continue;
    const dist = Math.abs(y! - destY);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

type PdfTitleLineHit = {
  lineIdx: number;
  /** 标题被 PDF 抽成两行时，次行索引（升 ATX 后清空） */
  joinLineIdx?: number;
};

/** 页内标题：单行精确 → 相邻两行拼接精确 */
function findPdfTitleLineMatch(
  lines: readonly string[],
  start: number,
  end: number,
  title: string,
  usedLines: ReadonlySet<number>,
): PdfTitleLineHit | null {
  const want = chapterTitleForDisplay(title);
  if (!want) return null;

  for (let i = start; i <= end; i++) {
    if (usedLines.has(i)) continue;
    const plain = chapterTitleForDisplay(
      plainTextForEbookTitleMatch(lines[i] ?? ""),
    );
    if (plain === want) return { lineIdx: i };
  }

  for (let i = start; i < end; i++) {
    if (usedLines.has(i) || usedLines.has(i + 1)) continue;
    const p0 = plainTextForEbookTitleMatch(lines[i] ?? "");
    const p1 = plainTextForEbookTitleMatch(lines[i + 1] ?? "");
    for (const joined of [
      chapterTitleForDisplay(p0 + p1),
      chapterTitleForDisplay(`${p0} ${p1}`),
    ]) {
      if (joined === want) return { lineIdx: i, joinLineIdx: i + 1 };
    }
  }

  return null;
}

/** 与 foliate-js `pdf.js` 一致：从 PDF 书签大纲解析目录项，目标为 `pdf-p{页码}` */
async function collectPdfOutlineEntries(
  doc: DocLinkResolve,
  items: readonly PdfOutlineNode[],
  level: number,
  out: PdfTocEntry[],
): Promise<void> {
  for (const item of items) {
    const title = item.title?.replace(/\s+/g, " ").trim();
    if (title && item.dest != null) {
      const hit = await resolvePdfDest(doc, item.dest);
      if (hit != null) {
        out.push({
          title,
          targetId: `pdf-p${hit.page}`,
          level,
          destY: hit.y,
        });
      }
    }
    const subs = item.items;
    if (subs?.length) {
      await collectPdfOutlineEntries(doc, subs, level + 1, out);
    }
  }
}

/** 各页在 `lines` 中的行号区间（含页锚点行） */
function buildPdfPageLineRanges(
  lines: readonly string[],
  registry: EbookMarkdownFragmentRegistry,
  numPages: number,
): Map<number, { start: number; end: number }> {
  const anchors: { page: number; line: number }[] = [];
  const lastLine = lines.length - 1;
  for (let page = 1; page <= numPages; page++) {
    const frag = registry.resolve(`pdf-p${page}`);
    if (!frag) continue;
    const line = findLineByFragmentInSpineSection(lines, 0, lastLine, frag);
    if (line != null) anchors.push({ page, line });
  }
  anchors.sort((a, b) => a.line - b.line);
  const ranges = new Map<number, { start: number; end: number }>();
  for (let i = 0; i < anchors.length; i++) {
    const { page, line } = anchors[i]!;
    const end =
      i + 1 < anchors.length ? anchors[i + 1]!.line - 1 : lastLine;
    ranges.set(page, { start: line, end: Math.max(line, end) });
  }
  return ranges;
}

function pageNumFromPdfTargetId(targetId: string): number | null {
  const m = /^pdf-p(\d+)$/i.exec(targetId.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

const RE_ATX_HEADING = /^\s{0,3}#{1,6}\s+/;

/**
 * 在对应页内注入 ATX 章节标题。
 * 优先页内精确匹配；同页多节用书签 dest Y；无匹配则跳过（勿堆叠假标题）。
 */
function injectPdfOutlineIntoLines(
  lines: string[],
  tocEntries: readonly PdfTocEntry[],
  registry: EbookMarkdownFragmentRegistry,
  numPages: number,
  lineCenterY: readonly number[],
): void {
  if (tocEntries.length === 0 || lines.length === 0) return;

  const pageRanges = buildPdfPageLineRanges(lines, registry, numPages);
  const mutations: LineMutation[] = [];
  const usedLines = new Set<number>();
  let tocCounter = 0;

  for (const entry of tocEntries) {
    const page = pageNumFromPdfTargetId(entry.targetId);
    if (page == null) continue;
    const range = pageRanges.get(page);
    if (!range) continue;

    const exactHit = findPdfTitleLineMatch(
      lines,
      range.start,
      range.end,
      entry.title,
      usedLines,
    );

    let destYHit: number | null = null;
    if (exactHit == null && entry.destY != null) {
      destYHit = findPdfLineByDestY(
        lines,
        lineCenterY,
        range.start,
        range.end,
        entry.destY,
        entry.title,
        usedLines,
      );
    }

    const titleHit = exactHit?.lineIdx ?? destYHit;
    if (titleHit == null) continue;

    tocCounter += 1;
    const span = formatSpanAnchor(
      globalFragmentForLogicalTarget(
        registry,
        `${entry.targetId}#toc_${tocCounter}`,
        `toc_${tocCounter}`,
      ),
    );

    const raw = lines[titleHit] ?? "";
    const headingLine =
      atxHeadingPrefix(entry.level) + entry.title;

    if (RE_ATX_HEADING.test(raw)) {
      mutations.push({ kind: "insert", at: titleHit, text: span });
    } else if (exactHit != null) {
      queueTocHeadingMutations(mutations, lines, {
        lineIdx: titleHit,
        rangeStartLine: range.start,
        span,
        title: entry.title,
        level: entry.level,
        headingTitleOverride: entry.title,
      });
      if (exactHit.joinLineIdx != null) {
        mutations.push({
          kind: "insert",
          at: exactHit.joinLineIdx,
          text: "",
          replace: true,
        });
        usedLines.add(exactHit.joinLineIdx);
      }
    } else {
      /** dest Y 定位：仅 insert 标题，勿 replace 吞掉正文行 */
      pushTocAnchorAndHeading(
        mutations,
        titleHit,
        span,
        headingLine,
        false,
      );
    }
    usedLines.add(titleHit);
  }

  if (mutations.length > 0) {
    applyLineMutations(lines, mutations);
  }
}

async function pdfDestToOneBasedPage(doc: DocLinkResolve, dest: unknown): Promise<number | null> {
  if (dest == null) return null;
  if (typeof dest === "string") {
    const d = await doc.getDestination(dest);
    if (!d) return null;
    return pdfDestToOneBasedPage(doc, d);
  }
  if (!Array.isArray(dest) || dest.length < 1) return null;
  const p0 = dest[0] as unknown;
  if (p0 && typeof p0 === "object" && "num" in p0 && "gen" in p0) {
    const idx = await doc.getPageIndex(p0 as object);
    return idx + 1;
  }
  if (typeof p0 === "number" && Number.isInteger(p0) && p0 >= 0) {
    return p0 + 1;
  }
  return null;
}

type ResolvedPdfLink = {
  rect: [number, number, number, number];
  external: boolean;
  href: string;
  targetPage: number;
};

async function resolvePdfLinkAnnotation(
  doc: DocLinkResolve,
  ann: Record<string, unknown>,
): Promise<ResolvedPdfLink | null> {
  const url =
    (typeof ann.url === "string" && ann.url.trim()) ||
    (typeof ann.unsafeUrl === "string" && ann.unsafeUrl.trim()) ||
    "";
  const hit = linkAnnotationHitRect(ann);
  if (!hit) return null;

  if (url) {
    return { rect: hit, external: true, href: url, targetPage: 0 };
  }
  const dest = ann.dest;
  if (dest != null) {
    const page = await pdfDestToOneBasedPage(doc, dest);
    if (page != null) {
      return { rect: hit, external: false, href: "", targetPage: page };
    }
  }
  return null;
}

function appendExternalLinkVisible(label: string, href: string): string {
  const l = label.replace(/\s+/g, " ").trim();
  return l.length > 0 ? `${l}（${href}）` : href;
}

/** 页码式内链文案（如「第513页」）：降级为纯文本，避免与版心页码叠在一起的隐藏链污染正文。 */
function isPdfPageNumberLinkLabel(s: string): boolean {
  return /^第\s*[0-9０-９]+\s*页$/u.test(s.trim());
}

function pdfPiecesOnSameTextLine(a: PdfTextPiece, b: PdfTextPiece): boolean {
  const overlapY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const ha = Math.max(a.y1 - a.y0, 1e-6);
  const hb = Math.max(b.y1 - b.y0, 1e-6);
  const avgH = (ha + hb) / 2;
  if (overlapY > avgH * 0.2) return true;
  const cya = (a.y0 + a.y1) / 2;
  const cyb = (b.y0 + b.y1) / 2;
  return Math.abs(cya - cyb) < avgH * 0.45;
}

/**
 * 在**内容流顺序**下按行切段：`hasEOL` 或纵向明显错位则换行。
 * 不按全局 y/x 重排 glyph，避免与 PDF 绘制顺序不一致导致乱字。
 */
function clusterPdfPiecesByStreamLine(run: PdfTextPiece[]): PdfTextPiece[][] {
  if (run.length === 0) return [];
  const clusters: PdfTextPiece[][] = [];
  let cur: PdfTextPiece[] = [run[0]!];
  for (let k = 1; k < run.length; k++) {
    const prev = cur[cur.length - 1]!;
    const next = run[k]!;
    const newLine =
      prev.hasEOL ||
      !pdfPiecesOnSameTextLine(prev, next);
    if (newLine) {
      clusters.push(cur);
      cur = [next];
    } else {
      cur.push(next);
    }
  }
  clusters.push(cur);
  return clusters;
}

function lineTextFromCluster(cl: PdfTextPiece[]): string {
  return cl
    .map((p) => p.str)
    .join("")
    .replace(/[ \t\f\v]+/g, " ")
    .trim();
}

function pieceCenterY(p: PdfTextPiece): number {
  return (p.y0 + p.y1) / 2;
}

function flushPdfLineY(
  linePieceYs: number[],
  lineYs: number[],
): number[] {
  if (linePieceYs.length === 0) {
    lineYs.push(Number.NaN);
  } else {
    let sum = 0;
    for (const y of linePieceYs) sum += y;
    lineYs.push(sum / linePieceYs.length);
  }
  return [];
}

async function pdfPagePlainWithLinks(
  doc: DocLinkResolve,
  items: unknown[],
  annotations: unknown[],
  fragments: EbookMarkdownFragmentRegistry,
): Promise<PdfPagePlain> {
  const pieces = extractPdfTextPieces(items);
  const resolved: ResolvedPdfLink[] = [];
  for (const a of annotations) {
    if (!a || typeof a !== "object") continue;
    const rec = a as Record<string, unknown>;
    if (rec.annotationType !== AnnotationType.LINK) continue;
    const r = await resolvePdfLinkAnnotation(doc, rec);
    if (r) resolved.push(r);
  }

  /** 小链域先占 glyph，避免大块热区抢走同行上多个独立链接的字。 */
  resolved.sort((a, b) => {
    const ax = Math.max(0, a.rect[2] - a.rect[0]);
    const ay = Math.max(0, a.rect[3] - a.rect[1]);
    const bx = Math.max(0, b.rect[2] - b.rect[0]);
    const by = Math.max(0, b.rect[3] - b.rect[1]);
    return ax * ay - bx * by;
  });

  const n = pieces.length;
  const pieceLinkId: (number | null)[] = new Array(n).fill(null);
  const linkMeta = new Map<
    number,
    { external: boolean; href: string; targetPage: number }
  >();

  let nextLinkId = 1;
  const linkSatisfied: boolean[] = new Array(resolved.length).fill(false);
  resolved.forEach((link, li) => {
    const [lx0, ly0, lx1, ly1] = link.rect;
    const idx: number[] = [];
    for (let pi = 0; pi < n; pi++) {
      const p = pieces[pi]!;
      if (!p.str) continue;
      if (rectsOverlapPdf(p.x0, p.y0, p.x1, p.y1, lx0, ly0, lx1, ly1)) {
        idx.push(pi);
      }
    }
    if (idx.length === 0) return;

    const lid = nextLinkId++;
    let any = false;
    for (const pi of idx) {
      if (pieceLinkId[pi] !== null) continue;
      pieceLinkId[pi] = lid;
      any = true;
    }
    if (!any) return;

    linkSatisfied[li] = true;
    linkMeta.set(lid, {
      external: link.external,
      href: link.href,
      targetPage: link.targetPage,
    });
  });

  let raw = "";
  const lineYs: number[] = [];
  let linePieceYs: number[] = [];
  let i = 0;
  let lastEmittedPiece: PdfTextPiece | null = null;
  /** 仅「链域 → 链域」且仍同一行时补空格；普通字间不插空格（否则中文会一字一空格）。 */
  let prevChunkWasLinkEmit = false;
  while (i < n) {
    const lid = pieceLinkId[i];
    if (lid != null) {
      let j = i;
      while (j < n && pieceLinkId[j] === lid) j++;
      const run = pieces.slice(i, j);
      const meta = linkMeta.get(lid);
      if (meta) {
        if (
          prevChunkWasLinkEmit &&
          lastEmittedPiece &&
          run.length > 0 &&
          pdfPiecesOnSameTextLine(lastEmittedPiece, run[0]!)
        ) {
          raw += " ";
        }
        const clusters = clusterPdfPiecesByStreamLine(run);
        const lineTexts: string[] = [];
        for (const cl of clusters) {
          const lab = lineTextFromCluster(cl);
          if (!lab) continue;
          lineTexts.push(lab);
        }
        if (meta.external) {
          const body = lineTexts.join("\n");
          raw +=
            body.length > 0 ? `${body}（${meta.href}）` : meta.href;
          if (lineTexts.length > 0) {
            for (const cl of clusters) {
              const lab = lineTextFromCluster(cl);
              if (!lab) continue;
              for (const p of cl) linePieceYs.push(pieceCenterY(p));
              linePieceYs = flushPdfLineY(linePieceYs, lineYs);
              if (cl !== clusters[clusters.length - 1]) raw += "\n";
            }
          }
        } else {
          const tid = `pdf-p${meta.targetPage}`;
          let firstCluster = true;
          for (const cl of clusters) {
            const lab = lineTextFromCluster(cl);
            if (!lab) continue;
            if (!firstCluster) {
              linePieceYs = flushPdfLineY(linePieceYs, lineYs);
              raw += "\n";
            }
            firstCluster = false;
            for (const p of cl) linePieceYs.push(pieceCenterY(p));
            if (isPdfPageNumberLinkLabel(lab)) {
              raw += lab;
            } else {
              raw += mdInternalLinkForLogicalTarget(fragments, tid, {
                label: lab,
              });
            }
          }
        }
        lastEmittedPiece = run[run.length - 1]!;
        prevChunkWasLinkEmit = true;
        if (run.length > 0 && run[run.length - 1]!.hasEOL) {
          linePieceYs = flushPdfLineY(linePieceYs, lineYs);
          raw += "\n";
        }
      } else {
        prevChunkWasLinkEmit = false;
        for (const p of run) {
          if (p.str) linePieceYs.push(pieceCenterY(p));
          raw += p.str;
          if (p.hasEOL) {
            linePieceYs = flushPdfLineY(linePieceYs, lineYs);
            raw += "\n";
          }
          lastEmittedPiece = p;
        }
      }
      i = j;
    } else {
      prevChunkWasLinkEmit = false;
      const p = pieces[i]!;
      if (p.str) linePieceYs.push(pieceCenterY(p));
      raw += p.str;
      if (p.hasEOL) {
        linePieceYs = flushPdfLineY(linePieceYs, lineYs);
        raw += "\n";
      }
      lastEmittedPiece = p;
      i++;
    }
  }
  if (linePieceYs.length > 0) {
    flushPdfLineY(linePieceYs, lineYs);
  }

  /** 无文字叠合的内部链（如整页透明热区）不生成「跳转第N页」，避免污染正文。 */
  const orphans: string[] = [];
  resolved.forEach((link, li) => {
    if (linkSatisfied[li]) return;
    if (link.external) {
      orphans.push(appendExternalLinkVisible("", link.href));
    }
  });
  if (orphans.length > 0) {
    const suffix = orphans.join("\n");
    raw = raw.length > 0 ? `${raw.replace(/\n*$/, "")}\n${suffix}\n` : `${suffix}\n`;
  }

  const plain = normalizePdfExtractedPageText(raw);
  const split = plain.length > 0 ? plain.split("\n") : [];
  while (lineYs.length < split.length) lineYs.push(Number.NaN);
  if (lineYs.length > split.length) lineYs.length = split.length;
  return { plain, lineYs };
}

type PageLike = {
  getTextContent: (p?: object) => Promise<{ items: unknown[] }>;
  getAnnotations: (p?: object) => Promise<unknown[]>;
  cleanup?: () => void;
  ref?: { num: number };
};

async function collectPageXObjectImages(
  catalog: PdfImageCatalog,
  pageObjNum: number | undefined,
  pageIndex: number,
  imagesFolderRel: string,
  imageWrites: Array<{ relativePath: string; data: ArrayBuffer }>,
  usedRelKeys: Set<string>,
  objNumToRel: Map<number, string>,
  lines: string[],
): Promise<void> {
  if (pageObjNum == null) return;
  const imgs = catalog.imagesForPageObj(pageObjNum);
  const seqRef = { n: 0 };
  const seen = new Set<number>();
  for (const img of imgs) {
    if (seen.has(img.objNum)) continue;
    seen.add(img.objNum);
    let rel = objNumToRel.get(img.objNum);
    if (!rel) {
      const decoded = await decodePdfXObjectImage(img);
      if (!decoded) continue;
      rel = allocPdfImageRelPath(
        imagesFolderRel,
        pageIndex,
        seqRef.n,
        decoded.ext,
        usedRelKeys,
      );
      seqRef.n += 1;
      objNumToRel.set(img.objNum, rel);
      imageWrites.push({ relativePath: rel, data: decoded.data });
    }
    lines.push(formatMdBlockImage(rel));
  }
}

export async function convertPdfToArtifacts(
  buffer: ArrayBuffer,
  outputBase: string,
  onProgress?: (info: { page: number; pageCount: number }) => void | Promise<void>,
): Promise<EbookMarkdownArtifacts> {
  if (!workerConfigured) {
    GlobalWorkerOptions.workerSrc = pdfjsWorker;
    workerConfigured = true;
  }

  configurePdfImageDecoders(pdfjsBundledAssetUrl("wasm"));
  /** getDocument 会转移 TypedArray，目录解析须用独立副本。 */
  const pdfBytes = new Uint8Array(buffer);
  const catalog = await buildPdfImageCatalog(pdfBytes);

  const loadingTask = getDocument({
    data: pdfBytes.slice(),
    /**
     * 只抽文本层；插图按 PDF XObject 解码，不跑 getOperatorList。
     * 缺系统字体时 FontFace pending 会卡住。
     */
    disableFontFace: true,
    useSystemFonts: false,
    cMapUrl: pdfjsBundledAssetUrl("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: pdfjsBundledAssetUrl("standard_fonts"),
    wasmUrl: pdfjsBundledAssetUrl("wasm"),
    iccUrl: pdfjsBundledAssetUrl("iccs"),
    /** 主线程拉取同源 CMap/wasm，避免 worker 在 file:// 下 fetch 失败 */
    useWorkerFetch: false,
  });
  const doc = await loadingTask.promise;
  const lines: string[] = [];
  const imagesFolderRel = `${outputBase}.Images`;
  const imageWrites: Array<{ relativePath: string; data: ArrayBuffer }> = [];
  const usedRelKeys = new Set<string>();
  const objNumToRel = new Map<number, string>();

  const docForLinks = doc as unknown as DocLinkResolve;
  const fragments = new EbookMarkdownFragmentRegistry();
  const lineCenterY: number[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    await onProgress?.({ page: i, pageCount: doc.numPages });
    await yieldToUi();
    const page = (await doc.getPage(i)) as PageLike;
    let tcItems: unknown[] = [];
    let anns: unknown[] = [];
    try {
      const tc = await page.getTextContent();
      tcItems = tc.items;
    } catch {
      tcItems = [];
    }
    try {
      anns = await page.getAnnotations();
    } catch {
      anns = [];
    }
    const { plain: pagePlain, lineYs: pageLineYs } = await pdfPagePlainWithLinks(
      docForLinks,
      tcItems,
      anns,
      fragments,
    );
    const pageAnchor = spanAnchorForLogicalTarget(fragments, `pdf-p${i}`);
    const pageLines =
      pagePlain.length > 0 ? pagePlain.split("\n") : [""];

    const imgLines: string[] = [];
    try {
      await collectPageXObjectImages(
        catalog,
        page.ref?.num,
        i,
        imagesFolderRel,
        imageWrites,
        usedRelKeys,
        objNumToRel,
        imgLines,
      );
    } catch {
      // 单页抽图失败不挡住正文
    }

    for (let li = 0; li < pageLines.length; li++) {
      const chunk = pageLines[li] ?? "";
      lines.push(li === 0 ? `${pageAnchor}${chunk}` : chunk);
      lineCenterY.push(pageLineYs[li] ?? Number.NaN);
    }
    if (pageLines.length > 0) {
      lines.push("");
      lineCenterY.push(Number.NaN);
    }
    for (const il of imgLines) {
      lines.push(il);
      lineCenterY.push(Number.NaN);
      lines.push("");
      lineCenterY.push(Number.NaN);
    }
    try {
      page.cleanup?.();
    } catch {
      // 忽略
    }
  }

  const docOutline = doc as unknown as PdfDocWithOutline;
  if (typeof docOutline.getOutline === "function") {
    try {
      const outline = await docOutline.getOutline();
      if (outline?.length) {
        const tocEntries: PdfTocEntry[] = [];
        await collectPdfOutlineEntries(docForLinks, outline, 0, tocEntries);
        const deduped = dedupeEmbeddedTocEntries(
          tocEntries,
        ) as PdfTocEntry[];
        if (deduped.length > 0) {
          injectPdfOutlineIntoLines(
            lines,
            deduped,
            fragments,
            doc.numPages,
            lineCenterY,
          );
        }
      }
    } catch {
      // 无大纲或解析失败时仍输出正文
    }
  }

  await doc.destroy();

  const utf8 = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  const out: EbookMarkdownArtifacts = { utf8 };
  if (imageWrites.length > 0) out.imageWrites = imageWrites;
  return out;
}
