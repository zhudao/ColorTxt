<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Chapter } from "./chapter";
import { pickActiveChapterIdx } from "./reader/chapterIndex";
import { minFontSize, maxFontSize } from "./constants/appUi";
import { clampTimedScrollIntervalMs } from "./constants/timedScroll";
import LoadingDotsBounce from "./components/LoadingDotsBounce.vue";
import {
  buildLineStarts,
  findPrevPageStart,
  fitPageEnd,
  lineToOffset,
  offsetToLine,
} from "./utils/stealthPaginate";
import {
  STEALTH_SETTINGS_KEY,
  clampStealthLineHeight,
  hexToRgbaCss,
  isStealthTerminalFont,
  lineHeightMultipleStep,
  loadStealthReaderSettings,
  resolveStealthFontFamilyCss,
  saveStealthReaderSettings,
  type StealthReaderSettings,
} from "./utils/stealthReaderSettings";
import type {
  StealthBounds,
  StealthCommand,
  StealthHoverCursor,
  StealthPagePayload,
} from "@shared/stealthReaderIpc";
import { whenSystemFontFacesReady } from "./utils/systemFontCatalog";

const PAD_PX = 2;
const DRAG_THRESH_PX = 6;

const pageEl = ref<HTMLElement | null>(null);
const rootEl = ref<HTMLElement | null>(null);

const settings = ref<StealthReaderSettings>(loadStealthReaderSettings());
/** 主进程解析到的终端默认族名；选「终端默认」时展开为 CSS。 */
const terminalFace = ref<string | null>(null);
const renderFontFamily = computed(() =>
  resolveStealthFontFamilyCss(settings.value.fontFamily, terminalFace.value),
);
const hovered = ref(false);
const menuOpen = ref(false);
/** 右键菜单刚关闭时，吞掉用于点空白收起菜单的那次单击翻页 */
let suppressPageFlipAfterMenu = false;
let suppressPageFlipAfterMenuTimer: ReturnType<typeof setTimeout> | undefined;
const pageText = ref("");
/** 源窗换章请求中（未缓存章可能较慢） */
const chapterLoading = ref(false);
/** 打开后显示左右点按翻页提示层；点击后关闭 */
const showPageTapHint = ref(true);

let text = "";
let lineStarts: number[] = [0];
let chapters: Chapter[] = [];
/** 源窗告知的邻章能力；null=未提供（整书本地 TOC 不请求源窗） */
let ownerHasPrevChapter: boolean | null = null;
let ownerHasNextChapter: boolean | null = null;
let pageStart = 0;
let pageEnd = 0;
/** 已翻过的页 [start, end)，弹栈上一页无需再量高 */
const pageStack: Array<{ start: number; end: number }> = [];
let lastPageChars = 400;
/** 下一页 end 预取；有则下一页只改切片 */
let prefetchNextEnd: number | null = null;
let prefetchRaf = 0;
let relayoutTimer: ReturnType<typeof setTimeout> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let unsubscribers: Array<() => void> = [];
let lastBounds: StealthBounds = settings.value.bounds ?? {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
};
let measureEl: HTMLDivElement | null = null;
let pageFlipQueued = 0;
let pageFlipRaf = 0;
let lineScrollQueued = 0;
let lineScrollRaf = 0;
const timedScrollActive = ref(false);
let timedScrollTimer: ReturnType<typeof setInterval> | null = null;

const contentVisible = computed(
  () =>
    !settings.value.hideOnMouseLeave || hovered.value || menuOpen.value,
);

const textColorCss = computed(() => {
  const alpha = contentVisible.value ? settings.value.fontOpacity : 0;
  return hexToRgbaCss(settings.value.color, alpha);
});

const paintBgCss = computed(() => {
  if (!contentVisible.value) return "transparent";
  const a = settings.value.bgOpacity;
  if (a <= 0) return "transparent";
  return hexToRgbaCss(settings.value.bgColor, a);
});

const lineHeightCss = computed(() => String(settings.value.lineHeight));
const fontWeightCss = computed(() =>
  settings.value.fontBold ? "bold" : "normal",
);
const fontStyleCss = computed(() =>
  settings.value.fontItalic ? "italic" : "normal",
);

function endPageTapHint(): void {
  if (!showPageTapHint.value) return;
  showPageTapHint.value = false;
  // 提示层略不透明，结束后带微移重申透明
  requestRefreshTransparency(true);
}

function requestRefreshTransparency(nudge = false): void {
  window.colorTxt.stealthReaderRefreshTransparency(nudge);
}

function onRootPointerEnter(): void {
  hovered.value = true;
  // 拖/缩放中不要刷透明：Win11 上易与 setPosition/setBounds 打架导致窗尺寸漂移
  if (pointerDown) return;
  // 悬停触发重绘 + 主进程重申透明，便于从 DWM 实心底恢复
  requestRefreshTransparency();
}

function onRootPointerLeave(): void {
  hovered.value = false;
  if (pointerDown) return;
  syncMacHoverCursor(null);
  requestRefreshTransparency();
}

function persistSoon(): void {
  if (persistTimer != null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    saveStealthReaderSettings(settings.value);
    window.colorTxt.stealthReaderSetNavShortcuts(settings.value.shortcuts);
  }, 200);
}

async function persistBoundsNow(): Promise<void> {
  const bounds = await window.colorTxt.stealthReaderGetBounds();
  if (!bounds) return;
  lastBounds = bounds;
  settings.value = { ...settings.value, bounds };
  saveStealthReaderSettings(settings.value);
}

function scheduleRelayout(): void {
  if (relayoutTimer != null) clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(() => {
    relayoutTimer = undefined;
    relayoutFromCurrentStart();
  }, 16);
}

function ensureMeasureEl(): HTMLDivElement {
  if (measureEl) return measureEl;
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    "visibility:hidden",
    "pointer-events:none",
    "overflow:hidden",
    "box-sizing:border-box",
    `padding:${PAD_PX}px`,
    "white-space:pre-wrap",
    "overflow-wrap:anywhere",
    "word-break:break-word",
    `line-height:${settings.value.lineHeight}`,
  ].join(";");
  document.body.appendChild(el);
  measureEl = el;
  return el;
}

function fitsSlice(slice: string): boolean {
  const page = pageEl.value;
  if (!page) return false;
  const w = page.clientWidth;
  const h = page.clientHeight;
  if (h < 2 || w < 2) return false;
  const m = ensureMeasureEl();
  m.style.width = `${w}px`;
  m.style.height = `${h}px`;
  m.style.fontFamily = renderFontFamily.value;
  m.style.fontSize = `${settings.value.fontSize}px`;
  m.style.lineHeight = String(settings.value.lineHeight);
  m.style.fontWeight = settings.value.fontBold ? "bold" : "normal";
  m.style.fontStyle = settings.value.fontItalic ? "italic" : "normal";
  m.textContent = slice;
  return m.scrollHeight <= m.clientHeight + 1;
}

/** 单视觉行（字号 × line-height + 与页相同的 padding）能否装下 slice。 */
function fitsOneVisualLine(slice: string): boolean {
  const page = pageEl.value;
  if (!page) return false;
  const w = page.clientWidth;
  if (w < 2) return false;
  const lineBox =
    Math.ceil(settings.value.fontSize * settings.value.lineHeight) +
    PAD_PX * 2;
  const m = ensureMeasureEl();
  m.style.width = `${w}px`;
  m.style.height = `${lineBox}px`;
  m.style.fontFamily = renderFontFamily.value;
  m.style.fontSize = `${settings.value.fontSize}px`;
  m.style.lineHeight = String(settings.value.lineHeight);
  m.style.fontWeight = settings.value.fontBold ? "bold" : "normal";
  m.style.fontStyle = settings.value.fontItalic ? "italic" : "normal";
  m.textContent = slice;
  return m.scrollHeight <= m.clientHeight + 1;
}

function clearPageCache(): void {
  pageStack.length = 0;
  prefetchNextEnd = null;
  if (prefetchRaf) {
    cancelAnimationFrame(prefetchRaf);
    prefetchRaf = 0;
  }
}

function schedulePrefetchNext(): void {
  if (prefetchRaf) cancelAnimationFrame(prefetchRaf);
  prefetchNextEnd = null;
  if (pageEnd >= text.length) return;
  const from = pageEnd;
  const hint = lastPageChars;
  prefetchRaf = requestAnimationFrame(() => {
    prefetchRaf = 0;
    if (from !== pageEnd || from >= text.length) return;
    prefetchNextEnd = fitPageEnd(text, from, fitsSlice, hint);
  });
}

function applyPageSlice(prefetch = true): void {
  pageText.value = text.slice(pageStart, pageEnd);
  lastPageChars = Math.max(1, pageEnd - pageStart);
  if (prefetch) schedulePrefetchNext();
}

function relayoutFromCurrentStart(): void {
  const el = pageEl.value;
  if (!text || !el || el.clientHeight < 2) return;
  clearPageCache();
  pageEnd = fitPageEnd(text, pageStart, fitsSlice, lastPageChars);
  applyPageSlice();
}

function goToOffset(nextStart: number): void {
  clearPageCache();
  pageStart = Math.max(0, Math.min(text.length, nextStart));
  pageEnd = fitPageEnd(text, pageStart, fitsSlice, lastPageChars);
  applyPageSlice();
}

function turnNext(paint = true): boolean {
  if (pageEnd >= text.length) return false;
  pageStack.push({ start: pageStart, end: pageEnd });
  pageStart = pageEnd;
  if (prefetchNextEnd != null && prefetchNextEnd > pageStart) {
    pageEnd = prefetchNextEnd;
    prefetchNextEnd = null;
  } else {
    pageEnd = fitPageEnd(text, pageStart, fitsSlice, lastPageChars);
  }
  if (paint) applyPageSlice();
  return true;
}

function turnPrev(paint = true): boolean {
  if (pageStart <= 0) return false;
  const snapped = pageStack.pop();
  if (snapped != null && snapped.start < pageStart) {
    pageStart = snapped.start;
    pageEnd = snapped.end;
  } else {
    pageStart = findPrevPageStart(text, pageStart, fitsSlice, lastPageChars);
    pageEnd = fitPageEnd(text, pageStart, fitsSlice, lastPageChars);
  }
  if (paint) applyPageSlice();
  return true;
}

/** 连点合并到下一帧；单帧最多翻 12 页。贴边再翻则切章（本地标记或源窗）。 */
function requestPageFlip(delta: number): void {
  nudgeTimedScrollTimer();
  pageFlipQueued += delta;
  if (pageFlipRaf) return;
  const flush = (): void => {
    pageFlipRaf = 0;
    if (pageFlipQueued === 0) return;
    const batch = Math.max(-12, Math.min(12, pageFlipQueued));
    pageFlipQueued -= batch;
    let moved = false;
    if (batch > 0) {
      let steps = batch;
      while (steps > 0 && turnNext(false)) {
        moved = true;
        steps -= 1;
      }
      if (!moved) chapterNext();
    } else if (batch < 0) {
      let steps = -batch;
      while (steps > 0 && turnPrev(false)) {
        moved = true;
        steps -= 1;
      }
      if (!moved) chapterPrev("end");
    }
    if (moved) applyPageSlice();
    if (pageFlipQueued !== 0) {
      pageFlipRaf = requestAnimationFrame(flush);
    }
  };
  pageFlipRaf = requestAnimationFrame(flush);
}

/** 按视觉行滚动（换行后的显示行，非逻辑 \\n 行）。 */
function scrollByVisualLines(steps: number): void {
  if (steps === 0 || !text) return;
  clearPageCache();
  if (steps > 0) {
    let n = steps;
    while (n > 0 && pageStart < text.length) {
      const next = fitPageEnd(text, pageStart, fitsOneVisualLine, 128);
      pageStart =
        next > pageStart ? next : Math.min(text.length, pageStart + 1);
      n -= 1;
    }
  } else {
    let n = -steps;
    while (n > 0 && pageStart > 0) {
      const prev = findPrevPageStart(
        text,
        pageStart,
        fitsOneVisualLine,
        128,
      );
      if (prev >= pageStart) break;
      pageStart = prev;
      n -= 1;
    }
  }
  pageEnd = fitPageEnd(text, pageStart, fitsSlice, lastPageChars);
  applyPageSlice();
}

function requestLineScroll(dir: number): void {
  if (dir === 0) return;
  nudgeTimedScrollTimer();
  // 已在文末/文首再滚：切章（对齐找书阅读器贴边再滚）
  if (dir > 0 && pageEnd >= text.length) {
    chapterNext();
    return;
  }
  if (dir < 0 && pageStart <= 0) {
    chapterPrev("end");
    return;
  }
  lineScrollQueued += dir > 0 ? 1 : -1;
  if (lineScrollRaf) return;
  lineScrollRaf = requestAnimationFrame(() => {
    lineScrollRaf = 0;
    const n = Math.max(-8, Math.min(8, lineScrollQueued));
    lineScrollQueued = 0;
    if (n === 0) return;
    if (n > 0 && pageEnd >= text.length) {
      chapterNext();
      return;
    }
    if (n < 0 && pageStart <= 0) {
      chapterPrev("end");
      return;
    }
    const before = pageStart;
    scrollByVisualLines(n);
    if (n > 0 && pageStart === before && pageEnd >= text.length) {
      chapterNext();
    } else if (n < 0 && pageStart === before && pageStart <= 0) {
      chapterPrev("end");
    }
  });
}

function currentLine(): number {
  return offsetToLine(lineStarts, pageStart);
}

function goToLine(lineNumber: number): void {
  goToOffset(lineToOffset(lineStarts, lineNumber));
}

let ownerChapterNavPending = false;
let ownerChapterNavTimer: ReturnType<typeof setTimeout> | undefined;

function clearOwnerChapterNavPending(): void {
  ownerChapterNavPending = false;
  chapterLoading.value = false;
  if (ownerChapterNavTimer != null) {
    clearTimeout(ownerChapterNavTimer);
    ownerChapterNavTimer = undefined;
  }
}

function requestOwnerChapterNav(
  direction: "prev" | "next",
  anchor: "start" | "end" = "start",
): void {
  if (ownerChapterNavPending) return;
  ownerChapterNavPending = true;
  chapterLoading.value = true;
  if (ownerChapterNavTimer != null) clearTimeout(ownerChapterNavTimer);
  // 源窗忽略（无邻章）或加载失败时勿永久锁死
  ownerChapterNavTimer = setTimeout(() => {
    ownerChapterNavPending = false;
    chapterLoading.value = false;
    ownerChapterNavTimer = undefined;
  }, 15000);
  window.colorTxt.stealthReaderOwnerChapterNav(direction, anchor);
}

/** @param anchor end 仅贴边上滚/翻页切上一章；快捷键保持章首 */
function chapterPrev(anchor: "start" | "end" = "start"): void {
  nudgeTimedScrollTimer();
  if (chapters.length > 1) {
    const idx = pickActiveChapterIdx(chapters, currentLine());
    if (idx > 0) {
      goToLine(chapters[idx - 1]!.lineNumber);
    }
    return;
  }
  const idx =
    chapters.length === 0
      ? -1
      : pickActiveChapterIdx(chapters, currentLine());
  if (idx > 0) {
    goToLine(chapters[idx - 1]!.lineNumber);
    return;
  }
  if (ownerHasPrevChapter === true) {
    requestOwnerChapterNav("prev", anchor);
  }
}

function chapterNext(): void {
  nudgeTimedScrollTimer();
  if (chapters.length > 1) {
    const idx = pickActiveChapterIdx(chapters, currentLine());
    if (idx === -1) {
      goToLine(chapters[0]!.lineNumber);
      return;
    }
    if (idx + 1 < chapters.length) {
      goToLine(chapters[idx + 1]!.lineNumber);
    }
    return;
  }
  const idx =
    chapters.length === 0
      ? -1
      : pickActiveChapterIdx(chapters, currentLine());
  if (idx === -1 && chapters.length > 0) {
    goToLine(chapters[0]!.lineNumber);
    return;
  }
  if (idx >= 0 && idx + 1 < chapters.length) {
    goToLine(chapters[idx + 1]!.lineNumber);
    return;
  }
  if (ownerHasNextChapter === true) {
    requestOwnerChapterNav("next");
  }
}

function canAdvanceNextChapter(): boolean {
  if (chapters.length > 1) {
    const idx = pickActiveChapterIdx(chapters, currentLine());
    if (idx === -1) return chapters.length > 0;
    return idx + 1 < chapters.length;
  }
  const idx =
    chapters.length === 0
      ? -1
      : pickActiveChapterIdx(chapters, currentLine());
  if (idx === -1 && chapters.length > 0) return true;
  if (idx >= 0 && idx + 1 < chapters.length) return true;
  return ownerHasNextChapter === true;
}

function isAtLastPage(): boolean {
  return !text || pageEnd >= text.length;
}

function clearTimedScrollTimer(): void {
  if (timedScrollTimer != null) {
    clearInterval(timedScrollTimer);
    timedScrollTimer = null;
  }
}

function stopTimedScroll(): void {
  timedScrollActive.value = false;
  clearTimedScrollTimer();
}

function startTimedScrollTimer(): void {
  clearTimedScrollTimer();
  const ms = clampTimedScrollIntervalMs(settings.value.timedScroll.intervalMs);
  timedScrollTimer = setInterval(timedScrollTick, ms);
}

/** 手动/自动翻页滚行后重新计满间隔，避免刚操作完立刻再翻。 */
function nudgeTimedScrollTimer(): void {
  if (!timedScrollActive.value || chapterLoading.value) return;
  startTimedScrollTimer();
}

function timedScrollTick(): void {
  if (!timedScrollActive.value) return;
  if (chapterLoading.value) return;
  if (isAtLastPage() && !canAdvanceNextChapter()) {
    stopTimedScroll();
    return;
  }
  if (settings.value.timedScroll.range === "line") {
    requestLineScroll(1);
  } else {
    requestPageFlip(1);
  }
}

function startTimedScroll(): void {
  if (!text || (isAtLastPage() && !canAdvanceNextChapter())) return;
  timedScrollActive.value = true;
  startTimedScrollTimer();
}

function toggleTimedScroll(): void {
  if (timedScrollActive.value) stopTimedScroll();
  else startTimedScroll();
}

function bumpFontSize(delta: number): void {
  const next = Math.min(
    maxFontSize,
    Math.max(minFontSize, settings.value.fontSize + delta),
  );
  if (next === settings.value.fontSize) return;
  settings.value = { ...settings.value, fontSize: next };
  persistSoon();
  void nextTick(() => {
    updateMinSize();
    relayoutFromCurrentStart();
  });
}

function bumpLineHeight(delta: number): void {
  const next = clampStealthLineHeight(
    settings.value.lineHeight + delta * lineHeightMultipleStep,
  );
  if (next === settings.value.lineHeight) return;
  settings.value = { ...settings.value, lineHeight: next };
  persistSoon();
  void nextTick(() => {
    updateMinSize();
    relayoutFromCurrentStart();
  });
}

function bumpOpacity(delta: number): void {
  const next = Math.min(
    1,
    Math.max(0, Math.round((settings.value.bgOpacity + delta) * 100) / 100),
  );
  if (next === settings.value.bgOpacity) return;
  settings.value = { ...settings.value, bgOpacity: next };
  persistSoon();
}

function bumpFontOpacity(delta: number): void {
  const next = Math.min(
    1,
    Math.max(0, Math.round((settings.value.fontOpacity + delta) * 100) / 100),
  );
  if (next === settings.value.fontOpacity) return;
  settings.value = { ...settings.value, fontOpacity: next };
  persistSoon();
}

async function refreshTerminalFace(): Promise<void> {
  try {
    const face = await window.colorTxt.getTerminalDefaultFontFace();
    terminalFace.value =
      typeof face === "string" && face.trim() ? face.trim() : null;
  } catch {
    terminalFace.value = null;
  }
}

function applySettingsFromStorage(relayout: boolean): void {
  const prev = settings.value;
  const next = loadStealthReaderSettings();
  settings.value = {
    ...next,
    bounds: prev.bounds ?? next.bounds,
  };
  window.colorTxt.stealthReaderSetNavShortcuts(settings.value.shortcuts);
  void (async () => {
    if (isStealthTerminalFont(settings.value.fontFamily)) {
      await refreshTerminalFace();
    }
    if (
      relayout &&
      (prev.fontFamily !== settings.value.fontFamily ||
        prev.fontSize !== settings.value.fontSize ||
        prev.lineHeight !== settings.value.lineHeight ||
        prev.fontBold !== settings.value.fontBold ||
        prev.fontItalic !== settings.value.fontItalic)
    ) {
      updateMinSize();
      relayoutFromCurrentStart();
    }
  })();
}

function onSettingsStorage(ev: StorageEvent): void {
  if (ev.key !== STEALTH_SETTINGS_KEY) return;
  applySettingsFromStorage(true);
}

function updateMinSize(): void {
  const probe = document.createElement("span");
  probe.textContent = "汉";
  probe.style.cssText = [
    "position:absolute",
    "left:-9999px",
    "top:0",
    "visibility:hidden",
    `font-family:${renderFontFamily.value}`,
    `font-size:${settings.value.fontSize}px`,
    `line-height:${settings.value.lineHeight}`,
    `font-weight:${settings.value.fontBold ? "bold" : "normal"}`,
    `font-style:${settings.value.fontItalic ? "italic" : "normal"}`,
    "white-space:nowrap",
  ].join(";");
  document.body.appendChild(probe);
  const w = Math.max(
    1,
    Math.ceil(probe.getBoundingClientRect().width) + PAD_PX * 2,
  );
  probe.remove();
  // 高度与 fitsOneVisualLine 一致，避免 span 量高偏小导致可缩到「一行字装不下」
  const h = Math.max(
    1,
    Math.ceil(settings.value.fontSize * settings.value.lineHeight) +
      PAD_PX * 2,
  );
  minWinW = w;
  minWinH = h;
  window.colorTxt.stealthReaderSetMinSize(w, h);
  // 主进程可能已把窗撑大，必须同步 lastBounds，否则下次缩放仍按旧高度跳回去
  void syncLastBoundsFromWindow();
}

async function syncLastBoundsFromWindow(): Promise<void> {
  const bounds = await window.colorTxt.stealthReaderGetBounds();
  if (!bounds) return;
  const prev = lastBounds;
  lastBounds = bounds;
  syncRootBoxToBounds(bounds);
  if (
    prev.width !== bounds.width ||
    prev.height !== bounds.height ||
    prev.x !== bounds.x ||
    prev.y !== bounds.y
  ) {
    settings.value = { ...settings.value, bounds };
    saveStealthReaderSettings(settings.value);
  }
}

/** Windows OS 可能把窗撑得比逻辑尺寸高；根节点按逻辑宽高排版，下方透明区靠 setShape 点穿。 */
function syncRootBoxToBounds(bounds: StealthBounds): void {
  const root = rootEl.value;
  if (!root) return;
  const w = Math.max(1, Math.round(bounds.width));
  const h = Math.max(1, Math.round(bounds.height));
  root.style.width = `${w}px`;
  root.style.height = `${h}px`;
}

function onContextMenu(ev: MouseEvent): void {
  ev.preventDefault();
  window.colorTxt.stealthReaderPopupMenu({
    timedScrollActive: timedScrollActive.value,
  });
}

function exitStealth(): void {
  saveStealthReaderSettings(settings.value);
  void persistBoundsNow().finally(() => {
    window.colorTxt.stealthReaderExit(currentLine());
  });
}

function onCommand(command: StealthCommand, _extra: string): void {
  if (command === "pagePrev") requestPageFlip(-1);
  else if (command === "pageNext") requestPageFlip(1);
  else if (command === "chapterPrev") chapterPrev();
  else if (command === "chapterNext") chapterNext();
  else if (command === "exit") exitStealth();
  else if (command === "openSettings") {
    void window.colorTxt.openStealthSettingsWindow();
  } else if (command === "toggleTimedScroll") {
    toggleTimedScroll();
  } else if (command === "reloadPayload") {
    void pullAndApplyPendingPayload();
  } else if (command === "chapterNavSettled") {
    clearOwnerChapterNavPending();
  }
}

async function pullAndApplyPendingPayload(): Promise<void> {
  const payload = await window.colorTxt.stealthReaderGetPendingPayload();
  if (!payload || typeof payload.text !== "string" || !payload.text) return;
  await applyUpdatedPayload(payload);
}

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

let pointerDown = false;
let dragging = false;
let resizing: Edge | null = null;
let pointerSeq = 0;
let originScreenX = 0;
let originScreenY = 0;
let originBounds: StealthBounds = { x: 0, y: 0, width: 0, height: 0 };
let originReady = false;
/** 与 updateMinSize 一致：自定义 setBounds 缩放不走系统 min，需自己钳 */
let minWinW = 8;
let minWinH = 8;

/**
 * macOS 摸鱼窗 focusable:false，CSS `*-resize` 不会显示。
 * Windows 仍走样式表，这里只在 Mac 上补系统光标。
 */
const macHoverCursorNative =
  typeof navigator !== "undefined" &&
  (/Mac/i.test(navigator.platform) || /Macintosh/.test(navigator.userAgent));

let macHoverCursorSent: StealthHoverCursor | null = null;

function hoverCursorForEdge(edge: Edge | null): StealthHoverCursor {
  if (edge === "n" || edge === "s") return "ns";
  if (edge === "e" || edge === "w") return "ew";
  if (edge === "ne" || edge === "sw") return "nesw";
  if (edge === "nw" || edge === "se") return "nwse";
  return "arrow";
}

function syncMacHoverCursor(edge: Edge | null): void {
  if (!macHoverCursorNative) return;
  const cursor = hoverCursorForEdge(edge);
  // 箭头只在变化时发；缩放光标每次移动都重设，避免系统在非 key 窗上把它改回箭头
  if (cursor === "arrow" && macHoverCursorSent === "arrow") return;
  macHoverCursorSent = cursor;
  try {
    window.colorTxt.stealthReaderSetHoverCursor(cursor);
  } catch {
    /* 窗口正在关闭 */
  }
}

function edgeFromTarget(target: EventTarget | null): Edge | null {
  if (!(target instanceof HTMLElement)) return null;
  const edge = target.dataset.edge;
  if (
    edge === "n" ||
    edge === "s" ||
    edge === "e" ||
    edge === "w" ||
    edge === "ne" ||
    edge === "nw" ||
    edge === "se" ||
    edge === "sw"
  ) {
    return edge;
  }
  return null;
}

/** 与 getBounds 同单位的光标点；主进程不可用时回退 screenX/Y */
function readCursorDip(ev?: PointerEvent): { x: number; y: number } {
  try {
    const p = window.colorTxt.stealthReaderGetCursorScreenPoint();
    if (
      p &&
      typeof p.x === "number" &&
      typeof p.y === "number" &&
      Number.isFinite(p.x) &&
      Number.isFinite(p.y)
    ) {
      return p;
    }
  } catch {
    /* 沙箱/旧 preload */
  }
  if (ev) return { x: ev.screenX, y: ev.screenY };
  return { x: originScreenX, y: originScreenY };
}

function onPointerDown(ev: PointerEvent): void {
  if (ev.button !== 0) return;
  ev.preventDefault();
  window.getSelection()?.removeAllRanges();
  if (ev.detail > 1) return;
  pointerSeq += 1;
  const seq = pointerSeq;
  pointerDown = true;
  dragging = false;
  resizing = edgeFromTarget(ev.target);
  // 缩放前刷新最小尺寸，避免仍是初始 8px
  if (resizing) updateMinSize();
  const cursor = readCursorDip(ev);
  originScreenX = cursor.x;
  originScreenY = cursor.y;
  // 等主进程真实 bounds，避免字号撑高后仍用旧 lastBounds 起算
  originReady = false;
  try {
    rootEl.value?.setPointerCapture?.(ev.pointerId);
  } catch {
    /* ignore */
  }
  void window.colorTxt.stealthReaderGetBounds().then((bounds) => {
    if (seq !== pointerSeq || !pointerDown || !bounds) return;
    lastBounds = bounds;
    originBounds = { ...bounds };
    // 对齐「可开始拖」时刻的光标，避免 IPC 等待期间的位移被算进 delta
    const c = readCursorDip();
    originScreenX = c.x;
    originScreenY = c.y;
    originReady = true;
  });
}

function applyResize(ev: PointerEvent): void {
  if (!resizing) return;
  const cursor = readCursorDip(ev);
  const dx = cursor.x - originScreenX;
  const dy = cursor.y - originScreenY;
  let { x, y, width, height } = originBounds;
  const e = resizing;
  if (e.includes("e")) width = originBounds.width + dx;
  if (e.includes("s")) height = originBounds.height + dy;
  if (e.includes("w")) {
    x = originBounds.x + dx;
    width = originBounds.width - dx;
  }
  if (e.includes("n")) {
    y = originBounds.y + dy;
    height = originBounds.height - dy;
  }
  // 四角/边缘都走 setBounds，系统 setMinimumSize 不可靠；按字号最小尺寸钳住，并固定对边
  if (width < minWinW) {
    if (e.includes("w")) x = originBounds.x + originBounds.width - minWinW;
    width = minWinW;
  }
  if (height < minWinH) {
    if (e.includes("n")) y = originBounds.y + originBounds.height - minWinH;
    height = minWinH;
  }
  lastBounds = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
  syncRootBoxToBounds(lastBounds);
  window.colorTxt.stealthReaderSetBounds(lastBounds);
}

function finishPointer(ev: PointerEvent, commitClick: boolean): void {
  if (!pointerDown) return;
  pointerSeq += 1;
  pointerDown = false;
  originReady = false;
  const wasResize = resizing != null;
  const wasDrag = dragging;
  resizing = null;
  dragging = false;
  try {
    rootEl.value?.releasePointerCapture?.(ev.pointerId);
  } catch {
    /* ignore */
  }
  if (wasResize || wasDrag) {
    void persistBoundsNow();
    if (wasResize) {
      scheduleRelayout();
    }
    return;
  }
  if (!commitClick || ev.detail > 1) return;
  if (suppressPageFlipAfterMenu) {
    suppressPageFlipAfterMenu = false;
    if (suppressPageFlipAfterMenuTimer != null) {
      clearTimeout(suppressPageFlipAfterMenuTimer);
      suppressPageFlipAfterMenuTimer = undefined;
    }
    return;
  }
  if (showPageTapHint.value) {
    endPageTapHint();
    return;
  }
  const el = rootEl.value;
  if (!el) return;
  if (ev.clientX >= el.clientWidth / 2) requestPageFlip(1);
  else requestPageFlip(-1);
}

function onPointerMove(ev: PointerEvent): void {
  syncMacHoverCursor(resizing ?? edgeFromTarget(ev.target));
  if (!pointerDown) return;
  if ((ev.buttons & 1) === 0) {
    finishPointer(ev, false);
    return;
  }
  if (!originReady) return;
  if (resizing) {
    applyResize(ev);
    return;
  }
  const cursor = readCursorDip(ev);
  const dx = cursor.x - originScreenX;
  const dy = cursor.y - originScreenY;
  if (!dragging && dx * dx + dy * dy >= DRAG_THRESH_PX * DRAG_THRESH_PX) {
    dragging = true;
  }
  if (dragging) {
    const x = originBounds.x + dx;
    const y = originBounds.y + dy;
    // 移动也带上宽高走 setBounds：避免 Win11 上 setPosition 让 HWND 尺寸漂移
    lastBounds = {
      ...lastBounds,
      x: Math.round(x),
      y: Math.round(y),
      width: originBounds.width,
      height: originBounds.height,
    };
    window.colorTxt.stealthReaderSetBounds(lastBounds);
  }
}

function onPointerUp(ev: PointerEvent): void {
  if (ev.button !== 0) return;
  finishPointer(ev, true);
  syncMacHoverCursor(edgeFromTarget(ev.target));
}

function onPointerCancel(ev: PointerEvent): void {
  finishPointer(ev, false);
  syncMacHoverCursor(null);
}

function onWheel(ev: WheelEvent): void {
  if ((ev.ctrlKey || ev.metaKey) && ev.altKey) {
    ev.preventDefault();
    bumpLineHeight(ev.deltaY < 0 ? 1 : -1);
    return;
  }
  if (ev.ctrlKey || ev.metaKey) {
    ev.preventDefault();
    bumpFontSize(ev.deltaY < 0 ? 1 : -1);
    return;
  }
  if (ev.altKey) {
    ev.preventDefault();
    bumpOpacity(ev.deltaY < 0 ? 0.05 : -0.05);
    return;
  }
  if (ev.shiftKey) {
    ev.preventDefault();
    // Windows 上 Shift+滚轮常变成 deltaX
    const delta = ev.deltaY !== 0 ? ev.deltaY : ev.deltaX;
    if (delta === 0) return;
    bumpFontOpacity(delta < 0 ? 0.05 : -0.05);
    return;
  }
  if (!hovered.value) return;
  if (ev.deltaY === 0) return;
  ev.preventDefault();
  requestLineScroll(ev.deltaY > 0 ? 1 : -1);
}

async function boot(payload: StealthPagePayload): Promise<void> {
  applyPagePayload(payload);
  const bounds = await window.colorTxt.stealthReaderGetBounds();
  if (bounds) {
    lastBounds = bounds;
    await nextTick();
    syncRootBoxToBounds(bounds);
  }
  await nextTick();
  if (isStealthTerminalFont(settings.value.fontFamily)) {
    await refreshTerminalFace();
  }
  window.colorTxt.stealthReaderSetNavShortcuts(settings.value.shortcuts);
  updateMinSize();
  if (settings.value.fontFamily.includes("KingHwa OldSong")) {
    try {
      await document.fonts.load(`${settings.value.fontSize}px "KingHwa OldSong"`);
    } catch {
      /* ignore */
    }
  }
  relayoutFromCurrentStart();
}

/** 源窗热换章：重置正文与行表，不重启点按提示层 */
function applyPagePayload(payload: StealthPagePayload): void {
  clearPageCache();
  text = payload.text;
  lineStarts = buildLineStarts(text);
  const list = Array.isArray(payload.chapters) ? payload.chapters : [];
  chapters = list.map((c) => ({
    title: c.title,
    lineNumber: Math.max(1, Math.floor(c.lineNumber) || 1),
    charCount: 0,
    tocOrder: c.tocOrder,
  }));
  ownerHasPrevChapter =
    typeof payload.hasPrevChapter === "boolean"
      ? payload.hasPrevChapter
      : null;
  ownerHasNextChapter =
    typeof payload.hasNextChapter === "boolean"
      ? payload.hasNextChapter
      : null;
  pageStart = lineToOffset(lineStarts, payload.startLine);
}

function layoutToDocumentEnd(): void {
  const el = pageEl.value;
  if (!text || !el || el.clientHeight < 2) {
    pageStart = Math.max(0, text.length - Math.max(lastPageChars, 400));
    pageEnd = text.length;
    applyPageSlice(false);
    return;
  }
  clearPageCache();
  pageStart = findPrevPageStart(text, text.length, fitsSlice, lastPageChars);
  pageEnd = fitPageEnd(text, pageStart, fitsSlice, lastPageChars);
  applyPageSlice();
}

let applyPayloadSeq = 0;

async function applyUpdatedPayload(payload: StealthPagePayload): Promise<void> {
  const seq = ++applyPayloadSeq;
  clearOwnerChapterNavPending();
  applyPagePayload(payload);
  const alignEnd = payload.anchor === "end";
  // 先立刻换页文本，避免 measure 失败时仍显示旧章
  if (alignEnd) {
    pageStart = Math.max(0, text.length - Math.max(lastPageChars, 400));
    pageEnd = text.length;
  } else {
    const hint = Math.max(lastPageChars, 400);
    pageEnd = Math.min(text.length, pageStart + hint);
    if (pageEnd <= pageStart && text.length > pageStart) {
      pageEnd = Math.min(text.length, pageStart + hint);
    }
  }
  applyPageSlice(false);
  await nextTick();
  if (seq !== applyPayloadSeq) return;
  updateMinSize();
  if (alignEnd) layoutToDocumentEnd();
  else relayoutFromCurrentStart();
}

let resizeObserver: ResizeObserver | null = null;
let lastPageBoxW = 0;
let lastPageBoxH = 0;

function onSelectStart(ev: Event): void {
  ev.preventDefault();
}

function onDoubleClick(ev: MouseEvent): void {
  ev.preventDefault();
  window.getSelection()?.removeAllRanges();
}

watch(
  () => [
    settings.value.timedScroll.range,
    settings.value.timedScroll.intervalMs,
  ],
  () => {
    if (timedScrollActive.value) startTimedScrollTimer();
  },
);

watch(chapterLoading, (loading) => {
  if (!timedScrollActive.value) return;
  if (loading) {
    clearTimedScrollTimer();
    return;
  }
  if (isAtLastPage() && !canAdvanceNextChapter()) {
    stopTimedScroll();
    return;
  }
  startTimedScrollTimer();
});

onMounted(() => {
  void whenSystemFontFacesReady().then(() => {
    updateMinSize();
    relayoutFromCurrentStart();
  });
  unsubscribers.push(
    window.colorTxt.onStealthReaderCommand((command, extra) => {
      onCommand(command, extra);
    }),
  );
  unsubscribers.push(
    window.colorTxt.onStealthReaderMenuOpen((open) => {
      menuOpen.value = open;
      if (open) return;
      // 原生菜单点窗外关闭时，同一次点击还会落到覆盖层并翻页；吞掉紧随其后的单击
      suppressPageFlipAfterMenu = true;
      if (suppressPageFlipAfterMenuTimer != null) {
        clearTimeout(suppressPageFlipAfterMenuTimer);
      }
      suppressPageFlipAfterMenuTimer = setTimeout(() => {
        suppressPageFlipAfterMenu = false;
        suppressPageFlipAfterMenuTimer = undefined;
      }, 400);
    }),
  );
  const el = pageEl.value;
  if (el && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const w = Math.round(cr.width);
      const h = Math.round(cr.height);
      if (w === lastPageBoxW && h === lastPageBoxH) return;
      lastPageBoxW = w;
      lastPageBoxH = h;
      scheduleRelayout();
    });
    resizeObserver.observe(el);
  }
  window.addEventListener("wheel", onWheel, { passive: false, capture: true });
  window.addEventListener("selectstart", onSelectStart, true);
  window.addEventListener("dblclick", onDoubleClick, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerCancel, true);
  window.addEventListener("storage", onSettingsStorage);
  void (async () => {
    const payload = await window.colorTxt.stealthReaderGetPayload();
    if (!payload || typeof payload.text !== "string") {
      window.colorTxt.stealthReaderExit(1);
      return;
    }
    await boot(payload);
  })();
});

onBeforeUnmount(() => {
  window.removeEventListener("wheel", onWheel, true);
  window.removeEventListener("selectstart", onSelectStart, true);
  window.removeEventListener("dblclick", onDoubleClick, true);
  window.removeEventListener("pointerup", onPointerUp, true);
  window.removeEventListener("pointercancel", onPointerCancel, true);
  window.removeEventListener("storage", onSettingsStorage);
  resizeObserver?.disconnect();
  if (relayoutTimer != null) clearTimeout(relayoutTimer);
  if (persistTimer != null) clearTimeout(persistTimer);
  if (suppressPageFlipAfterMenuTimer != null) {
    clearTimeout(suppressPageFlipAfterMenuTimer);
  }
  if (pageFlipRaf) cancelAnimationFrame(pageFlipRaf);
  if (lineScrollRaf) cancelAnimationFrame(lineScrollRaf);
  stopTimedScroll();
  showPageTapHint.value = false;
  clearOwnerChapterNavPending();
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  syncMacHoverCursor(null);
  clearPageCache();
  measureEl?.remove();
  measureEl = null;
  for (const off of unsubscribers) off();
});
</script>

<template>
  <div
    ref="rootEl"
    class="stealthRoot"
    :class="{
      'is-active': hovered || menuOpen,
    }"
    :style="{
      color: textColorCss,
      backgroundColor: paintBgCss,
      fontFamily: renderFontFamily,
      fontSize: `${settings.fontSize}px`,
      lineHeight: lineHeightCss,
      fontWeight: fontWeightCss,
      fontStyle: fontStyleCss,
    }"
    @pointerenter="onRootPointerEnter"
    @pointerleave="onRootPointerLeave"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @contextmenu="onContextMenu"
  >
    <div ref="pageEl" class="stealthPage">
      <span v-if="chapterLoading" class="stealthChapterLoading">
        加载中<LoadingDotsBounce />
      </span>
      <template v-else>{{ pageText }}</template>
    </div>
    <div
      v-if="showPageTapHint"
      class="stealthTapHint"
      aria-hidden="true"
    >
      <div class="stealthTapHintSide stealthTapHintSide--prev">
        <span class="stealthTapHintLabel">上一页</span>
      </div>
      <div class="stealthTapHintSide stealthTapHintSide--next">
        <span class="stealthTapHintLabel">下一页</span>
      </div>
    </div>
    <div class="edge edge--n" data-edge="n"></div>
    <div class="edge edge--s" data-edge="s"></div>
    <div class="edge edge--e" data-edge="e"></div>
    <div class="edge edge--w" data-edge="w"></div>
    <div class="edge edge--ne" data-edge="ne"></div>
    <div class="edge edge--nw" data-edge="nw"></div>
    <div class="edge edge--se" data-edge="se"></div>
    <div class="edge edge--sw" data-edge="sw"></div>
  </div>
</template>

<style>
@font-face {
  font-family: "KingHwa OldSong";
  src: url("./assets/KingHwa_OldSong_3.0.ttf") format("truetype");
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

html,
body,
#app {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  user-select: none;
  -webkit-user-select: none;
}

body {
  user-select: none;
  -webkit-user-select: none;
}

::selection {
  background: transparent;
  color: inherit;
}
</style>

<style scoped>
.stealthRoot {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
}

.stealthTapHint {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  pointer-events: none;
}

.stealthTapHintSide {
  flex: 1 1 50%;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 180, 0, 0.28);
}

.stealthTapHintSide--prev {
  border-right: 2px solid rgba(255, 255, 255, 0.85);
}

.stealthTapHintLabel {
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: 0.04em;
  white-space: nowrap;
  font-family:
    system-ui,
    -apple-system,
    "Segoe UI",
    sans-serif;
  font-style: normal;
}

.stealthPage {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 2px;
  overflow: hidden;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}

.stealthChapterLoading {
  display: inline-flex;
  align-items: center;
  gap: 0.15em;
  white-space: nowrap;
}

.edge {
  position: absolute;
  z-index: 2;
}

.edge--n,
.edge--s {
  left: 4px;
  right: 4px;
  height: 4px;
}

.edge--e,
.edge--w {
  top: 4px;
  bottom: 4px;
  width: 4px;
}

.edge--n {
  top: 0;
  cursor: ns-resize;
}
.edge--s {
  bottom: 0;
  cursor: ns-resize;
}
.edge--e {
  right: 0;
  cursor: ew-resize;
}
.edge--w {
  left: 0;
  cursor: ew-resize;
}
.edge--ne,
.edge--nw,
.edge--se,
.edge--sw {
  width: 6px;
  height: 6px;
}
.edge--ne {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}
.edge--nw {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}
.edge--se {
  bottom: 0;
  right: 0;
  cursor: nwse-resize;
}
.edge--sw {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
}
</style>
