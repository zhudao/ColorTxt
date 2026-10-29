export const SMART_FORMAT_DIFF_REVERT_TIP = "还原原文";

/** 为 Monaco Diff 中间 gutter 的还原按钮设置 title / aria-label */
export function enhanceSmartFormatDiffRevertButtons(root: HTMLElement): void {
  const selectors = [
    ".monaco-diff-editor .gutter .gutterItem .buttons .action-item",
    ".monaco-diff-editor .gutter .gutterItem .buttons .action-label",
  ];
  for (const sel of selectors) {
    root.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      el.title = SMART_FORMAT_DIFF_REVERT_TIP;
      el.setAttribute("aria-label", SMART_FORMAT_DIFF_REVERT_TIP);
    });
  }
}

export function installSmartFormatDiffRevertUi(
  root: HTMLElement,
): () => void {
  const run = () => enhanceSmartFormatDiffRevertButtons(root);
  run();
  const observer = new MutationObserver(() => run());
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
