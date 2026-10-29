import { nextTick, toValue, type MaybeRefOrGetter, type Ref } from "vue";

/**
 * 列表多选快捷键（绑在可聚焦的列表容器 `@keydown` 上）：
 * Ctrl/Cmd+A 全选，Ctrl/Cmd+I 反选。
 * 行内按钮上的按键会冒泡到容器；过滤框等容器外焦点不会误触。
 */
export function useListSelectionHotkeys(options: {
  listEl: Ref<HTMLElement | null>;
  enabled?: MaybeRefOrGetter<boolean>;
  onSelectAll: () => void;
  onInvert?: () => void;
}) {
  function onListKeydown(ev: KeyboardEvent) {
    if (options.enabled !== undefined && !toValue(options.enabled)) return;
    const accel = ev.ctrlKey || ev.metaKey;
    if (!accel || ev.altKey) return;
    const key = ev.key.toLowerCase();
    if (key === "a") {
      ev.preventDefault();
      options.onSelectAll();
      return;
    }
    if (key === "i" && options.onInvert) {
      ev.preventDefault();
      options.onInvert();
    }
  }

  function focusList() {
    void nextTick(() =>
      options.listEl.value?.focus({ preventScroll: true }),
    );
  }

  return { onListKeydown, focusList };
}
