import type { editor } from "monaco-editor";

export type ScrollbarTrackGuardAction = "none" | "block" | "page";

/**
 * 拦截 Monaco 滚动条轨道点击。
 * - `block`：完全不滚动（「禁用」）
 * - `page`：按点在滑块上/下方调用上一屏/下一屏（与空格翻页同一套 `scrollByPageStep`）
 * - `none`：不拦截，交给 Monaco（「跳转」）
 *
 * 滑块 `.slider` 始终可拖；须捕获 + `stopImmediatePropagation`，否则 Monaco
 * 会先跳转并开始拖滑块。
 */
export function bindMonacoScrollbarTrackJumpGuard(
  ed: editor.ICodeEditor,
  getAction: () => ScrollbarTrackGuardAction,
  onPageStep: (direction: -1 | 1) => void,
  listenRoot?: HTMLElement | null,
): () => void {
  const root = listenRoot ?? ed.getDomNode();
  if (!root) return () => {};

  const onPointerDownCapture = (e: PointerEvent) => {
    const action = getAction();
    if (action === "none") return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    const track = t.closest(".monaco-scrollable-element > .scrollbar");
    if (!track || !root.contains(track)) return;
    if (t.closest(".slider")) return;

    // 阅读器主要关心竖条；横条隐藏，拦截即可
    if (!track.classList.contains("vertical")) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    if (action === "page") {
      const slider = track.querySelector(".slider");
      let direction: -1 | 1 = 1;
      if (slider instanceof HTMLElement) {
        const mid =
          (slider.getBoundingClientRect().top +
            slider.getBoundingClientRect().bottom) /
          2;
        direction = e.clientY < mid ? -1 : 1;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      onPageStep(direction);
      return;
    }

    const scrollTop = ed.getScrollTop();
    const scrollLeft = ed.getScrollLeft();
    e.preventDefault();
    e.stopImmediatePropagation();
    requestAnimationFrame(() => {
      if (getAction() !== "block") return;
      if (ed.getScrollTop() !== scrollTop || ed.getScrollLeft() !== scrollLeft) {
        ed.setScrollTop(scrollTop);
        ed.setScrollLeft(scrollLeft);
      }
    });
  };

  root.addEventListener("pointerdown", onPointerDownCapture, true);
  return () => {
    root.removeEventListener("pointerdown", onPointerDownCapture, true);
  };
}
