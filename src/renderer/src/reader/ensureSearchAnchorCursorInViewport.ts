import * as monaco from "monaco-editor";

/**
 * 「下一个匹配」以光标为锚。只读滚动常不带动光标，锚点会停在视口外。
 * 若光标（及非空选区）均不在当前视口内，将光标移到视口首行行首，便于从当前阅读位置继续查找。
 */
export function ensureSearchAnchorCursorInViewport(
  e: monaco.editor.ICodeEditor,
): void {
  const pos = e.getPosition();
  const ranges = e.getVisibleRanges();
  if (!pos || ranges.length === 0) return;

  const sel = e.getSelection();
  if (sel && !sel.isEmpty()) {
    if (
      ranges.some((r) => monaco.Range.areIntersectingOrTouching(r, sel))
    ) {
      return;
    }
  } else if (ranges.some((r) => r.containsPosition(pos))) {
    return;
  }

  const topLine = ranges[0]!.startLineNumber;
  e.setPosition({ lineNumber: topLine, column: 1 });
}
