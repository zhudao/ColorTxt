import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import * as monaco from "monaco-editor";
import {
  isAllowedMdExternalUrl,
  lineContainsMdStripMarkup,
  mdLinkDecorationHoverMessage,
  extractMdFootnoteHoverTextFromLine,
  shiftMdInternalLinkSidecarDisplayLines,
  shiftMdLinkHitColumns,
  type MdCompactLinkHit,
  type MdInternalLinkSidecar,
} from "../markdown/markdownLinkShared";
import { stripMdInternalLinksFromText } from "../markdown/markdownInternalLinks";
import { resolveMarkdownAssetAbsPath } from "../markdown/markdownImages";
import { yieldToUi } from "../ebook/yieldToUi";
import {
  positionFromClientPoint,
  clientXWithinSingleLineModelRange,
} from "../reader/readerEbookPointer";
import {
  buildEbookAnchorLookupCache,
  lookupEbookAnchorPhysicalLineCached,
  type EbookAnchorLookupCache,
} from "../reader/ebookAnchorLookup";

const EBOOK_LINK_ICON_STYLE_ID = "reader-ebook-link-icon-styles";
/** 视口外缓冲行数：仅在此范围内向 Monaco 注册内链装饰（点击索引仍为全书） */
const EBOOK_LINK_VIEWPORT_DECORATION_BUFFER_LINES = 80;
const EBOOK_LINK_VIEWPORT_DECOR_SYNC_MS = 48;
/** 须改动的行数超过此阈值时用单次全量 `applyEdits` 代替逐行替换（编辑态回退路径） */
const MD_LINK_BULK_STRIP_EDIT_THRESHOLD = 512;

/**
 * MD/电子书内链：侧车、视口装饰、图标样式、点击跳转。
 * Monaco editor/model 仍由 ReaderMain 持有。
 */
export function useReaderEbookInternalLinks(deps: {
  editor: ShallowRef<monaco.editor.IStandaloneCodeEditor | null>;
  model: ShallowRef<monaco.editor.ITextModel | null>;
  physicalReaderPath: Ref<string | null | undefined> | (() => string | null | undefined);
  ebookAnchorPhysicalToDisplay:
    | Ref<((physicalLine: number) => number) | undefined>
    | (() => ((physicalLine: number) => number) | undefined);
  ebookDisplayLineToPhysical:
    | Ref<((displayLine: number) => number) | undefined>
    | (() => ((displayLine: number) => number) | undefined);
  compressBlankLines: Ref<boolean> | (() => boolean);
  beginProgrammaticScroll: () => void;
  jumpToBookmarkLine: (displayLine: number, smooth?: boolean) => void;
}) {
  let ebookInternalLinkDecorationIds: string[] = [];
  const ebookAnchorIdToPhysicalLine = shallowRef<Map<string, number>>(
    new Map(),
  );
  let ebookAnchorLookupCache: EbookAnchorLookupCache | null = null;
  const ebookLeadingLinkLabelsByDisplayLine = shallowRef<
    ReadonlyMap<number, readonly string[]>
  >(new Map());
  const ebookInternalLinkHitCount = ref(0);
  const ebookInternalLinkHitsByLine = shallowRef<
    Map<number, MdCompactLinkHit[]>
  >(new Map());
  let ebookLinkDecorIconRelToClass = new Map<string, string>();
  let ebookLinkViewportDecorSyncTimer: ReturnType<typeof setTimeout> | null =
    null;
  let ebookLinkViewportDecorLastKey = "";
  let ebookLinkScrollDecorDisposable: monaco.IDisposable | null = null;
  /** 格式化阶段预剥离的内链侧车；插图删行后须 shift 再安装 */
  let pendingEbookSidecar: MdInternalLinkSidecar | null = null;

  function readPhysicalReaderPath(): string | null | undefined {
    const v = deps.physicalReaderPath;
    return typeof v === "function" ? v() : v.value;
  }

  function readEbookAnchorPhysicalToDisplay():
    | ((physicalLine: number) => number)
    | undefined {
    const v = deps.ebookAnchorPhysicalToDisplay;
    return typeof v === "function" ? v() : v.value;
  }

  function readEbookDisplayLineToPhysical():
    | ((displayLine: number) => number)
    | undefined {
    const v = deps.ebookDisplayLineToPhysical;
    return typeof v === "function" ? v() : v.value;
  }

  function readCompressBlankLines(): boolean {
    const v = deps.compressBlankLines;
    return typeof v === "function" ? v() : v.value;
  }

  function disposeEbookLinkIconStyles() {
    const el = document.getElementById(EBOOK_LINK_ICON_STYLE_ID);
    if (el) el.textContent = "";
  }

  function hashIconRelForCssClass(iconRel: string): string {
    let h = 5381;
    for (let i = 0; i < iconRel.length; i++) {
      h = ((h << 5) + h) ^ iconRel.charCodeAt(i)!;
    }
    return (h >>> 0).toString(36);
  }

  function ensureEbookLinkIconStyleElement(): HTMLStyleElement {
    let el = document.getElementById(
      EBOOK_LINK_ICON_STYLE_ID,
    ) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = EBOOK_LINK_ICON_STYLE_ID;
      document.head.appendChild(el);
    }
    return el;
  }

  async function applyEbookLinkIconStyles(
    iconRels: readonly string[],
    convertedTxtAbsPath: string,
  ): Promise<Map<string, string>> {
    const relToClass = new Map<string, string>();
    const rules: string[] = [];
    const unique = [...new Set(iconRels.filter((r) => r.trim().length > 0))];
    for (const iconRel of unique) {
      const absPath = resolveMarkdownAssetAbsPath(iconRel, convertedTxtAbsPath);
      const url = await window.colorTxt.pathToReadableLocalUrl(absPath);
      if (!url) continue;
      const hash = hashIconRelForCssClass(iconRel);
      relToClass.set(iconRel, hash);
      const safeUrl = url.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      rules.push(
        `.monaco-editor .readerEbookLinkIcon--${hash}::before { background-image: url("${safeUrl}"); }`,
      );
    }
    ensureEbookLinkIconStyleElement().textContent = rules.join("\n");
    return relToClass;
  }

  function teardownEbookLinkViewportDecorSync() {
    if (ebookLinkViewportDecorSyncTimer != null) {
      clearTimeout(ebookLinkViewportDecorSyncTimer);
      ebookLinkViewportDecorSyncTimer = null;
    }
    ebookLinkScrollDecorDisposable?.dispose();
    ebookLinkScrollDecorDisposable = null;
    ebookLinkViewportDecorLastKey = "";
    ebookLinkDecorIconRelToClass = new Map();
  }

  function disposeEbookInternalLinks() {
    const e = deps.editor.value;
    if (e && ebookInternalLinkDecorationIds.length > 0) {
      e.deltaDecorations(ebookInternalLinkDecorationIds, []);
      ebookInternalLinkDecorationIds = [];
    }
    teardownEbookLinkViewportDecorSync();
    disposeEbookLinkIconStyles();
    ebookInternalLinkHitCount.value = 0;
    ebookInternalLinkHitsByLine.value = new Map();
    ebookAnchorIdToPhysicalLine.value = new Map();
    ebookAnchorLookupCache = null;
    ebookLeadingLinkLabelsByDisplayLine.value = new Map();
  }

  function getEbookLinkViewportLineBounds(
    ed: monaco.editor.IStandaloneCodeEditor,
  ): { lo: number; hi: number } | null {
    const m = ed.getModel();
    if (!m) return null;
    const ranges = ed.getVisibleRanges();
    if (ranges.length === 0) return null;
    let lo = ranges[0]!.startLineNumber;
    let hi = ranges[ranges.length - 1]!.endLineNumber;
    for (const r of ranges) {
      lo = Math.min(lo, r.startLineNumber);
      hi = Math.max(hi, r.endLineNumber);
    }
    const buf = EBOOK_LINK_VIEWPORT_DECORATION_BUFFER_LINES;
    return {
      lo: Math.max(1, lo - buf),
      hi: Math.min(m.getLineCount(), hi + buf),
    };
  }

  function getEbookAnchorLookupCache(): EbookAnchorLookupCache | null {
    const map = ebookAnchorIdToPhysicalLine.value;
    if (map.size === 0) {
      ebookAnchorLookupCache = null;
      return null;
    }
    if (!ebookAnchorLookupCache) {
      ebookAnchorLookupCache = buildEbookAnchorLookupCache(map);
    }
    return ebookAnchorLookupCache;
  }

  function getEbookAnchorPhysicalLine(targetId: string): number | undefined {
    const cache = getEbookAnchorLookupCache();
    if (!cache) return undefined;
    return lookupEbookAnchorPhysicalLineCached(cache, targetId);
  }

  function resolveFootnoteLineTextForEbookHover(
    targetId: string,
  ): string | undefined {
    const phys = getEbookAnchorPhysicalLine(targetId);
    if (phys == null) return undefined;
    const toDisplay = readEbookAnchorPhysicalToDisplay();
    if (!toDisplay) return undefined;
    const displayLine = toDisplay(phys);
    const m = deps.model.value;
    if (!m || displayLine < 1 || displayLine > m.getLineCount()) {
      return undefined;
    }
    return extractMdFootnoteHoverTextFromLine(m.getLineContent(displayLine));
  }

  function buildEbookLinkDecorationsForViewport(
    lo: number,
    hi: number,
    hitsByLine: Map<number, MdCompactLinkHit[]>,
    relToClass: Map<string, string>,
  ): monaco.editor.IModelDeltaDecoration[] {
    const decs: monaco.editor.IModelDeltaDecoration[] = [];
    for (let line = lo; line <= hi; line++) {
      const hits = hitsByLine.get(line);
      if (!hits?.length) continue;
      for (const h of hits) {
        let inlineClassName: string;
        if (h.inlineImage) {
          const iconRel = h.iconRel?.trim();
          const iconHash =
            iconRel && relToClass.has(iconRel)
              ? relToClass.get(iconRel)
              : undefined;
          if (!iconRel || !iconHash) continue;
          inlineClassName = `readerEbookLinkIcon readerEbookInlineImage readerEbookLinkIcon--${iconHash}`;
        } else if (h.builtinLinkIcon) {
          inlineClassName =
            "readerEbookLinkIcon readerEbookLinkIcon--builtin-link";
        } else {
          const iconRel = h.iconRel?.trim();
          const iconHash =
            iconRel && relToClass.has(iconRel)
              ? relToClass.get(iconRel)
              : undefined;
          if (iconRel && iconHash) {
            inlineClassName = `readerEbookLinkIcon readerEbookLinkIcon--${iconHash}`;
          } else if (iconRel) {
            inlineClassName =
              "readerEbookLinkIcon readerEbookLinkIcon--builtin-link";
          } else if (h.externalUrl?.trim()) {
            inlineClassName = "readerEbookExternalLink";
          } else {
            inlineClassName = "readerEbookInternalLink";
          }
        }
        const hover = mdLinkDecorationHoverMessage(h, {
          resolveFootnoteLineText: resolveFootnoteLineTextForEbookHover,
        });
        decs.push({
          range: new monaco.Range(
            line,
            h.startColumn,
            line,
            h.endColumnExclusive,
          ),
          options: {
            inlineClassName,
            ...(hover
              ? { hoverMessage: { value: hover } }
              : {}),
          },
        });
      }
    }
    return decs;
  }

  function syncEbookLinkViewportDecorationsNow() {
    const ed = deps.editor.value;
    if (!ed || ebookInternalLinkHitCount.value === 0) return;
    const bounds = getEbookLinkViewportLineBounds(ed);
    if (!bounds) return;
    const key = `${bounds.lo}:${bounds.hi}`;
    if (
      key === ebookLinkViewportDecorLastKey &&
      ebookInternalLinkDecorationIds.length > 0
    ) {
      return;
    }
    ebookLinkViewportDecorLastKey = key;
    const decs = buildEbookLinkDecorationsForViewport(
      bounds.lo,
      bounds.hi,
      ebookInternalLinkHitsByLine.value,
      ebookLinkDecorIconRelToClass,
    );
    ebookInternalLinkDecorationIds = ed.deltaDecorations(
      ebookInternalLinkDecorationIds,
      decs,
    );
  }

  function scheduleEbookLinkViewportDecorSync(immediate = false) {
    if (immediate) {
      if (ebookLinkViewportDecorSyncTimer != null) {
        clearTimeout(ebookLinkViewportDecorSyncTimer);
        ebookLinkViewportDecorSyncTimer = null;
      }
      syncEbookLinkViewportDecorationsNow();
      return;
    }
    if (ebookLinkViewportDecorSyncTimer != null) {
      clearTimeout(ebookLinkViewportDecorSyncTimer);
    }
    ebookLinkViewportDecorSyncTimer = setTimeout(() => {
      ebookLinkViewportDecorSyncTimer = null;
      syncEbookLinkViewportDecorationsNow();
    }, EBOOK_LINK_VIEWPORT_DECOR_SYNC_MS);
  }

  async function ensureEbookLinkIconStylesForHits(
    hitsByLine: Map<number, MdCompactLinkHit[]>,
  ): Promise<void> {
    const iconRelSet = new Set<string>();
    for (const hits of hitsByLine.values()) {
      for (const h of hits) {
        const ir = h.iconRel?.trim();
        if (ir) iconRelSet.add(ir);
      }
    }
    const txtPath = readPhysicalReaderPath()?.trim();
    if (iconRelSet.size > 0 && txtPath) {
      ebookLinkDecorIconRelToClass = await applyEbookLinkIconStyles(
        [...iconRelSet],
        txtPath,
      );
    } else {
      ebookLinkDecorIconRelToClass = new Map();
    }
  }

  function bindEbookLinkViewportDecorScrollSync(
    ed: monaco.editor.IStandaloneCodeEditor,
  ) {
    ebookLinkScrollDecorDisposable?.dispose();
    ebookLinkScrollDecorDisposable = ed.onDidScrollChange(() => {
      scheduleEbookLinkViewportDecorSync();
    });
  }

  function getEbookLeadingLinkLabelsByDisplayLine(): ReadonlyMap<
    number,
    readonly string[]
  > {
    return ebookLeadingLinkLabelsByDisplayLine.value;
  }

  function setPendingEbookInternalLinkSidecar(
    sidecar: MdInternalLinkSidecar | null,
  ) {
    pendingEbookSidecar = sidecar;
  }

  function shiftPendingEbookSidecarForDeletedDisplayLines(
    deletedDisplayLinesDesc: readonly number[],
  ) {
    if (!pendingEbookSidecar || deletedDisplayLinesDesc.length === 0) return;
    shiftMdInternalLinkSidecarDisplayLines(
      pendingEbookSidecar,
      deletedDisplayLinesDesc,
    );
  }

  function ebookCompactHitRange(
    lineNumber: number,
    hit: MdCompactLinkHit,
  ): monaco.Range {
    return new monaco.Range(
      lineNumber,
      hit.startColumn,
      lineNumber,
      hit.endColumnExclusive,
    );
  }

  function tryJumpEbookInternalLinkFromPoint(
    clientX: number,
    clientY: number,
  ): boolean {
    const ed = deps.editor.value;
    const m = deps.model.value;
    if (!ed || !m || ebookInternalLinkHitCount.value === 0) return false;
    const pos = positionFromClientPoint(ed, clientX, clientY);
    if (!pos) return false;
    const lineHits = ebookInternalLinkHitsByLine.value.get(pos.lineNumber);
    if (!lineHits?.length) return false;
    const mapPhys =
      readEbookAnchorPhysicalToDisplay() ?? ((n: number) => Math.max(1, n));
    for (const h of lineHits) {
      const hitRange = ebookCompactHitRange(pos.lineNumber, h);
      if (!hitRange.containsPosition(pos)) continue;
      if (!clientXWithinSingleLineModelRange(ed, m, hitRange, clientX)) continue;
      if (h.inlineImage) continue;
      const externalUrl = h.externalUrl?.trim();
      if (externalUrl && isAllowedMdExternalUrl(externalUrl)) {
        void window.colorTxt.openExternal(externalUrl);
        return true;
      }
      const phys = getEbookAnchorPhysicalLine(h.targetId);
      if (phys == null) continue;
      deps.beginProgrammaticScroll();
      deps.jumpToBookmarkLine(mapPhys(phys), true);
      return true;
    }
    return false;
  }

  function countEbookLinkHits(
    hitsByLine: Map<number, MdCompactLinkHit[]>,
  ): number {
    let n = 0;
    for (const hits of hitsByLine.values()) n += hits.length;
    return n;
  }

  /**
   * 点击在 `editorHost` 捕获阶段统一处理；装饰仅注册视口 ± 缓冲行（滚动时增量替换）。
   */
  async function installEbookInternalLinkSidecar(
    sidecar: MdInternalLinkSidecar,
  ) {
    const ed = deps.editor.value;
    if (!ed) return;
    ebookLeadingLinkLabelsByDisplayLine.value =
      sidecar.leadingMdLinkLabelsByDisplayLine;
    ebookAnchorIdToPhysicalLine.value = sidecar.idToPhysicalLine;
    ebookAnchorLookupCache = null;

    const hitsByLine = sidecar.hitsByDisplayLine;
    if (hitsByLine.size === 0) return;

    ebookInternalLinkHitCount.value = countEbookLinkHits(hitsByLine);
    ebookInternalLinkHitsByLine.value = hitsByLine;

    await ensureEbookLinkIconStylesForHits(hitsByLine);
    await yieldToUi();
    if (deps.editor.value !== ed) return;

    bindEbookLinkViewportDecorScrollSync(ed);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scheduleEbookLinkViewportDecorSync(true);
      });
    });
  }

  /**
   * 任意 `.md`：剥离 `<span id>` / 内部 MD 链接语法，安装侧车装饰。
   */
  async function applyMarkdownInternalLinks() {
    const prefetchedSidecar = pendingEbookSidecar;
    pendingEbookSidecar = null;
    disposeEbookInternalLinks();
    if (prefetchedSidecar) {
      await installEbookInternalLinkSidecar(prefetchedSidecar);
      return;
    }

    const e = deps.editor.value;
    const m = deps.model.value;
    if (!e || !m) return;
    const raw = m.getValue();
    if (!lineContainsMdStripMarkup(raw) && !/<span\s+id=/i.test(raw)) return;
    deps.beginProgrammaticScroll();
    const normalized = raw.replace(/\r\n/g, "\n");
    let {
      text,
      outLines,
      idToPhysicalLine,
      linkOccurrences,
      leadingMdLinkLabelsByLine,
    } = stripMdInternalLinksFromText(normalized);
    ebookLeadingLinkLabelsByDisplayLine.value = leadingMdLinkLabelsByLine;
    if (
      text === normalized &&
      idToPhysicalLine.size === 0 &&
      linkOccurrences.length === 0
    ) {
      return;
    }
    if (readCompressBlankLines()) {
      const toPhys =
        readEbookDisplayLineToPhysical() ??
        ((n: number) => Math.max(1, Math.floor(n)));
      const idMap = new Map<string, number>();
      for (const [id, displayLine] of idToPhysicalLine) {
        idMap.set(id, toPhys(displayLine));
      }
      idToPhysicalLine = idMap;
    }
    const lc = m.getLineCount();
    if (text !== normalized && outLines.length === lc) {
      m.applyEdits([
        {
          range: m.getFullModelRange(),
          text,
        },
      ]);
    } else if (text !== normalized) {
      const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
      for (let lineNumber = 1; lineNumber <= lc; lineNumber++) {
        const i = lineNumber - 1;
        const nextLine = outLines[i];
        if (nextLine === undefined) break;
        if (m.getLineContent(lineNumber) !== nextLine) {
          edits.push({
            range: new monaco.Range(
              lineNumber,
              1,
              lineNumber,
              m.getLineMaxColumn(lineNumber),
            ),
            text: nextLine,
          });
        }
      }
      if (edits.length >= MD_LINK_BULK_STRIP_EDIT_THRESHOLD) {
        m.applyEdits([
          {
            range: m.getFullModelRange(),
            text,
          },
        ]);
      } else if (edits.length > 0) {
        m.applyEdits(edits);
      }
    }
    const hitsByDisplayLine = new Map<number, MdCompactLinkHit[]>();
    const lineCount = Math.max(1, m.getLineCount());
    for (const occ of linkOccurrences) {
      const dl = Math.min(lineCount, Math.max(1, occ.physicalLine));
      const hit: MdCompactLinkHit = {
        startColumn: occ.startColumn,
        endColumnExclusive: occ.endColumnExclusive,
        targetId: occ.targetId,
        iconRel: occ.iconRel,
        label: occ.label,
        hoverTip: occ.hoverTip,
        builtinLinkIcon: occ.builtinLinkIcon,
        externalUrl: occ.externalUrl,
        inlineImage: occ.inlineImage,
      };
      const bucket = hitsByDisplayLine.get(dl);
      if (bucket) bucket.push(hit);
      else hitsByDisplayLine.set(dl, [hit]);
    }
    await installEbookInternalLinkSidecar({
      idToPhysicalLine,
      hitsByDisplayLine,
      leadingMdLinkLabelsByDisplayLine: new Map(
        [...leadingMdLinkLabelsByLine.entries()].map(([k, v]) => [k, [...v]]),
      ),
    });
  }

  function clearPendingEbookSidecar() {
    pendingEbookSidecar = null;
  }

  /** 章节标题行改写后：按行偏移内链列并刷新视口装饰 */
  function shiftHitColumnsAfterChapterTitleEdit(
    linkColumnShiftByLine: Map<number, number>,
  ) {
    if (ebookInternalLinkHitCount.value <= 0) return;
    const hitsMap = ebookInternalLinkHitsByLine.value;
    for (const [ln, strippedCols] of linkColumnShiftByLine) {
      const hits = hitsMap.get(ln);
      if (!hits?.length) continue;
      for (const hit of hits) {
        shiftMdLinkHitColumns(hit, -strippedCols);
      }
    }
    ebookInternalLinkHitsByLine.value = new Map(hitsMap);
    ebookLinkViewportDecorLastKey = "";
    scheduleEbookLinkViewportDecorSync(true);
  }

  function invalidateAndSyncViewportDecorations() {
    if (ebookInternalLinkHitCount.value <= 0) return;
    ebookLinkViewportDecorLastKey = "";
    scheduleEbookLinkViewportDecorSync(true);
  }

  return {
    ebookInternalLinkHitCount,
    disposeEbookInternalLinks,
    applyMarkdownInternalLinks,
    setPendingEbookInternalLinkSidecar,
    shiftPendingEbookSidecarForDeletedDisplayLines,
    clearPendingEbookSidecar,
    getEbookLeadingLinkLabelsByDisplayLine,
    tryJumpEbookInternalLinkFromPoint,
    shiftHitColumnsAfterChapterTitleEdit,
    invalidateAndSyncViewportDecorations,
  };
}
