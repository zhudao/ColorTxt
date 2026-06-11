import type * as monaco from "monaco-editor";
import { yieldToUi } from "../ebook/yieldToUi";
import type { BlockMarkdownImageLine } from "../markdown/markdownImages";
import { omitLinesAtLineNumbers } from "../markdown/markdownImages";

/** `replaceImgAnchorLinesWithViewZones` 返回：插图 View Zone id，以及删行前 Monaco 行号（降序，便于与滤空映射同步 splice） */
export type ReplaceImgAnchorsResult = {
  zoneIds: string[];
  deletedOriginalLineNumbersDesc: number[];
};

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
      dom.style.boxSizing = "border-box";
      dom.style.height = `${options.zoneHeightPx}px`;
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
      const id = accessor.addZone({
        afterLineNumber,
        afterColumn,
        ordinal: zoneOrdinal++,
        heightInPx: options.zoneHeightPx,
        domNode: dom,
        onDomNodeTop: () => {
          syncReaderImageViewZoneBox(editor, dom);
        },
      });
      zoneIds.push(id);
    }
  });
  options.onZonesChange?.(zoneIds);
  return { zoneIds, deletedOriginalLineNumbersDesc };
}

export function removeViewZonesById(
  editor: monaco.editor.IStandaloneCodeEditor,
  zoneIds: readonly string[],
): void {
  if (zoneIds.length === 0) return;
  editor.changeViewZones((accessor) => {
    for (const id of zoneIds) {
      accessor.removeZone(id);
    }
  });
}
