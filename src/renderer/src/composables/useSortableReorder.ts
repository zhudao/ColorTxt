import Sortable, { type SortableEvent } from "sortablejs";
import { nextTick, onBeforeUnmount, watch, type Ref } from "vue";

/** 拖动手柄 class，须加在「移动」触发器上 */
export const SORTABLE_ROW_HANDLE_CLASS = "sortableRowHandle";

export function useSortableReorder(opts: {
  containerRef: Ref<HTMLElement | null>;
  /** 可拖动子项，默认 `tr` */
  draggable?: string;
  /** 拖动手柄选择器，默认 `.sortableRowHandle` */
  handle?: string;
  enabled?: Ref<boolean>;
  /** 为 false 时不挂载（如弹窗关闭） */
  active?: Ref<boolean>;
  /** 列表项数量变化时重建 Sortable */
  itemCount?: Ref<number>;
  onReorder: (fromIndex: number, toIndex: number) => void;
}) {
  let sortable: Sortable | null = null;

  function destroy() {
    sortable?.destroy();
    sortable = null;
  }

  function syncDisabled() {
    sortable?.option("disabled", opts.enabled?.value === false);
  }

  function mount() {
    if (opts.active?.value === false) {
      destroy();
      return;
    }
    const el = opts.containerRef.value;
    if (!el) {
      destroy();
      return;
    }
    destroy();
    sortable = Sortable.create(el, {
      handle: opts.handle ?? `.${SORTABLE_ROW_HANDLE_CLASS}`,
      draggable: opts.draggable ?? "tr",
      animation: 150,
      ghostClass: "sortableRowGhost",
      chosenClass: "sortableRowChosen",
      dragClass: "sortableRowDrag",
      onEnd(evt: SortableEvent) {
        const oldIndex = evt.oldIndex;
        const newIndex = evt.newIndex;
        if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
        opts.onReorder(oldIndex, newIndex);
      },
    });
    syncDisabled();
  }

  function scheduleMount() {
    void nextTick(mount);
  }

  watch(() => opts.containerRef.value, scheduleMount);
  if (opts.active) watch(opts.active, scheduleMount);
  if (opts.enabled) watch(opts.enabled, syncDisabled);
  if (opts.itemCount) watch(opts.itemCount, scheduleMount);

  onBeforeUnmount(destroy);

  return { remount: scheduleMount };
}
