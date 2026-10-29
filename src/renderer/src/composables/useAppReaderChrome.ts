import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type ReaderMain from "../components/ReaderMain.vue";
import {
  FULLSCREEN_BOTTOM_EDGE_PX,
  FULLSCREEN_LEFT_EDGE_PX,
  FULLSCREEN_RIGHT_SCROLLBAR_GUTTER_PX,
  FULLSCREEN_TOP_EDGE_PX,
  SIDEBAR_MIN_READER_WIDTH,
  SIDEBAR_MIN_WIDTH,
  defaultIsMinimalistView,
} from "../constants/appUi";
import { nodeIsUnderFullscreenHeaderFloat } from "../utils/fullscreenHeaderFloat";
import { nodeIsUnderFullscreenSidebarFloat } from "../utils/fullscreenSidebarFloat";
import {
  dismissibleOverlayDepth,
  hasDismissibleOverlay,
} from "../utils/dismissibleOverlayStack";
import {
  getModalStackDepth,
  hasEscBeforeModalLayers,
  subscribeModalStackChange,
} from "../utils/modalStack";
import { appLoadingModel } from "../services/appLoading";

/** 全屏下鼠标静止超过该时间后隐藏光标 */
const FULLSCREEN_CURSOR_HIDE_IDLE_MS = 2000;
const FULLSCREEN_TIP_ENTER_MSG = "按 2 次 Esc 退出全屏";
const FULLSCREEN_TIP_CONFIRM_MSG = "再按 1 次 Esc 退出全屏";
/** 连按两次 Esc 退出全屏的确认窗口 */
const EXIT_FULLSCREEN_ESC_CONFIRM_MS = 2000;

/** 过渡结束后再开始算「可见时长」，避免 macOS 全屏动画期间就把计时耗完 */
const FULLSCREEN_TIP_MS_BEFORE_FADE = 1000;
const FULLSCREEN_TIP_FADE_MS = 250;

function fullscreenTipPostTransitionDelayMs(): number {
  if (typeof navigator === "undefined") return 120;
  const p = navigator.platform;
  if (p === "MacIntel" || p === "MacARM") return 480;
  if (/Mac OS X/i.test(navigator.userAgent)) return 480;
  return 120;
}

type ReaderRef = Ref<InstanceType<typeof ReaderMain> | null>;

/** 从 `start` 沿 DOM / ShadowRoot.host 向上，判断是否落在 `panel` 子树内（与 `useAppFullscreenReaderLayout` 侧栏判定一致）。 */
function nodeIsUnderFullscreenPanel(panel: HTMLElement, start: Node | null) {
  let cur: Node | null = start;
  while (cur) {
    if (cur === panel) return true;
    if (cur instanceof Element && panel.contains(cur)) return true;
    const root = cur.getRootNode();
    if (root instanceof ShadowRoot) cur = root.host;
    else cur = cur.parentNode;
  }
  return false;
}

/**
 * 全屏 / 极简浮动 UI 统一模型（`chromeAutoHide`）：
 * - `document` mousemove：仅在对应边缘「感应区」且面板未显示、且未按下鼠标按键时唤起；已显示时若指针已不在该面板上则收起；有蒙版弹层（相对挂载时多出来的模态 / 灯箱 / 加载蒙层）时不唤起，并收起已浮出的顶栏/底栏/侧栏；
 * - 面板根节点 `@mouseleave`：自动隐藏 chrome 且已显示时收起（与真实命中区域一致）；
 * - 指针离开窗口（`relatedTarget == null`）：收起浮层（快速擦过边缘移出窗口时可能从未进入面板，不会收到面板 mouseleave）；
 *   输入法合成中、或焦点仍在浮层输入框内时不收起（候选词弹框是原生窗口，会出现在指针下方并触发同样的 mouseout）；
 * - 有可点外关闭的弹出菜单时：移出面板不收起；菜单关掉后若指针已不在面板上再收起；
 * - `.layout` 捕获阶段 `pointerdown`：收起顶栏/底栏/侧栏（点击落在已展开侧栏内除外；须捕获以便点击模式在阅读区截断冒泡前仍能收起）；
 * - 快捷键等非边缘唤起侧栏（`revealFullscreenSidebar`）：指针尚未进入侧栏前，mousemove 不因「不在侧栏上」而收起（点阅读区仍收起）；
 * - 全屏 / 极简：指针静止约 2 秒后隐藏系统光标（顶/底/侧栏浮出或拖侧栏时不藏；**编辑模式光标常显**）；
 * - Esc：输入框聚焦时只失焦（入口 `escapeBlurTextField` 捕获，含菜单 / 蒙版内）；再关蒙版与弹出菜单；再收浮动顶/底/侧栏；全屏再连按两次才退出。
 */
export function useAppReaderChrome(deps: {
  readerRef: ReaderRef;
  /** 全屏侧栏：Teleport 浮层打开（文件列表下拉、AI 助手历史/导出/模型菜单、header「更多」等）；为真时移出侧栏不立刻收起 */
  fullscreenSidebarPopoversSuppressCollapse: Ref<boolean>;
  /** 编辑模式光标常显，不走空闲隐藏 */
  readerEditMode: Ref<boolean>;
  /** 应用内退出全屏前采锚（macOS 过渡动画会打乱视口） */
  prepareFullscreenExitViewportPreserve?: () => void;
}) {
  const isFullscreenView = ref(false);
  const isMinimalistView = ref(defaultIsMinimalistView);
  const chromeAutoHide = computed(
    () => isFullscreenView.value || isMinimalistView.value,
  );
  const showFullscreenTip = ref(false);
  const fullscreenTipFading = ref(false);
  const fullscreenTipText = ref(FULLSCREEN_TIP_ENTER_MSG);
  let exitFullscreenEscArmed = false;
  let tipFadeTimer: ReturnType<typeof setTimeout> | null = null;
  let tipHideTimer: ReturnType<typeof setTimeout> | null = null;
  let tipArmDelayTimer: ReturnType<typeof setTimeout> | null = null;
  const showFullscreenHeader = ref(false);
  const fullscreenHeaderOverlayRef = ref<HTMLElement | null>(null);
  const showFullscreenFooter = ref(false);
  const fullscreenFooterOverlayRef = ref<HTMLElement | null>(null);
  /** 全屏时鼠标靠近左边缘显示的浮动章节侧栏 */
  const showFullscreenSidebar = ref(false);
  const fullscreenSidebarOverlayRef = ref<HTMLElement | null>(null);

  /** 供「文件列表浮层关闭后」判断是否应收起全屏侧栏（与 `mousemove` 同步） */
  const lastFullscreenPointerClientX = ref(0);
  const lastFullscreenPointerClientY = ref(0);

  const sidebarWidth = ref(270);
  /** 全屏专用侧栏宽度；非全屏为 null（退出全屏时销毁，窗口态仍用 sidebarWidth） */
  const fullscreenSidebarWidth = ref<number | null>(null);
  const resizingSidebar = ref(false);

  const sidebarWidthForLayout = computed(() => {
    if (isFullscreenView.value && fullscreenSidebarWidth.value != null) {
      return fullscreenSidebarWidth.value;
    }
    return sidebarWidth.value;
  });

  const fullscreenCursorHidden = ref(false);
  let fullscreenCursorHideTimer: ReturnType<typeof setTimeout> | null = null;

  /** 顶栏 / 侧栏 / 底栏任一展开时不自动隐藏光标 */
  function anyFullscreenBarVisible(): boolean {
    return (
      showFullscreenHeader.value ||
      showFullscreenFooter.value ||
      showFullscreenSidebar.value
    );
  }

  function clearFullscreenCursorHideTimer() {
    if (fullscreenCursorHideTimer) {
      clearTimeout(fullscreenCursorHideTimer);
      fullscreenCursorHideTimer = null;
    }
  }

  function armFullscreenCursorHideTimer() {
    clearFullscreenCursorHideTimer();
    if (
      !chromeAutoHide.value ||
      deps.readerEditMode.value ||
      resizingSidebar.value ||
      anyFullscreenBarVisible()
    ) {
      return;
    }
    fullscreenCursorHideTimer = setTimeout(() => {
      fullscreenCursorHideTimer = null;
      fullscreenCursorHidden.value = true;
    }, FULLSCREEN_CURSOR_HIDE_IDLE_MS);
  }

  /** 全屏 / 极简下指针移动时调用：显示光标并重新开始空闲计时（编辑模式不藏） */
  function bumpFullscreenCursorIdle() {
    if (!chromeAutoHide.value || resizingSidebar.value) return;
    fullscreenCursorHidden.value = false;
    if (deps.readerEditMode.value) {
      clearFullscreenCursorHideTimer();
      return;
    }
    armFullscreenCursorHideTimer();
  }

  watch(
    () =>
      [
        chromeAutoHide.value,
        deps.readerEditMode.value,
        resizingSidebar.value,
        showFullscreenHeader.value,
        showFullscreenFooter.value,
        showFullscreenSidebar.value,
      ] as const,
    ([hidden, edit, rs, header, footer, sidebar]) => {
      if (!hidden || edit) {
        clearFullscreenCursorHideTimer();
        fullscreenCursorHidden.value = false;
        return;
      }
      if (rs || header || footer || sidebar) {
        clearFullscreenCursorHideTimer();
        fullscreenCursorHidden.value = false;
        return;
      }
      armFullscreenCursorHideTimer();
    },
  );

  function clearFullscreenTipTimers() {
    if (tipFadeTimer) clearTimeout(tipFadeTimer);
    if (tipHideTimer) clearTimeout(tipHideTimer);
    if (tipArmDelayTimer) clearTimeout(tipArmDelayTimer);
    tipFadeTimer = null;
    tipHideTimer = null;
    tipArmDelayTimer = null;
  }

  function armFullscreenTipHideTimers(
    visibleMs: number = FULLSCREEN_TIP_MS_BEFORE_FADE,
  ) {
    if (!showFullscreenTip.value) return;
    clearFullscreenTipTimers();
    fullscreenTipFading.value = false;
    tipFadeTimer = setTimeout(() => {
      fullscreenTipFading.value = true;
    }, visibleMs);
    tipHideTimer = setTimeout(() => {
      showFullscreenTip.value = false;
      fullscreenTipFading.value = false;
    }, visibleMs + FULLSCREEN_TIP_FADE_MS);
  }

  async function enterOrExitFullscreenView() {
    if (!isFullscreenView.value) {
      isFullscreenView.value = true;
      fullscreenTipText.value = FULLSCREEN_TIP_ENTER_MSG;
      showFullscreenTip.value = true;
      fullscreenTipFading.value = false;
      clearFullscreenTipTimers();

      try {
        await window.colorTxt.setFullscreen(true);
        tipArmDelayTimer = setTimeout(() => {
          tipArmDelayTimer = null;
          armFullscreenTipHideTimers();
        }, fullscreenTipPostTransitionDelayMs());
      } catch {
        isFullscreenView.value = false;
        showFullscreenTip.value = false;
        fullscreenTipFading.value = false;
        clearFullscreenTipTimers();
      }
      return;
    }

    try {
      deps.prepareFullscreenExitViewportPreserve?.();
      await window.colorTxt.setFullscreen(false);
    } catch {
      // ignore; main-process fullscreen event will handle UI sync if possible
    }
  }

  function toggleMinimalistView() {
    if (isFullscreenView.value) return;
    isMinimalistView.value = !isMinimalistView.value;
  }

  watch(isMinimalistView, (on) => {
    if (on && !isFullscreenView.value) {
      showFullscreenHeader.value = false;
      showFullscreenFooter.value = false;
      showFullscreenSidebar.value = false;
    }
  });

  function getSidebarMaxWidth(): number {
    return Math.max(0, window.innerWidth - SIDEBAR_MIN_READER_WIDTH);
  }

  function getSidebarMinWidth(): number {
    return Math.min(SIDEBAR_MIN_WIDTH, getSidebarMaxWidth());
  }

  function clampSidebarWidthToViewport(): void {
    const minW = getSidebarMinWidth();
    const maxW = getSidebarMaxWidth();
    const clamp = (w: number) => Math.min(maxW, Math.max(minW, w));
    sidebarWidth.value = clamp(sidebarWidth.value);
    if (isFullscreenView.value && fullscreenSidebarWidth.value != null) {
      fullscreenSidebarWidth.value = clamp(fullscreenSidebarWidth.value);
    }
  }

  watch(isFullscreenView, (fs) => {
    clearExitFullscreenEscArm();
    if (fs) {
      const minW = getSidebarMinWidth();
      const maxW = getSidebarMaxWidth();
      fullscreenSidebarWidth.value = Math.min(
        maxW,
        Math.max(minW, sidebarWidth.value),
      );
      showFullscreenHeader.value = false;
      showFullscreenFooter.value = false;
      showFullscreenSidebar.value = false;
      suppressChromeEdgeRevealUntilPointerLeaves = true;
      deps.readerRef.value?.closeFindWidgetIfRevealed?.();
    } else {
      fullscreenSidebarWidth.value = null;
    }
  });

  function startResizeSidebar(ev: MouseEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    resizingSidebar.value = true;
  }

  function endSidebarResize() {
    resizingSidebar.value = false;
  }

  /** 另外两个浮动层未显示时，才允许通过边缘悬停打开当前层 */
  function canShowFullscreenPanel(
    which: "header" | "sidebar" | "footer",
  ): boolean {
    if (which === "header") {
      return !showFullscreenSidebar.value && !showFullscreenFooter.value;
    }
    if (which === "sidebar") {
      return !showFullscreenHeader.value && !showFullscreenFooter.value;
    }
    return !showFullscreenHeader.value && !showFullscreenSidebar.value;
  }

  /** 选区 / 拖动滚动时按住指针移到边缘不唤起浮动层 */
  function pointerButtonsHeld(ev: MouseEvent): boolean {
    return ev.buttons !== 0;
  }

  /**
   * 进入全屏、或按住指针拖入边缘后：在离开各边缘感应区前不再唤起，
   * 避免松手 / 全屏后同位置的 mousemove 立刻把面板拉回来。
   */
  let suppressChromeEdgeRevealUntilPointerLeaves = false;

  /**
   * 快捷键打开浮动侧栏时指针往往仍在阅读区：在指针进入侧栏前不因
   * mousemove「不在侧栏上」而收起。进入后恢复边缘感应那套离开即收。
   */
  let stickyFullscreenSidebarUntilPointerEnters = false;

  /** IME 候选窗为原生窗口，出现在指针下会 mouseout relatedTarget=null，看起来像离开网页 */
  let imeComposing = false;

  function onImeCompositionStart() {
    imeComposing = true;
  }

  function onImeCompositionEnd() {
    imeComposing = false;
  }

  function isTypingFieldElement(el: EventTarget | null): el is HTMLElement {
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag !== "INPUT") return false;
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    return (
      type !== "button" &&
      type !== "checkbox" &&
      type !== "radio" &&
      type !== "file" &&
      type !== "submit" &&
      type !== "reset" &&
      type !== "hidden" &&
      type !== "image" &&
      type !== "range" &&
      type !== "color"
    );
  }

  function focusedTypingInFloatingChrome(): boolean {
    const el = document.activeElement;
    if (!isTypingFieldElement(el)) return false;
    if (showFullscreenHeader.value) {
      const header = fullscreenHeaderOverlayRef.value;
      if (header && nodeIsUnderFullscreenPanel(header, el)) return true;
      if (nodeIsUnderFullscreenHeaderFloat(el)) return true;
    }
    if (showFullscreenSidebar.value) {
      const sidebar = fullscreenSidebarOverlayRef.value;
      if (sidebar && nodeIsUnderFullscreenPanel(sidebar, el)) return true;
      if (nodeIsUnderFullscreenSidebarFloat(el)) return true;
    }
    if (showFullscreenFooter.value) {
      const footer = fullscreenFooterOverlayRef.value;
      if (footer && nodeIsUnderFullscreenPanel(footer, el)) return true;
    }
    return false;
  }

  /** 合成中，或「离开网页」且焦点仍在浮层输入框（IME 候选窗盖住指针） */
  function chromeCollapseBlockedByIme(ev?: MouseEvent): boolean {
    if (imeComposing) return true;
    if (ev && ev.relatedTarget != null) return false;
    return focusedTypingInFloatingChrome();
  }

  function pinFullscreenSidebarUntilPointerEnters() {
    stickyFullscreenSidebarUntilPointerEnters = true;
  }

  /** 快捷键唤出浮动侧栏：不改 `showSidebar` 持久化开关；指针进入前不因 mousemove 收起。 */
  function revealFullscreenSidebar() {
    if (!chromeAutoHide.value) return;
    showFullscreenSidebar.value = true;
    pinFullscreenSidebarUntilPointerEnters();
  }

  watch(showFullscreenSidebar, (shown) => {
    if (!shown) stickyFullscreenSidebarUntilPointerEnters = false;
  });

  function pointerInChromeEdgeZone(ev: MouseEvent): boolean {
    const x = ev.clientX;
    const y = ev.clientY;
    if (x <= FULLSCREEN_LEFT_EDGE_PX) return true;
    if (y <= FULLSCREEN_TOP_EDGE_PX) return true;
    if (y >= window.innerHeight - FULLSCREEN_BOTTOM_EDGE_PX) return true;
    return false;
  }

  function skipChromeEdgeReveal(ev: MouseEvent): boolean {
    if (!suppressChromeEdgeRevealUntilPointerLeaves) return false;
    if (pointerInChromeEdgeZone(ev)) return true;
    suppressChromeEdgeRevealUntilPointerLeaves = false;
    return false;
  }

  /** 按住时不唤出；拖入边缘则记下抑制，松手后仍须先离开感应区。 */
  function blockChromeEdgeReveal(ev: MouseEvent): boolean {
    if (pointerButtonsHeld(ev)) {
      suppressChromeEdgeRevealUntilPointerLeaves = pointerInChromeEdgeZone(ev);
      return true;
    }
    return skipChromeEdgeReveal(ev);
  }

  /**
   * 挂载时已在栈上的模态不算挡感应（找书阅读器整窗即一层 AppModal）。
   * 设置/配色等后开的蒙版、灯箱、加载层则不唤起顶/底/侧栏。
   */
  let overlayBaselineDepth = 0;
  let unsubModalStack: (() => void) | null = null;

  function chromeEdgeRevealBlockedByOverlay(): boolean {
    if (hasEscBeforeModalLayers()) return true;
    if (appLoadingModel.open) return true;
    return getModalStackDepth() > overlayBaselineDepth;
  }

  /** 蒙版弹层打开时收起已浮出的顶栏/底栏/侧栏（顶栏蒙层在 header-float 白名单内，mouseleave 不会收起）。 */
  function collapseAllChromeForBlockingOverlay() {
    if (!chromeAutoHide.value) return;
    if (showFullscreenHeader.value) {
      collapseFullscreenHeaderAndCloseFindIfRevealed();
    }
    showFullscreenFooter.value = false;
    showFullscreenSidebar.value = false;
  }

  /** 左缘感应：仅负责唤起。收起由侧栏容器 @mouseleave 处理。 */
  function recordFullscreenPointer(ev: MouseEvent) {
    if (!chromeAutoHide.value) return;
    lastFullscreenPointerClientX.value = ev.clientX;
    lastFullscreenPointerClientY.value = ev.clientY;
  }

  function updateFullscreenSidebarHover(ev: MouseEvent) {
    if (!chromeAutoHide.value) return;
    if (blockChromeEdgeReveal(ev)) return;
    if (showFullscreenSidebar.value) {
      if (!hasDismissibleOverlay()) {
        tryCollapseFullscreenSidebarFromPointer(ev.clientX, ev.clientY);
      }
      return;
    }
    if (chromeEdgeRevealBlockedByOverlay()) return;
    const x = ev.clientX;
    if (x <= FULLSCREEN_LEFT_EDGE_PX && canShowFullscreenPanel("sidebar")) {
      showFullscreenSidebar.value = true;
    }
  }

  /** 指针既不在侧栏子树也不在侧栏 Teleport 白名单上时收起浮动侧栏 */
  function tryCollapseFullscreenSidebarFromPointer(
    clientX: number,
    clientY: number,
  ) {
    if (!chromeAutoHide.value || !showFullscreenSidebar.value) return;
    if (resizingSidebar.value) return;
    if (deps.fullscreenSidebarPopoversSuppressCollapse.value) return;
    const top = document.elementFromPoint(clientX, clientY);
    if (imeComposing || (!top && focusedTypingInFloatingChrome())) return;
    const sidebar = fullscreenSidebarOverlayRef.value;
    const overSidebar = Boolean(
      (top && nodeIsUnderFullscreenSidebarFloat(top)) ||
        (sidebar && top && nodeIsUnderFullscreenPanel(sidebar, top)),
    );
    if (overSidebar) {
      stickyFullscreenSidebarUntilPointerEnters = false;
      return;
    }
    if (stickyFullscreenSidebarUntilPointerEnters) return;
    showFullscreenSidebar.value = false;
  }

  function onFullscreenSidebarMouseLeave(ev: MouseEvent) {
    if (!chromeAutoHide.value) return;
    if (resizingSidebar.value) return;
    if (hasDismissibleOverlay()) return;
    if (deps.fullscreenSidebarPopoversSuppressCollapse.value) return;
    if (chromeCollapseBlockedByIme(ev)) return;
    const rt = ev.relatedTarget;
    if (rt instanceof Node && nodeIsUnderFullscreenSidebarFloat(rt)) return;
    const { clientX, clientY } = ev;
    requestAnimationFrame(() => {
      if (!chromeAutoHide.value || !showFullscreenSidebar.value) return;
      if (hasDismissibleOverlay()) return;
      if (deps.fullscreenSidebarPopoversSuppressCollapse.value) return;
      tryCollapseFullscreenSidebarFromPointer(clientX, clientY);
    });
  }

  watch(
    () => deps.fullscreenSidebarPopoversSuppressCollapse.value,
    (open, wasOpen) => {
      if (wasOpen !== true || open !== false) return;
      if (!chromeAutoHide.value || !showFullscreenSidebar.value) return;
      requestAnimationFrame(() => {
        if (deps.fullscreenSidebarPopoversSuppressCollapse.value) return;
        tryCollapseFullscreenSidebarFromPointer(
          lastFullscreenPointerClientX.value,
          lastFullscreenPointerClientY.value,
        );
      });
    },
  );

  /** 收起浮动顶栏并关闭已显示的 Monaco 查找栏（不经过 `watch`，避免与 `onToggleFind` 同 tick 竞态） */
  function collapseFullscreenHeaderAndCloseFindIfRevealed() {
    if (!chromeAutoHide.value) return;
    if (!showFullscreenHeader.value) return;
    showFullscreenHeader.value = false;
    deps.readerRef.value?.closeFindWidgetIfRevealed?.();
  }

  /** 指针既不在顶栏子树也不在顶栏相关 AppModal 蒙层上时收起浮动顶栏 */
  function tryCollapseFullscreenHeaderFromPointer(
    clientX: number,
    clientY: number,
  ) {
    if (!chromeAutoHide.value || !showFullscreenHeader.value) return;
    const top = document.elementFromPoint(clientX, clientY);
    if (imeComposing || (!top && focusedTypingInFloatingChrome())) return;
    if (top && nodeIsUnderFullscreenHeaderFloat(top)) return;
    const header = fullscreenHeaderOverlayRef.value;
    if (header && top && nodeIsUnderFullscreenPanel(header, top)) return;
    collapseFullscreenHeaderAndCloseFindIfRevealed();
  }

  /** 顶缘感应区：仅负责唤起。收起由顶栏容器 @mouseleave 处理（与真实命中区域一致）。 */
  function updateFullscreenHeaderHover(ev: MouseEvent) {
    if (!chromeAutoHide.value) return;
    if (blockChromeEdgeReveal(ev)) return;
    if (deps.readerRef.value?.isFindWidgetRevealed?.()) {
      collapseFullscreenHeaderAndCloseFindIfRevealed();
      return;
    }
    if (showFullscreenHeader.value) {
      if (!hasDismissibleOverlay()) {
        tryCollapseFullscreenHeaderFromPointer(ev.clientX, ev.clientY);
      }
      return;
    }
    if (chromeEdgeRevealBlockedByOverlay()) return;

    const x = ev.clientX;
    const y = ev.clientY;
    const inRightScrollbarGutter =
      x >= window.innerWidth - FULLSCREEN_RIGHT_SCROLLBAR_GUTTER_PX;
    if (inRightScrollbarGutter) return;
    if (y <= FULLSCREEN_TOP_EDGE_PX && canShowFullscreenPanel("header")) {
      showFullscreenHeader.value = true;
    }
  }

  function onFullscreenHeaderMouseLeave(ev: MouseEvent) {
    if (!chromeAutoHide.value) return;
    if (hasDismissibleOverlay()) return;
    if (chromeCollapseBlockedByIme(ev)) return;
    const rt = ev.relatedTarget;
    if (rt instanceof Node && nodeIsUnderFullscreenHeaderFloat(rt)) return;
    const { clientX, clientY } = ev;
    requestAnimationFrame(() => {
      if (!chromeAutoHide.value || !showFullscreenHeader.value) return;
      if (hasDismissibleOverlay()) return;
      tryCollapseFullscreenHeaderFromPointer(clientX, clientY);
    });
  }

  /** 底缘感应：仅负责唤起。收起由底栏容器 @mouseleave 处理。 */
  function updateFullscreenFooterHover(ev: MouseEvent) {
    if (!chromeAutoHide.value) return;
    if (blockChromeEdgeReveal(ev)) return;
    if (showFullscreenFooter.value) {
      if (!hasDismissibleOverlay()) {
        tryCollapseFullscreenFooterFromPointer(ev.clientX, ev.clientY);
      }
      return;
    }
    if (chromeEdgeRevealBlockedByOverlay()) return;
    const vh = window.innerHeight;
    const y = ev.clientY;
    const inRightScrollbarGutter =
      ev.clientX >= window.innerWidth - FULLSCREEN_RIGHT_SCROLLBAR_GUTTER_PX;
    if (inRightScrollbarGutter) return;
    if (y >= vh - FULLSCREEN_BOTTOM_EDGE_PX && canShowFullscreenPanel("footer")) {
      showFullscreenFooter.value = true;
    }
  }

  function tryCollapseFullscreenFooterFromPointer(
    clientX: number,
    clientY: number,
  ) {
    if (!chromeAutoHide.value || !showFullscreenFooter.value) return;
    const top = document.elementFromPoint(clientX, clientY);
    if (imeComposing || (!top && focusedTypingInFloatingChrome())) return;
    const footer = fullscreenFooterOverlayRef.value;
    if (footer && top && nodeIsUnderFullscreenPanel(footer, top)) return;
    showFullscreenFooter.value = false;
  }

  function tryCollapseAllChromeFromLastPointer() {
    const x = lastFullscreenPointerClientX.value;
    const y = lastFullscreenPointerClientY.value;
    tryCollapseFullscreenHeaderFromPointer(x, y);
    tryCollapseFullscreenSidebarFromPointer(x, y);
    tryCollapseFullscreenFooterFromPointer(x, y);
  }

  watch(dismissibleOverlayDepth, (n, prev) => {
    if ((prev ?? 0) <= 0 || n > 0) return;
    if (!chromeAutoHide.value) return;
    requestAnimationFrame(() => {
      if (hasDismissibleOverlay()) return;
      tryCollapseAllChromeFromLastPointer();
    });
  });

  /** 指针离开网页视口（含快速擦过边缘移出窗口、移到系统标题栏）时收起浮层 */
  function onDocumentMouseOutWindow(ev: MouseEvent) {
    if (!chromeAutoHide.value) return;
    if (hasDismissibleOverlay()) return;
    if (resizingSidebar.value) return;
    if (ev.relatedTarget != null) return;
    if (chromeCollapseBlockedByIme(ev)) return;
    if (showFullscreenHeader.value) {
      collapseFullscreenHeaderAndCloseFindIfRevealed();
    }
    showFullscreenFooter.value = false;
    showFullscreenSidebar.value = false;
  }

  function onFullscreenFooterMouseLeave(ev: MouseEvent) {
    if (!chromeAutoHide.value) return;
    if (hasDismissibleOverlay()) return;
    if (chromeCollapseBlockedByIme(ev)) return;
    showFullscreenFooter.value = false;
  }

  /**
   * chrome 自动隐藏时在 `.layout` 上按下指针时收起浮动顶栏/底栏/侧栏。
   * 须在捕获阶段调用：点击模式会在阅读区捕获里截断冒泡，冒泡到 `.layout` 收不到。
   * 顶栏、底栏不在 layout 子树内，能收到该事件即表示未点在栏上；
   * 侧栏在 layout 内，若当前侧栏展开且点在侧栏面板上则不收起（避免误关）。
   * 若实际收起了面板，则本轮点击模式松开不翻页（与弹层开着时一致，拖动仍可滚）。
   */
  function dismissFullscreenPanelsOnLayoutPointerDown(ev: MouseEvent) {
    if (!chromeAutoHide.value) return;
    const raw = ev.target;
    if (!(raw instanceof Node)) return;
    const sidebar = fullscreenSidebarOverlayRef.value;
    if (
      showFullscreenSidebar.value &&
      sidebar &&
      (nodeIsUnderFullscreenPanel(sidebar, raw) ||
        nodeIsUnderFullscreenSidebarFloat(raw))
    ) {
      return;
    }
    const hadChrome =
      showFullscreenHeader.value ||
      showFullscreenFooter.value ||
      showFullscreenSidebar.value;
    if (showFullscreenHeader.value) {
      collapseFullscreenHeaderAndCloseFindIfRevealed();
    }
    showFullscreenFooter.value = false;
    showFullscreenSidebar.value = false;
    if (hadChrome) {
      deps.readerRef.value?.armClickModePageSkip?.();
    }
  }

  let exitFullscreenEscTimer: ReturnType<typeof setTimeout> | null = null;

  function hideFullscreenTip() {
    showFullscreenTip.value = false;
    fullscreenTipFading.value = false;
    clearFullscreenTipTimers();
  }

  function clearExitFullscreenEscArm() {
    const wasArmed = exitFullscreenEscArmed;
    exitFullscreenEscArmed = false;
    if (exitFullscreenEscTimer) {
      clearTimeout(exitFullscreenEscTimer);
      exitFullscreenEscTimer = null;
    }
    if (wasArmed) hideFullscreenTip();
  }

  function armExitFullscreenEsc() {
    exitFullscreenEscArmed = true;
    if (exitFullscreenEscTimer) clearTimeout(exitFullscreenEscTimer);
    exitFullscreenEscTimer = setTimeout(() => {
      exitFullscreenEscArmed = false;
      exitFullscreenEscTimer = null;
    }, EXIT_FULLSCREEN_ESC_CONFIRM_MS);

    fullscreenTipText.value = FULLSCREEN_TIP_CONFIRM_MSG;
    showFullscreenTip.value = true;
    fullscreenTipFading.value = false;
    armFullscreenTipHideTimers(EXIT_FULLSCREEN_ESC_CONFIRM_MS);
  }

  /** 主进程通知退出全屏时，与 enterOrExitFullscreenView 的提示计时器对齐清理 */
  function dismissFullscreenChromeForNativeExit() {
    showFullscreenTip.value = false;
    fullscreenTipFading.value = false;
    if (showFullscreenHeader.value) {
      collapseFullscreenHeaderAndCloseFindIfRevealed();
    }
    showFullscreenFooter.value = false;
    showFullscreenSidebar.value = false;
    clearFullscreenTipTimers();
    clearExitFullscreenEscArm();
  }

  function hasFloatingChromePanel(): boolean {
    return (
      showFullscreenHeader.value ||
      showFullscreenFooter.value ||
      showFullscreenSidebar.value
    );
  }

  function collapseFloatingChromePanels(): boolean {
    if (!hasFloatingChromePanel()) return false;
    if (showFullscreenHeader.value) {
      collapseFullscreenHeaderAndCloseFindIfRevealed();
    }
    showFullscreenFooter.value = false;
    showFullscreenSidebar.value = false;
    return true;
  }

  function escapeTargetIsFileRename(ev: KeyboardEvent): boolean {
    const target = ev.target;
    return (
      target instanceof HTMLElement &&
      target.classList.contains("fileItemRenameInput")
    );
  }

  /** 焦点在阅读器 Monaco 内，且不在查找栏（补全等仍需 Esc） */
  function escapeTargetInReaderMonaco(ev: KeyboardEvent): boolean {
    const t = ev.target;
    if (!(t instanceof Node)) return false;
    const root = deps.readerRef.value?.getReaderEditorDomNode?.() ?? null;
    if (!root || !root.contains(t)) return false;
    if (t instanceof Element && t.closest(".find-widget")) return false;
    return true;
  }

  function isReaderEditModeActive(): boolean {
    const root = deps.readerRef.value?.getReaderEditorDomNode?.() ?? null;
    return Boolean(
      root instanceof Element && root.closest(".content--readerEdit"),
    );
  }

  /**
   * 极简 / 全屏 Esc：蒙版与弹出菜单交给各自监听；查找栏 → 浮动顶/底/侧栏 →
   * 全屏再连按两次退出。Esc 不退出极简。输入框失焦由 `escapeBlurTextField` 全局捕获。
   * 按住不放的 repeat 不计第二次。
   * @returns 已消费该次 Esc
   */
  function handleReaderChromeEscape(ev: KeyboardEvent): boolean {
    if (ev.key !== "Escape") return false;
    if (escapeTargetIsFileRename(ev)) return false;

    const consume = () => {
      ev.preventDefault();
      ev.stopPropagation();
      return true;
    };

    if (!chromeAutoHide.value) return false;
    if (chromeEdgeRevealBlockedByOverlay()) return false;
    if (hasDismissibleOverlay()) return false;
    const findOpen = Boolean(deps.readerRef.value?.isFindWidgetRevealed?.());
    if (
      isReaderEditModeActive() &&
      !findOpen &&
      escapeTargetInReaderMonaco(ev)
    ) {
      return false;
    }

    if (ev.repeat) {
      if (findOpen || hasFloatingChromePanel() || isFullscreenView.value) {
        return consume();
      }
      return false;
    }

    if (findOpen) {
      deps.readerRef.value?.closeFindWidgetIfRevealed?.();
      clearExitFullscreenEscArm();
      return consume();
    }

    if (collapseFloatingChromePanels()) {
      clearExitFullscreenEscArm();
      return consume();
    }

    if (!isFullscreenView.value) return false;

    if (!exitFullscreenEscArmed) {
      armExitFullscreenEsc();
      return consume();
    }
    clearExitFullscreenEscArm();
    void window.colorTxt.setFullscreen(false).catch(() => {});
    return consume();
  }

  watch(dismissibleOverlayDepth, (n) => {
    if (n > 0) clearExitFullscreenEscArm();
  });

  watch(
    () => appLoadingModel.open,
    (open) => {
      if (open) {
        collapseAllChromeForBlockingOverlay();
        clearExitFullscreenEscArm();
      }
    },
  );

  onMounted(() => {
    overlayBaselineDepth = getModalStackDepth();
    unsubModalStack = subscribeModalStackChange(() => {
      if (chromeEdgeRevealBlockedByOverlay()) {
        collapseAllChromeForBlockingOverlay();
        clearExitFullscreenEscArm();
      }
    });
    document.addEventListener("mouseout", onDocumentMouseOutWindow);
    document.addEventListener("compositionstart", onImeCompositionStart, true);
    document.addEventListener("compositionend", onImeCompositionEnd, true);
  });

  onBeforeUnmount(() => {
    unsubModalStack?.();
    unsubModalStack = null;
    document.removeEventListener("mouseout", onDocumentMouseOutWindow);
    document.removeEventListener(
      "compositionstart",
      onImeCompositionStart,
      true,
    );
    document.removeEventListener("compositionend", onImeCompositionEnd, true);
    clearFullscreenTipTimers();
    clearFullscreenCursorHideTimer();
    clearExitFullscreenEscArm();
  });

  return {
    isFullscreenView,
    isMinimalistView,
    chromeAutoHide,
    toggleMinimalistView,
    showFullscreenTip,
    fullscreenTipFading,
    fullscreenTipText,
    showFullscreenHeader,
    fullscreenHeaderOverlayRef,
    showFullscreenFooter,
    fullscreenFooterOverlayRef,
    showFullscreenSidebar,
    fullscreenSidebarOverlayRef,
    sidebarWidth,
    fullscreenSidebarWidth,
    sidebarWidthForLayout,
    resizingSidebar,
    endSidebarResize,
    enterOrExitFullscreenView,
    getSidebarMaxWidth,
    getSidebarMinWidth,
    clampSidebarWidthToViewport,
    startResizeSidebar,
    updateFullscreenSidebarHover,
    onFullscreenSidebarMouseLeave,
    updateFullscreenHeaderHover,
    onFullscreenHeaderMouseLeave,
    updateFullscreenFooterHover,
    onFullscreenFooterMouseLeave,
    dismissFullscreenPanelsOnLayoutPointerDown,
    dismissFullscreenChromeForNativeExit,
    handleReaderChromeEscape,
    revealFullscreenSidebar,
    fullscreenCursorHidden,
    bumpFullscreenCursorIdle,
    recordFullscreenPointer,
  };
}
