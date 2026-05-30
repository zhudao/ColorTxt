import Sortable, { type SortableEvent } from "sortablejs";
import { nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";
import type { CharacterRosterEntry } from "@shared/characterTypes";
import {
  animateGhostWrapScaleUp,
  playDragReleaseAnimation,
  prepareReleaseFlyerClone,
  snapResetShellTilt,
} from "../utils/characterCardTiltDom";

/** 按下后移动超过该像素才进入拖动（与 Sortable Grid 示例一致，区分点击翻面） */
const REORDER_DRAG_TOLERANCE_PX = 8;

const REORDER_FILTER =
  "button, a, input, textarea, select, .cardCornerActions, .cardCornerAction";

function isReorderDragFiltered(evt: Event, slot: HTMLElement): boolean {
  const t = evt.target;
  if (t instanceof Element && t.closest(REORDER_FILTER)) {
    return true;
  }
  // 3D 翻面背面无法可靠触发 Sortable；请先点击翻回正面再拖动排序
  return Boolean(slot.querySelector(".cardShell.flipped"));
}

function reorderByIndex(
  roster: readonly CharacterRosterEntry[],
  oldIndex: number,
  newIndex: number,
): CharacterRosterEntry[] {
  const next = [...roster];
  const [moved] = next.splice(oldIndex, 1);
  if (!moved) return [...roster];
  next.splice(newIndex, 0, moved);
  return next;
}

export function useCharacterRosterReorder(opts: {
  roster: Ref<readonly CharacterRosterEntry[]>;
  gridRef: Ref<HTMLElement | null>;
  canReorder: Ref<boolean>;
  onCommit: (next: CharacterRosterEntry[]) => void;
}) {
  const isDragging = ref(false);
  /** Sortable `onStart`：移动超过阈值、正式进入拖动时设置 */
  const draggingEntryId = ref<string | null>(null);
  const suppressFlipIds = ref<Record<string, true>>({});

  let sortable: Sortable | null = null;
  const suppressFlipTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let dragDidStart = false;
  let cancelGhostTiltAnim: (() => void) | null = null;
  let cancelReleaseAnim: (() => void) | null = null;
  let releaseAnimEntryId: string | null = null;
  let releaseFlyer: HTMLElement | null = null;
  let releaseFromRect: DOMRect | null = null;

  function applyDropLanding(entryId: string | null) {
    if (!entryId || !opts.gridRef.value) return;
    opts.gridRef.value
      .querySelector<HTMLElement>(
        `:scope > .cardGridSlot[data-entry-id="${entryId}"]`,
      )
      ?.classList.add("cardGridSlot--dropLanding");
  }

  function clearDropLanding(entryId: string | null) {
    if (!entryId || !opts.gridRef.value) return;
    opts.gridRef.value
      .querySelector<HTMLElement>(
        `:scope > .cardGridSlot[data-entry-id="${entryId}"]`,
      )
      ?.classList.remove("cardGridSlot--dropLanding");
  }

  function startGhostDragVisuals() {
    cancelGhostTiltAnim?.();
    void nextTick(() => {
      requestAnimationFrame(() => {
        const dragGhost = document.querySelector<HTMLElement>(
          ".cardGridSlot--drag",
        );
        const wrap = dragGhost?.querySelector<HTMLElement>(".cardShellWrap");
        const shell = dragGhost?.querySelector<HTMLElement>(
          ".cardShell.charHoloCard",
        );
        if (wrap) animateGhostWrapScaleUp(wrap);
        if (shell) cancelGhostTiltAnim = snapResetShellTilt(shell);
      });
    });
  }

  function stopGhostTiltAnim() {
    cancelGhostTiltAnim?.();
    cancelGhostTiltAnim = null;
  }

  function stopReleaseAnim() {
    cancelReleaseAnim?.();
    cancelReleaseAnim = null;
  }

  function bindReleaseListeners() {
    document.addEventListener("pointerup", onDocumentPointerUpCapture, true);
    document.addEventListener("pointercancel", onDocumentPointerUpCapture, true);
  }

  function unbindReleaseListeners() {
    document.removeEventListener("pointerup", onDocumentPointerUpCapture, true);
    document.removeEventListener(
      "pointercancel",
      onDocumentPointerUpCapture,
      true,
    );
  }

  function clearPendingReleaseFlyer() {
    releaseFlyer?.remove();
    releaseFlyer = null;
    releaseFromRect = null;
  }

  function onDocumentPointerUpCapture() {
    if (!dragDidStart) return;
    const ghost = document.querySelector<HTMLElement>(".cardGridSlot--drag");
    if (!ghost) return;

    clearPendingReleaseFlyer();
    releaseFromRect = ghost.getBoundingClientRect();
    releaseAnimEntryId = ghost.dataset.entryId ?? null;
    releaseFlyer = prepareReleaseFlyerClone(ghost);
  }

  function markSuppressFlip(entryId: string) {
    suppressFlipIds.value = { ...suppressFlipIds.value, [entryId]: true };
    const existing = suppressFlipTimers.get(entryId);
    if (existing) clearTimeout(existing);
    suppressFlipTimers.set(
      entryId,
      setTimeout(() => {
        const next = { ...suppressFlipIds.value };
        delete next[entryId];
        suppressFlipIds.value = next;
        suppressFlipTimers.delete(entryId);
      }, 400),
    );
  }

  function entryIdFromSortableItem(item: HTMLElement): string | null {
    return item.dataset.entryId ?? null;
  }

  function destroySortable() {
    sortable?.destroy();
    sortable = null;
  }

  function syncSortableDisabled() {
    sortable?.option("disabled", !opts.canReorder.value);
  }

  function mountSortable() {
    const el = opts.gridRef.value;
    destroySortable();
    if (!el) return;

    sortable = Sortable.create(el, {
      animation: 150,
      easing: "cubic-bezier(0.25, 0.8, 0.25, 1)",
      forceFallback: true,
      fallbackOnBody: true,
      fallbackTolerance: REORDER_DRAG_TOLERANCE_PX,
      draggable: ".cardGridSlot",
      filter: (evt: Event, target: HTMLElement) =>
        isReorderDragFiltered(evt, target),
      preventOnFilter: true,
      disabled: !opts.canReorder.value,
      ghostClass: "cardGridSlot--ghost",
      dragClass: "cardGridSlot--drag",
      onStart: (evt: SortableEvent) => {
        const itemEl = evt.item as HTMLElement;
        const id = entryIdFromSortableItem(itemEl);
        if (id) markSuppressFlip(id);
        draggingEntryId.value = id;
        isDragging.value = true;
        dragDidStart = true;
        bindReleaseListeners();
        startGhostDragVisuals();
      },
      onEnd: (evt: SortableEvent) => {
        unbindReleaseListeners();
        stopGhostTiltAnim();

        const itemEl = evt.item as HTMLElement;
        const entryId =
          entryIdFromSortableItem(itemEl) ?? releaseAnimEntryId;
        const flyer = releaseFlyer;
        const fromRect = releaseFromRect;
        releaseFlyer = null;
        releaseFromRect = null;

        if (flyer && fromRect && entryId) {
          applyDropLanding(entryId);
          requestAnimationFrame(() => {
            const toRect = itemEl.getBoundingClientRect();
            stopReleaseAnim();
            cancelReleaseAnim = playDragReleaseAnimation({
              flyer,
              fromRect,
              targetRect: toRect,
              onDone: () => {
                clearDropLanding(releaseAnimEntryId);
                releaseAnimEntryId = null;
                cancelReleaseAnim = null;
              },
            });
          });
        } else {
          clearPendingReleaseFlyer();
        }

        isDragging.value = false;
        draggingEntryId.value = null;

        if (entryId && dragDidStart) markSuppressFlip(entryId);
        dragDidStart = false;

        const { oldIndex, newIndex } = evt;
        if (oldIndex == null || newIndex == null || oldIndex === newIndex) {
          return;
        }

        const next = reorderByIndex(opts.roster.value, oldIndex, newIndex);
        const changed = next.some((e, i) => e.id !== opts.roster.value[i]?.id);
        if (changed) opts.onCommit(next);
      },
    });
  }

  function tiltEnabledFor(entryId: string): boolean {
    if (isDragging.value) return false;
    if (draggingEntryId.value === entryId) return false;
    return true;
  }

  function shouldSuppressFlip(entryId: string): boolean {
    return Boolean(suppressFlipIds.value[entryId]);
  }

  function cancelActive() {
    unbindReleaseListeners();
    stopReleaseAnim();
    clearPendingReleaseFlyer();
    clearDropLanding(releaseAnimEntryId);
    releaseAnimEntryId = null;
    stopGhostTiltAnim();
    dragDidStart = false;
    draggingEntryId.value = null;
    isDragging.value = false;
    destroySortable();
    void nextTick(() => {
      mountSortable();
    });
  }

  watch(
    () => opts.canReorder.value,
    () => {
      syncSortableDisabled();
    },
  );

  watch(
    () => [opts.gridRef.value, opts.roster.value.length] as const,
    async () => {
      await nextTick();
      mountSortable();
    },
    { flush: "post", immediate: true },
  );

  onBeforeUnmount(() => {
    unbindReleaseListeners();
    stopReleaseAnim();
    clearPendingReleaseFlyer();
    stopGhostTiltAnim();
    destroySortable();
    for (const timer of suppressFlipTimers.values()) {
      clearTimeout(timer);
    }
    suppressFlipTimers.clear();
  });

  return {
    isDragging,
    draggingEntryId,
    tiltEnabledFor,
    shouldSuppressFlip,
    cancelActive,
  };
}
