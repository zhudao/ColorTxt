/**
 * 让出主线程到下一个宏任务，使 Vue 有机会提交 DOM 更新（如底栏「转换中…」）。
 */
export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * 等两帧 layout/paint。`document.hidden` 时 rAF 可能永不触发
 *（摸鱼模式 hide 源窗后找书切章会卡死），改为立刻让出宏任务。
 */
export function afterNextPaints(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document !== "undefined" && document.hidden) {
      setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}
