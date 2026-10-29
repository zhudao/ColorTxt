import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";
import {
  computeAnchoredMenuPosition,
  flipAnchoredMenuVertical,
  type AnchoredMenuPlacement,
} from "../utils/appShellMenuPosition";
import { syncDismissibleOverlay } from "../utils/dismissibleOverlayStack";

export type UseAnchoredAppShellMenuOptions = {
  /** 未传则 composable 内部管理 */
  open?: Ref<boolean>;
  anchor: Ref<HTMLElement | null>;
  placement: MaybeRefOrGetter<AnchoredMenuPlacement>;
  /** 首次布局前用于宽度估算；也可写成 CSS width（支持 ref/getter，便于面板变宽后重算） */
  widthPx?: MaybeRefOrGetter<number | undefined>;
  /**
   * 为 false 时不把 widthPx 写成面板 CSS width（仅作定位估算）。
   * 默认 true，与历史「更多」菜单固定宽度行为一致。
   */
  applyWidthPx?: boolean;
  gap?: number;
  margin?: number;
  zIndex?: number;
  panelMaxHeight?: number;
  /**
   * 首选方向剩余高度不足、对侧更宽裕时，在 above/below 之间翻转。
   * beside-* 不受影响。
   */
  autoFlip?: boolean;
  disabled?: Ref<boolean>;
  /** 为 false 时不注册外部点击 / Esc 关闭（悬停子菜单由父级关） */
  enableDismiss?: boolean;
  /** 点击这些根节点内部时不关闭 */
  excludeCloseWithin?: Ref<readonly (HTMLElement | null | undefined)[]>;
  onClose?: () => void;
};

/**
 * 锚定按钮/元素的 App Shell 弹出菜单：定位、视口夹取、外点关闭、Esc、resize 重算。
 */
export function useAnchoredAppShellMenu(opts: UseAnchoredAppShellMenuOptions) {
  const internalOpen = ref(false);
  const open = opts.open ?? internalOpen;
  const panelRef = ref<HTMLElement | null>(null);
  const left = ref(0);
  const top = ref(0);
  const availableMaxHeight = ref<number | undefined>(undefined);
  const resolvedPlacement = ref<AnchoredMenuPlacement>(toValue(opts.placement));

  syncDismissibleOverlay(open);

  /** `.appShellMenuPanel` 上下 padding 各 6px，内层滚动高度需扣掉，避免面板本身溢出窗口 */
  const PANEL_PAD_Y = 12;
  /** 首选侧短于此时且对侧更宽裕才翻转，避免按钮略偏下就整块翻上去 */
  const AUTO_FLIP_MIN_PX = 240;

  function availableHeightForPlacement(
    rect: DOMRect,
    placement: AnchoredMenuPlacement,
  ): number {
    const gap = opts.gap ?? 4;
    const margin = opts.margin ?? 8;
    if (placement.startsWith("above")) {
      return Math.max(80, rect.top - gap - margin - PANEL_PAD_Y);
    }
    if (placement.startsWith("beside")) {
      return Math.max(80, window.innerHeight - margin * 2 - PANEL_PAD_Y);
    }
    return Math.max(
      80,
      window.innerHeight - rect.bottom - gap - margin - PANEL_PAD_Y,
    );
  }

  function pickPlacement(rect: DOMRect): AnchoredMenuPlacement {
    const preferred = toValue(opts.placement);
    if (!opts.autoFlip) return preferred;
    if (preferred.startsWith("beside")) return preferred;
    const below = availableHeightForPlacement(rect, "below-center");
    const above = availableHeightForPlacement(rect, "above-center");
    if (preferred.startsWith("below") && below < AUTO_FLIP_MIN_PX && above > below) {
      return flipAnchoredMenuVertical(preferred);
    }
    if (preferred.startsWith("above") && above < AUTO_FLIP_MIN_PX && below > above) {
      return flipAnchoredMenuVertical(preferred);
    }
    return preferred;
  }

  async function reposition() {
    const anchor = opts.anchor.value;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const placement = pickPlacement(rect);
    resolvedPlacement.value = placement;
    const maxH = opts.panelMaxHeight ?? availableHeightForPlacement(rect, placement);
    availableMaxHeight.value = maxH;
    await nextTick();
    const panel = panelRef.value;
    const estimateW = toValue(opts.widthPx);
    const w = panel?.offsetWidth || estimateW || 160;
    const h = Math.min(panel?.offsetHeight ?? 0, maxH);
    const pos = computeAnchoredMenuPosition(
      rect,
      { width: w, height: h },
      placement,
      { gap: opts.gap, margin: opts.margin },
    );
    left.value = pos.left;
    top.value = pos.top;
  }

  async function openMenu() {
    if (opts.disabled?.value) return;
    open.value = true;
    await reposition();
    // 首帧可能尚未量到真实宽度，再对齐一次，避免箭头/面板相对锚点偏移
    await nextTick();
    requestAnimationFrame(() => {
      if (open.value) void reposition();
    });
  }

  function closeMenu() {
    if (!open.value) return;
    open.value = false;
    opts.onClose?.();
  }

  async function toggleMenu() {
    if (opts.disabled?.value) return;
    if (open.value) {
      closeMenu();
      return;
    }
    await openMenu();
  }

  function isExcludedTarget(target: Node | null): boolean {
    if (!target) return false;
    if (opts.anchor.value?.contains(target)) return true;
    if (panelRef.value?.contains(target)) return true;
    if (
      target instanceof Element &&
      (target.closest("[data-header-float-panel]") ||
        target.closest(".customSelectPanel"))
    ) {
      return true;
    }
    const extra = opts.excludeCloseWithin?.value ?? [];
    for (const el of extra) {
      if (el?.contains(target)) return true;
    }
    return false;
  }

  function onDocPointerDown(ev: PointerEvent) {
    if (!open.value || opts.enableDismiss === false) return;
    if (isExcludedTarget(ev.target as Node | null)) return;
    closeMenu();
  }

  function onDocKeydown(ev: KeyboardEvent) {
    if (opts.enableDismiss === false) return;
    if (ev.key !== "Escape" || !open.value) return;
    ev.preventDefault();
    ev.stopPropagation();
    closeMenu();
  }

  function onWindowResize() {
    if (!open.value) return;
    void reposition();
  }

  if (opts.enableDismiss !== false) {
    onMounted(() => {
      document.addEventListener("pointerdown", onDocPointerDown, true);
      document.addEventListener("keydown", onDocKeydown, true);
      window.addEventListener("resize", onWindowResize);
    });

    onBeforeUnmount(() => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onDocKeydown, true);
      window.removeEventListener("resize", onWindowResize);
    });
  } else {
    onMounted(() => {
      window.addEventListener("resize", onWindowResize);
    });
    onBeforeUnmount(() => {
      window.removeEventListener("resize", onWindowResize);
    });
  }

  watch(open, (isOpen) => {
    if (isOpen) void reposition();
  });

  const panelStyle = computed(() => {
    const w = toValue(opts.widthPx);
    const applyW = opts.applyWidthPx !== false && w != null;
    return {
      left: `${left.value}px`,
      top: `${top.value}px`,
      zIndex: opts.zIndex ?? 7200,
      ...(applyW ? { width: `${w}px` } : {}),
      ...(opts.panelMaxHeight != null
        ? { maxHeight: `${opts.panelMaxHeight}px` }
        : availableMaxHeight.value != null
          ? { maxHeight: `${availableMaxHeight.value}px` }
          : {}),
    };
  });

  return {
    open,
    panelRef,
    left,
    top,
    availableMaxHeight,
    resolvedPlacement,
    panelStyle,
    openMenu,
    closeMenu,
    toggleMenu,
    reposition,
  };
}
