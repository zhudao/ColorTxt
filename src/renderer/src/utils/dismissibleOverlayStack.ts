import { onBeforeUnmount, ref, unref, watch, type MaybeRef } from "vue";

/** 当前打开的可点外关闭菜单/下拉数量（供 chrome 监听） */
export const dismissibleOverlayDepth = ref(0);

export function hasDismissibleOverlay(): boolean {
  return dismissibleOverlayDepth.value > 0;
}

export function registerDismissibleOverlay(): () => void {
  dismissibleOverlayDepth.value += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    dismissibleOverlayDepth.value = Math.max(
      0,
      dismissibleOverlayDepth.value - 1,
    );
  };
}

/** 菜单 / 下拉等打开时登记，供点击模式「先关弹层、当次不翻页」判断 */
export function syncDismissibleOverlay(open: MaybeRef<boolean>) {
  let unreg: (() => void) | null = null;
  const stop = watch(
    () => unref(open),
    (isOpen) => {
      if (isOpen) {
        if (!unreg) unreg = registerDismissibleOverlay();
      } else {
        unreg?.();
        unreg = null;
      }
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    stop();
    unreg?.();
    unreg = null;
  });
}
