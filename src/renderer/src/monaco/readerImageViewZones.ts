import type * as monaco from "monaco-editor";
import { yieldToUi } from "../ebook/yieldToUi";
import type { BlockMarkdownImageLine } from "../markdown/markdownImages";
import { omitLinesAtLineNumbers } from "../markdown/markdownImages";
import { getLineSpacingPx } from "./lineSpacing";

/** `replaceImgAnchorLinesWithViewZones` 返回：插图 View Zone id，以及删行前 Monaco 行号（降序，便于与滤空映射同步 splice） */
export type ReplaceImgAnchorsResult = {
  zoneIds: string[];
  deletedOriginalLineNumbersDesc: number[];
};

type ActiveImageZone = {
  zone: monaco.editor.IViewZone;
  contentHeightPx: number;
  frame: HTMLElement;
};

/** 供段间距变更时 `layoutZone` 更新高度（delegate.heightInPx 可变） */
const activeImageZones = new Map<string, ActiveImageZone>();

function isRemoteImgPath(path: string): boolean {
  return /^https?:\/\//i.test(path.trim());
}

/**
 * Monaco 将 `.view-zones` 容器宽设为 `max(scrollWidth, contentWidth)`（见 vscode `viewZones.ts` render），
 * 长行撑宽 scrollWidth 时 zone 比正文栏更宽；插图若 `width:100%` 再居中会相对正文右偏。
 * 将 zone 根节点限制为与正文同一 `contentWidth`。
 */
function syncReaderImageViewZoneBox(
  editor: monaco.editor.IStandaloneCodeEditor,
  dom: HTMLElement,
): void {
  const { contentWidth } = editor.getLayoutInfo();
  dom.style.width = `${Math.max(0, contentWidth - 14)}px`; // 14px 为 Monaco 滚动条宽度
}

/** 独占行插图：内容高度 + 底部段间距（对齐正文物理行后的空隙） */
function applyImageZoneBoxHeights(
  dom: HTMLElement,
  frame: HTMLElement,
  contentHeightPx: number,
  gapPx: number,
): number {
  const gap = Math.max(0, Math.floor(gapPx));
  const content = Math.max(1, Math.floor(contentHeightPx));
  const total = content + gap;
  dom.style.boxSizing = "border-box";
  dom.style.height = `${total}px`;
  dom.style.paddingBottom = gap > 0 ? `${gap}px` : "";
  frame.style.boxSizing = "border-box";
  frame.style.height = `${content}px`;
  frame.style.maxHeight = `${content}px`;
  return total;
}

/**
 * 删除块级 `![…](…)` 源行并在对应位置插入 View Zone。
 */
export async function replaceImgAnchorLinesWithViewZones(
  _monacoApi: typeof monaco,
  editor: monaco.editor.IStandaloneCodeEditor,
  _convertedTxtAbsPath: string,
  options: {
    zoneHeightPx: number;
    onZonesChange?: (zoneIds: string[]) => void;
    sourceText?: string;
    blockImages: readonly BlockMarkdownImageLine[];
  },
): Promise<ReplaceImgAnchorsResult> {
  const model = editor.getModel();
  if (!model) return { zoneIds: [], deletedOriginalLineNumbersDesc: [] };
  const doc = model;

  const workingText = options.sourceText ?? doc.getValue();
  const matches = options.blockImages;
  if (matches.length > 0 && matches.length % 64 === 0) {
    await yieldToUi();
  }
  if (matches.length === 0)
    return { zoneIds: [], deletedOriginalLineNumbersDesc: [] };

  const deletedOriginalLineNumbersDesc = matches
    .map((x) => x.line)
    .sort((a, b) => b - a);

  const imgLineSet = new Set(matches.map((x) => x.line));

  function deletedBefore(row: number): number {
    return matches.filter((x) => x.line < row).length;
  }

  /**
   * 删去插图源行后，View Zone 应插在该插图**上一行非插图内容**之后。
   * 只向上跳过其它插图行；**不要**跳过「上图、空行、下图」里的空行。
   */
  function afterLineNumberForImgMatch(match: { line: number }): number {
    let k = match.line - 1;
    while (k >= 1 && imgLineSet.has(k)) {
      k -= 1;
    }
    if (k < 1) return 0;
    return k - deletedBefore(k);
  }

  const zoneSpecs: { afterLineNumber: number; absPath: string }[] = [];
  for (const m of matches.slice().sort((a, b) => a.line - b.line)) {
    zoneSpecs.push({
      afterLineNumber: afterLineNumberForImgMatch(m),
      absPath: m.absPath,
    });
  }

  const finalText = omitLinesAtLineNumbers(workingText, imgLineSet);
  if (doc.getValue() !== finalText) {
    doc.setValue(finalText);
  }

  const withUrls = await Promise.all(
    zoneSpecs.map(async (z) => ({
      ...z,
      url: isRemoteImgPath(z.absPath)
        ? z.absPath
        : ((await window.colorTxt.pathToReadableLocalUrl(z.absPath)) ?? ""),
    })),
  );

  const contentHeightPx = options.zoneHeightPx;
  const gapPx = getLineSpacingPx();
  const zoneIds: string[] = [];
  let zoneOrdinal = 0;
  editor.changeViewZones((accessor) => {
    for (const z of withUrls) {
      if (!z.url) continue;
      const afterLineNumber = z.afterLineNumber;
      const afterColumn =
        afterLineNumber > 0
          ? doc.getLineMaxColumn(afterLineNumber)
          : undefined;
      const dom = document.createElement("div");
      dom.className = "readerImageViewZone";
      dom.dataset.colortxtImgUrl = z.url;
      dom.dataset.colortxtAfterLine = String(afterLineNumber);
      dom.style.display = "block";
      dom.style.overflow = "hidden";
      dom.style.pointerEvents = "none";
      syncReaderImageViewZoneBox(editor, dom);
      const frame = document.createElement("div");
      frame.className = "readerImageViewZoneFrame";
      const img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.draggable = false;
      img.alt = "";
      img.style.pointerEvents = "auto";
      img.src = z.url;
      frame.appendChild(img);
      dom.appendChild(frame);
      const heightInPx = applyImageZoneBoxHeights(
        dom,
        frame,
        contentHeightPx,
        gapPx,
      );
      const zone: monaco.editor.IViewZone = {
        afterLineNumber,
        afterColumn,
        ordinal: zoneOrdinal++,
        heightInPx,
        domNode: dom,
        onDomNodeTop: () => {
          syncReaderImageViewZoneBox(editor, dom);
        },
      };
      const id = accessor.addZone(zone);
      activeImageZones.set(id, { zone, contentHeightPx, frame });
      zoneIds.push(id);
    }
  });
  options.onZonesChange?.(zoneIds);
  return { zoneIds, deletedOriginalLineNumbersDesc };
}

/**
 * 段间距 / 插图内容高度变更后：刷新已挂载插图 ViewZone 总高度。
 * @param contentHeightPx 若传入则同时更新内容区高度；省略则仅跟段间距。
 */
export function syncReaderImageViewZonesLineSpacing(
  editor: monaco.editor.IStandaloneCodeEditor,
  zoneIds: readonly string[],
  contentHeightPx?: number,
): void {
  if (zoneIds.length === 0) return;
  const gapPx = getLineSpacingPx();
  const nextContent =
    typeof contentHeightPx === "number" && Number.isFinite(contentHeightPx)
      ? Math.max(1, Math.floor(contentHeightPx))
      : null;
  editor.changeViewZones((accessor) => {
    for (const id of zoneIds) {
      const rec = activeImageZones.get(id);
      if (!rec?.zone.domNode) continue;
      if (nextContent != null) rec.contentHeightPx = nextContent;
      const heightInPx = applyImageZoneBoxHeights(
        rec.zone.domNode,
        rec.frame,
        rec.contentHeightPx,
        gapPx,
      );
      rec.zone.heightInPx = heightInPx;
      accessor.layoutZone(id);
    }
  });
}

export function forEachReaderImageViewZone(
  zoneIds: readonly string[],
  fn: (dom: HTMLElement, afterLineNumber: number) => void,
): void {
  for (const id of zoneIds) {
    const rec = activeImageZones.get(id);
    if (!rec) continue;
    const dom = rec.zone.domNode;
    if (!(dom instanceof HTMLElement)) continue;
    fn(dom, rec.zone.afterLineNumber);
  }
}

export function removeViewZonesById(
  editor: monaco.editor.IStandaloneCodeEditor,
  zoneIds: readonly string[],
): void {
  if (zoneIds.length === 0) return;
  editor.changeViewZones((accessor) => {
    for (const id of zoneIds) {
      accessor.removeZone(id);
      activeImageZones.delete(id);
    }
  });
}
