<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { walkTree } from "markmap-common";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";
import { icons } from "../icons";
import type { Chapter } from "../chapter";
import { substituteAiChapterMarkersWithTitles } from "../utils/aiMarkdownChapterRef";

type MarkmapInst = Markmap;

interface MarkmapHandle {
  setData: (root: unknown) => Promise<void>;
  fit: (maxScale?: number) => Promise<void>;
  renderData: (originData?: unknown) => Promise<void>;
  destroy?: () => void;
  state: MarkmapInst["state"];
}

const EXPORT_SVG_WIDTH = 1200;
const EXPORT_SVG_HEIGHT = 900;

const MARKMAP_OPTIONS: Partial<MarkmapInst["options"]> = {
  /** 关闭库内自动 fit，避免 SVG 尺寸为 0 时 n/d → NaN；由 scheduleSafeFit 统一控制 */
  autoFit: false,
  fitRatio: 0.85,
  maxInitialScale: 2,
  duration: 300,
  maxWidth: 300,
  paddingX: 16,
};

const props = withDefaults(
  defineProps<{
    markdown: string;
    title?: string;
    stats?: { nodeCount: number; maxDepth: number };
    /** 侧栏缩略图：仅展示，点击放大；全屏弹层保留完整交互与工具栏 */
    preview?: boolean;
    /** 用于将正文中的 `（ch=N）` 替换为真实章节名 */
    chapters?: readonly Chapter[];
  }>(),
  { preview: true, chapters: () => [] },
);

const transformer = new Transformer();

const svgRef = ref<SVGSVGElement | null>(null);
const previewViewportRef = ref<HTMLElement | null>(null);
const fullscreenSvgRef = ref<SVGSVGElement | null>(null);
const markmapRef = ref<MarkmapHandle | null>(null);
const fullscreenMarkmapRef = ref<MarkmapHandle | null>(null);
const expanded = ref(false);

let inlineLayoutObserver: ResizeObserver | null = null;
let fullscreenLayoutObserver: ResizeObserver | null = null;
let visibilityObserver: IntersectionObserver | null = null;
let layoutDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let fitDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let readyPass = 0;
const inlineInitLock = { current: null as Promise<void> | null };
const fullscreenInitLock = { current: null as Promise<void> | null };
const lastAppliedSize = new WeakMap<SVGSVGElement, { w: number; h: number }>();

/** 内联面板视口高度（非全屏）；随侧栏宽度与导图内容自适应 */
const VIEWPORT_HEIGHT_MIN = 160;
const VIEWPORT_HEIGHT_MAX = 420;
const VIEWPORT_HEIGHT_DEFAULT = 280;
const inlineViewportHeight = ref(VIEWPORT_HEIGHT_DEFAULT);

const displayTitle = computed(() => {
  const t = (props.title ?? "").trim() || "思维导图";
  return t.length > 24 ? `${t.slice(0, 24)}…` : t;
});

const markmapMarkdown = computed(() => {
  const raw = props.markdown ?? "";
  if (!raw.trim() || props.chapters.length === 0) return raw;
  return substituteAiChapterMarkersWithTitles(raw, props.chapters);
});

function themePrimaryColor(): string {
  if (typeof window === "undefined") return "#2d2d30";
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim();
  return v || "#2d2d30";
}

function markmapStyleBlock(id: string, noTextSelect = false): string {
  const noSelectCss = noTextSelect
    ? `
    .${id} .markmap-foreign,
    .${id} .markmap-foreign * {
      user-select: none;
      -webkit-user-select: none;
    }
  `
    : "";
  return `
    .${id} {
      --markmap-text-color: var(--fg, #333);
      --markmap-code-bg: var(--bg, #f5f5f5);
      --markmap-code-color: var(--fg, #333);
      --markmap-circle-open-bg: var(--panel, #fff);
    }
    .${id} .markmap-foreign {
      color: var(--fg, #333);
    }
    ${noSelectCss}
  `;
}

function parseCssPx(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 按 markmap fit 规则估算缩放后内容高度，用于收紧视口空白 */
function estimateFittedContentHeight(
  mm: MarkmapHandle,
  viewportWidth: number,
): number {
  const { x1, y1, x2, y2 } = mm.state.rect;
  const dw = x2 - x1;
  const dh = y2 - y1;
  if (dw < 1 || dh < 1) return VIEWPORT_HEIGHT_DEFAULT;
  const fitRatio = MARKMAP_OPTIONS.fitRatio ?? 0.85;
  const maxScale = MARKMAP_OPTIONS.maxInitialScale ?? 2;
  const scale = Math.min((viewportWidth / dw) * fitRatio, maxScale);
  return Math.round(dh * scale + 28);
}

function clampViewportHeight(h: number): number {
  return Math.max(
    VIEWPORT_HEIGHT_MIN,
    Math.min(VIEWPORT_HEIGHT_MAX, h),
  );
}

/** 侧栏预览与全屏交互态共用 markmap 过渡时长；非预览内联为 0 */
function markmapAnimDuration(interactive: boolean): number {
  return interactive || props.preview ? (MARKMAP_OPTIONS.duration ?? 300) : 0;
}

/** 侧栏宽度变化时先过渡视口高度，再 fit，避免仅内容在动、外框高度突变 */
function preapplyInlineViewportHeightOnResize(
  svg: SVGSVGElement | null,
  mm: MarkmapHandle | null,
) {
  if (!props.preview || !svg || svg !== svgRef.value || !mm || expanded.value) {
    return;
  }
  const viewport = svg.parentElement;
  if (!viewport) return;
  const w = viewport.clientWidth;
  if (w < 16) return;
  const next = clampViewportHeight(estimateFittedContentHeight(mm, w));
  if (Math.abs(next - inlineViewportHeight.value) < 6) return;
  inlineViewportHeight.value = next;
  lastAppliedSize.delete(svg);
}

/** 侧栏变窄后同步缩短视口，减少上下留白 */
function applyInlineViewportHeight(mm: MarkmapHandle, svg: SVGSVGElement) {
  if (expanded.value || svg !== svgRef.value) return;
  const viewport = svg.parentElement;
  if (!viewport) return;
  const w = viewport.clientWidth;
  if (w < 16) return;
  const next = clampViewportHeight(estimateFittedContentHeight(mm, w));
  if (Math.abs(next - inlineViewportHeight.value) < 6) return;
  inlineViewportHeight.value = next;
  lastAppliedSize.delete(svg);
}

/** 读取视口可用尺寸（client 为 0 时回退 computed，避免刷新后布局未完成） */
function readViewportSize(svg: SVGSVGElement): { w: number; h: number } {
  const parent = svg.parentElement;
  if (!parent) return { w: 0, h: 0 };

  let w = parent.clientWidth;
  let h = parent.clientHeight;
  if (w <= 0 || h <= 0) {
    const cs = getComputedStyle(parent);
    if (w <= 0) w = parseCssPx(cs.width);
    if (h <= 0) h = parseCssPx(cs.height);
  }
  if (w <= 0 || h <= 0) {
    const r = svg.getBoundingClientRect();
    if (w <= 0) w = r.width;
    if (h <= 0) h = r.height;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

/** d3-zoom 需要 SVG 有像素 width/height，纯 CSS 100% 会触发 SVGLength 相对长度错误 */
function ensureSvgPixelSize(svg: SVGSVGElement): boolean {
  const { w, h } = readViewportSize(svg);
  if (w < 16 || h < 16) return false;

  const prev = lastAppliedSize.get(svg);
  if (prev?.w === w && prev?.h === h) return true;

  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.style.width = `${w}px`;
  svg.style.height = `${h}px`;
  lastAppliedSize.set(svg, { w, h });
  return true;
}

function canMarkmapFit(mm: MarkmapHandle, svg: SVGSVGElement): boolean {
  const box = svg.getBoundingClientRect();
  if (box.width < 16 || box.height < 16) return false;
  const { x1, y1, x2, y2 } = mm.state.rect;
  const dw = x2 - x1;
  const dh = y2 - y1;
  return (
    Number.isFinite(dw) &&
    Number.isFinite(dh) &&
    dw >= 1 &&
    dh >= 1 &&
    Number.isFinite(x1) &&
    Number.isFinite(y1)
  );
}

function destroyMarkmap(mm: MarkmapHandle | null) {
  mm?.destroy?.();
}

function clearSvgElement(svg: SVGSVGElement) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

/** 布局稳定后再 fit，避免 translate(NaN,NaN) */
function scheduleSafeFit(mm: MarkmapHandle | null, svg: SVGSVGElement | null) {
  if (!mm || !svg) return;
  if (fitDebounceTimer) clearTimeout(fitDebounceTimer);
  fitDebounceTimer = setTimeout(() => {
    fitDebounceTimer = null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!ensureSvgPixelSize(svg) || !canMarkmapFit(mm, svg)) return;
        void mm
          .fit(MARKMAP_OPTIONS.maxInitialScale ?? 2)
          .then(() => {
            applyInlineViewportHeight(mm, svg);
            if (!ensureSvgPixelSize(svg) || !canMarkmapFit(mm, svg)) return;
            return mm.fit(MARKMAP_OPTIONS.maxInitialScale ?? 2);
          })
          .catch(() => {
            /* 布局过渡中忽略 */
          });
      });
    });
  }, 320);
}

function onViewportResize(
  svg: SVGSVGElement | null,
  mm: MarkmapHandle | null,
  tryCreate: () => void,
) {
  if (!svg) return;
  if (layoutDebounceTimer) clearTimeout(layoutDebounceTimer);
  layoutDebounceTimer = setTimeout(() => {
    layoutDebounceTimer = null;
    if (mm) {
      preapplyInlineViewportHeightOnResize(svg, mm);
      const prev = lastAppliedSize.get(svg);
      if (!ensureSvgPixelSize(svg)) return;
      const next = lastAppliedSize.get(svg);
      if (prev && next && prev.w === next.w && prev.h === next.h) return;
      scheduleSafeFit(mm, svg);
    } else {
      void tryCreate();
    }
  }, 120);
}

function bindLayoutObserver(
  svg: SVGSVGElement | null,
  getMm: () => MarkmapHandle | null,
  tryCreate: () => void,
  current: ResizeObserver | null,
): ResizeObserver | null {
  current?.disconnect();
  if (!svg?.parentElement) return null;
  const parent = svg.parentElement;
  const ro = new ResizeObserver(() => {
    onViewportResize(svg, getMm(), tryCreate);
  });
  ro.observe(parent);
  return ro;
}

function buildMarkmapOptions(interactive: boolean) {
  return {
    ...MARKMAP_OPTIONS,
    zoom: interactive,
    pan: interactive,
    /** 滚轮缩放；为 true 时滚轮会平移画布 */
    scrollForPan: false,
    /** 默认只切换当前节点；按住 Ctrl/Cmd 点击时 markmap 会递归切换子树 */
    toggleRecursively: false,
    duration: markmapAnimDuration(interactive),
    color: () => themePrimaryColor(),
    style: (id: string) =>
      markmapStyleBlock(id, props.preview && !interactive),
  };
}

function applyInlineInteraction(mm: MarkmapHandle, interactive: boolean) {
  const inst = mm as unknown as MarkmapInst;
  inst.setOptions({
    zoom: interactive,
    pan: interactive,
    scrollForPan: false,
    /** 默认只切换当前节点；按住 Ctrl/Cmd 点击时 markmap 会递归切换子树 */
    toggleRecursively: false,
    duration: markmapAnimDuration(interactive),
  });
  if (!interactive) {
    inst.svg.on(".zoom", null);
    inst.svg.on("wheel", null);
  }
}

async function renderMap(
  svg: SVGSVGElement | null,
  existing: MarkmapHandle | null,
  interactive: boolean,
): Promise<MarkmapHandle | null> {
  if (!svg || !markmapMarkdown.value.trim()) return existing;
  if (!ensureSvgPixelSize(svg)) return existing;

  const { root } = transformer.transform(markmapMarkdown.value);

  if (existing) {
    applyInlineInteraction(existing, interactive);
    await existing.setData(root);
    scheduleSafeFit(existing, svg);
    return existing;
  }

  /** 勿传第三参数 root：create 会在 setData 后无条件 fit()，易在尺寸为 0 时产生 NaN */
  if (svg.childNodes.length > 0) clearSvgElement(svg);
  const mm = Markmap.create(
    svg,
    buildMarkmapOptions(interactive),
  ) as unknown as MarkmapHandle;
  applyInlineInteraction(mm, interactive);
  await mm.setData(root);
  scheduleSafeFit(mm, svg);
  return mm;
}

function blurPreviewFocus() {
  previewViewportRef.value?.blur();
  const ae = document.activeElement;
  if (
    ae instanceof HTMLElement &&
    ae.classList.contains("aiMindmap__viewport--preview")
  ) {
    ae.blur();
  }
}

function queueBlurPreviewFocus() {
  const run = () => blurPreviewFocus();
  void nextTick(() => {
    run();
    requestAnimationFrame(run);
  });
}

function openFullscreen() {
  expanded.value = true;
}

function closeFullscreen() {
  expanded.value = false;
  queueBlurPreviewFocus();
}

async function runWithInitLock(
  lock: { current: Promise<void> | null },
  fn: () => Promise<void>,
) {
  if (lock.current) {
    await lock.current;
    return;
  }
  lock.current = fn().finally(() => {
    lock.current = null;
  });
  await lock.current;
}

async function tryCreateInline() {
  if (!markmapMarkdown.value.trim() || !svgRef.value || markmapRef.value) return;
  if (!ensureSvgPixelSize(svgRef.value)) return;
  await runWithInitLock(inlineInitLock, async () => {
    if (markmapRef.value || !svgRef.value) return;
    markmapRef.value = await renderMap(svgRef.value, null, false);
  });
}

async function tryCreateFullscreen() {
  if (
    !expanded.value ||
    !markmapMarkdown.value.trim() ||
    !fullscreenSvgRef.value ||
    fullscreenMarkmapRef.value
  ) {
    return;
  }
  if (!ensureSvgPixelSize(fullscreenSvgRef.value)) return;
  await runWithInitLock(fullscreenInitLock, async () => {
    if (fullscreenMarkmapRef.value || !fullscreenSvgRef.value) return;
    fullscreenMarkmapRef.value = await renderMap(
      fullscreenSvgRef.value,
      null,
      true,
    );
  });
}

/** 仅更新数据（markdown 变化时） */
async function refreshMaps() {
  if (!markmapMarkdown.value.trim()) return;

  if (svgRef.value) {
    if (markmapRef.value) {
      await renderMap(svgRef.value, markmapRef.value, false);
    } else {
      await tryCreateInline();
    }
  }

  if (expanded.value && fullscreenSvgRef.value) {
    if (fullscreenMarkmapRef.value) {
      await renderMap(fullscreenSvgRef.value, fullscreenMarkmapRef.value, true);
    } else {
      await tryCreateFullscreen();
    }
  }
}

function refreshMapsWhenReady(retries = 12) {
  const pass = ++readyPass;
  void (async () => {
    await tryCreateInline();
    await tryCreateFullscreen();
    if (pass !== readyPass) return;
    const needRetry =
      markmapMarkdown.value.trim() &&
      ((!markmapRef.value && svgRef.value) ||
        (expanded.value &&
          !fullscreenMarkmapRef.value &&
          fullscreenSvgRef.value));
    if (needRetry && retries > 0) {
      requestAnimationFrame(() => refreshMapsWhenReady(retries - 1));
    }
  })();
}

function attachLayoutObservers() {
  if (svgRef.value) {
    inlineLayoutObserver = bindLayoutObserver(
      svgRef.value,
      () => markmapRef.value,
      tryCreateInline,
      inlineLayoutObserver,
    );
  }
  if (expanded.value && fullscreenSvgRef.value) {
    fullscreenLayoutObserver = bindLayoutObserver(
      fullscreenSvgRef.value,
      () => fullscreenMarkmapRef.value,
      tryCreateFullscreen,
      fullscreenLayoutObserver,
    );
  }
}

function activeMarkmap(): MarkmapHandle | null {
  return expanded.value ? fullscreenMarkmapRef.value : markmapRef.value;
}

function activeSvg(): SVGSVGElement | null {
  return expanded.value ? fullscreenSvgRef.value : svgRef.value;
}

function asMarkmapInst(mm: MarkmapHandle | null): MarkmapInst | null {
  return mm as unknown as MarkmapInst | null;
}

async function setTreeFoldAll(mm: MarkmapHandle | null, fold: 0 | 1) {
  const inst = asMarkmapInst(mm);
  const root = inst?.state.data;
  if (!inst || !root) return;

  walkTree(root, (node, next) => {
    if (fold === 1) {
      if (node.children?.length) {
        node.payload = { ...node.payload, fold: 1 };
      }
    } else {
      node.payload = { ...node.payload, fold: 0 };
    }
    next();
  });
  await inst.renderData();
  scheduleSafeFit(mm, activeSvg());
}

async function handleCollapseAll() {
  await setTreeFoldAll(activeMarkmap(), 1);
}

async function handleExpandAll() {
  await setTreeFoldAll(activeMarkmap(), 0);
}

function handleReset() {
  scheduleSafeFit(activeMarkmap(), activeSvg());
}

async function renderFullyExpandedExportSvg(): Promise<string | null> {
  if (!markmapMarkdown.value.trim()) return null;

  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(EXPORT_SVG_WIDTH));
  svg.setAttribute("height", String(EXPORT_SVG_HEIGHT));
  svg.style.width = `${EXPORT_SVG_WIDTH}px`;
  svg.style.height = `${EXPORT_SVG_HEIGHT}px`;
  container.appendChild(svg);
  document.body.appendChild(container);

  let mm: MarkmapInst | null = null;
  try {
    const { root } = transformer.transform(markmapMarkdown.value);
    mm = Markmap.create(svg, {
      ...buildMarkmapOptions(false),
      autoFit: false,
      initialExpandLevel: -1,
      duration: 0,
      maxInitialScale: 999,
    });
    await mm.setData(root);
    await mm.fit(999);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    return buildExportSvg(svg);
  } finally {
    mm?.destroy();
    container.remove();
  }
}

function buildExportSvg(source: SVGSVGElement): string | null {
  const gElement = source.querySelector("g");
  let contentX = -500;
  let contentY = -500;
  let contentWidth = 2000;
  let contentHeight = 1500;

  if (gElement) {
    try {
      const bbox = gElement.getBBox();
      const padding = 50;
      contentX = bbox.x - padding;
      contentY = bbox.y - padding;
      contentWidth = bbox.width + padding * 2;
      contentHeight = bbox.height + padding * 2;
    } catch {
      /* keep defaults */
    }
  }

  const clonedSvg = source.cloneNode(true) as SVGSVGElement;
  const clonedG = clonedSvg.querySelector("g");
  if (clonedG) {
    clonedG.setAttribute("transform", "translate(0,0) scale(1)");
  }
  clonedSvg.setAttribute(
    "viewBox",
    `${contentX} ${contentY} ${contentWidth} ${contentHeight}`,
  );
  clonedSvg.setAttribute("width", String(contentWidth));
  clonedSvg.setAttribute("height", String(contentHeight));
  clonedSvg.style.width = "";
  clonedSvg.style.height = "";

  const bgRect = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "rect",
  );
  bgRect.setAttribute("x", String(contentX));
  bgRect.setAttribute("y", String(contentY));
  bgRect.setAttribute("width", String(contentWidth));
  bgRect.setAttribute("height", String(contentHeight));
  bgRect.setAttribute("fill", "white");
  clonedSvg.insertBefore(bgRect, clonedSvg.firstChild);

  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `
    .markmap {
      --markmap-text-color: #333 !important;
      --markmap-code-bg: #f5f5f5 !important;
      --markmap-code-color: #333 !important;
      --markmap-circle-open-bg: #fff !important;
    }
    .markmap-foreign { color: #333 !important; }
    text {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      fill: #333 !important;
    }
  `;
  clonedSvg.insertBefore(style, clonedSvg.firstChild);

  let svgData = new XMLSerializer().serializeToString(clonedSvg);
  svgData = svgData.replace(/var\(--foreground\)/g, "#333");
  svgData = svgData.replace(/var\(--background\)/g, "#fff");
  svgData = svgData.replace(/var\(--muted\)/g, "#f5f5f5");
  svgData = svgData.replace(/var\(--text\)/g, "#333");
  svgData = svgData.replace(/var\(--surface[^)]*\)/g, "#fff");
  return svgData;
}

async function handleDownload() {
  const svgData = await renderFullyExpandedExportSvg();
  if (!svgData) return;
  const base = (props.title ?? "思维导图").trim() || "思维导图";
  const safe = base.replace(/[<>:"/\\|?*]/g, "_").slice(0, 80);
  const r = await window.colorTxt.ai.exportSave({
    defaultName: `${safe}.svg`,
    data: svgData,
    filters: [{ name: "SVG", extensions: ["svg"] }],
  });
  if (r.ok && "path" in r) {
    /* saved */
  }
}

function onKeydown(ev: KeyboardEvent) {
  if (expanded.value && ev.key === "Escape") {
    ev.preventDefault();
    closeFullscreen();
  }
}

watch(
  () => [props.markdown, props.chapters] as const,
  () => {
    void nextTick(() => {
      void refreshMaps();
    });
  },
  { deep: true },
);

watch(svgRef, (svg) => {
  if (svg) {
    inlineLayoutObserver = bindLayoutObserver(
      svg,
      () => markmapRef.value,
      tryCreateInline,
      inlineLayoutObserver,
    );
    void nextTick(() => refreshMapsWhenReady());
  }
});

watch(expanded, async (v) => {
  if (v) {
    await nextTick();
    attachLayoutObservers();
    requestAnimationFrame(() => refreshMapsWhenReady());
  } else {
    fullscreenLayoutObserver?.disconnect();
    fullscreenLayoutObserver = null;
    destroyMarkmap(fullscreenMarkmapRef.value);
    fullscreenMarkmapRef.value = null;
    queueBlurPreviewFocus();
  }
});

onMounted(() => {
  attachLayoutObservers();
  void nextTick(() => refreshMapsWhenReady());

  visibilityObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      const mm = markmapRef.value;
      const svg = svgRef.value;
      if (mm && svg && ensureSvgPixelSize(svg)) {
        scheduleSafeFit(mm, svg);
      } else {
        void tryCreateInline();
      }
    },
    { root: null, threshold: 0.05 },
  );
  void nextTick(() => {
    const rootEl = svgRef.value?.closest(".aiMindmap");
    if (rootEl && visibilityObserver) visibilityObserver.observe(rootEl);
  });

  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  readyPass += 1;
  if (layoutDebounceTimer) clearTimeout(layoutDebounceTimer);
  if (fitDebounceTimer) clearTimeout(fitDebounceTimer);
  visibilityObserver?.disconnect();
  inlineLayoutObserver?.disconnect();
  fullscreenLayoutObserver?.disconnect();
  destroyMarkmap(markmapRef.value);
  destroyMarkmap(fullscreenMarkmapRef.value);
  markmapRef.value = null;
  fullscreenMarkmapRef.value = null;
  if (svgRef.value) clearSvgElement(svgRef.value);
  if (fullscreenSvgRef.value) clearSvgElement(fullscreenSvgRef.value);
});
</script>

<template>
  <div class="aiMindmap" :class="{ 'aiMindmap--preview': preview }">
    <template v-if="preview">
      <div v-if="displayTitle" class="aiMindmap__previewHead" :title="title">
        <span class="aiMindmap__previewLeadIcon" aria-hidden="true">
          <span class="svg aiMindmap__previewIcon" v-html="icons.mindmap" />
        </span>
        <span class="aiMindmap__previewTitle">{{ displayTitle }}</span>
      </div>
      <div
        ref="previewViewportRef"
        class="aiMindmap__viewport aiMindmap__viewport--preview"
        role="button"
        tabindex="0"
        title="点击放大查看思维导图"
        :style="{ height: `${inlineViewportHeight}px` }"
        @mousedown.prevent
        @click="openFullscreen"
        @keydown.enter.prevent="openFullscreen"
        @keydown.space.prevent="openFullscreen"
      >
        <svg ref="svgRef" class="aiMindmap__svg aiMindmap__svg--preview" />
      </div>
    </template>
    <template v-else>
      <div class="aiMindmap__toolbar">
        <span class="aiMindmap__title" :title="title">{{ displayTitle }}</span>
        <div class="aiMindmapFullscreen__actions">
          <button
            type="button"
            class="aiActivityLikeBtn"
            title="复位"
            aria-label="复位"
            @click="handleReset"
          >
            <span class="svg" v-html="icons.reset" />
          </button>
          <span
            class="aiMindmapFullscreen__toolbarSep"
            role="separator"
            aria-hidden="true"
          />
          <button
            type="button"
            class="aiActivityLikeBtn"
            title="全部收起"
            aria-label="全部收起"
            @click="handleCollapseAll"
          >
            <span class="svg" v-html="icons.fold" />
          </button>
          <button
            type="button"
            class="aiActivityLikeBtn"
            title="全部展开"
            aria-label="全部展开"
            @click="handleExpandAll"
          >
            <span class="svg" v-html="icons.expand" />
          </button>
          <span
            class="aiMindmapFullscreen__toolbarSep"
            role="separator"
            aria-hidden="true"
          />
          <button
            type="button"
            class="aiActivityLikeBtn"
            title="导出 SVG"
            aria-label="导出 SVG"
            @click="handleDownload"
          >
            <span class="svg" v-html="icons.download" />
          </button>
          <button
            type="button"
            class="aiActivityLikeBtn"
            title="全屏"
            aria-label="全屏"
            @click="openFullscreen"
          >
            <span class="svg" v-html="icons.enterFullscreen" />
          </button>
        </div>
      </div>
      <div
        class="aiMindmap__viewport"
        :style="{ height: `${inlineViewportHeight}px` }"
      >
        <svg ref="svgRef" class="aiMindmap__svg" />
      </div>
      <p v-if="stats" class="aiMindmap__stats">
        节点数：{{ stats.nodeCount }}，深度：{{ stats.maxDepth }}
      </p>
      <p class="aiMindmap__hint">拖动移动 · 滚轮缩放 · 点击节点展开/收起</p>
    </template>

    <Teleport to="body">
      <Transition name="aiMindmapFullscreen" @after-leave="blurPreviewFocus">
        <div
          v-if="expanded"
          class="aiMindmapFullscreen"
          role="dialog"
          aria-modal="true"
          :aria-label="displayTitle"
        >
          <div
            class="aiMindmapFullscreen__backdrop"
            aria-hidden="true"
            @click="closeFullscreen"
          />
          <div class="aiMindmapFullscreen__panel">
          <div class="aiMindmapFullscreen__toolbar">
            <div class="aiMindmapFullscreen__titleLead">
              <span class="aiMindmap__previewLeadIcon" aria-hidden="true">
                <span class="svg aiMindmap__previewIcon" v-html="icons.mindmap" />
              </span>
              <span class="aiMindmapFullscreen__title" :title="title">{{
                displayTitle
              }}</span>
            </div>
        <div class="aiMindmapFullscreen__actions">
          <button
            type="button"
            class="aiActivityLikeBtn"
            title="复位"
            aria-label="复位"
            @click="handleReset"
          >
            <span class="svg" v-html="icons.reset" />
          </button>
          <span
            class="aiMindmapFullscreen__toolbarSep"
            role="separator"
            aria-hidden="true"
          />
          <button
            type="button"
            class="aiActivityLikeBtn"
            title="全部收起"
            aria-label="全部收起"
            @click="handleCollapseAll"
          >
            <span class="svg" v-html="icons.fold" />
          </button>
          <button
            type="button"
            class="aiActivityLikeBtn"
            title="全部展开"
            aria-label="全部展开"
            @click="handleExpandAll"
          >
            <span class="svg" v-html="icons.expand" />
          </button>
          <span
            class="aiMindmapFullscreen__toolbarSep"
            role="separator"
            aria-hidden="true"
          />
          <button
            type="button"
            class="aiActivityLikeBtn"
            title="导出 SVG"
            aria-label="导出 SVG"
            @click="handleDownload"
          >
            <span class="svg" v-html="icons.download" />
          </button>
          <button
            type="button"
            class="aiActivityLikeBtn aiMindmapFullscreen__closeBtn"
            title="关闭"
            aria-label="关闭"
            @click="closeFullscreen"
          >
            <span class="svg" v-html="icons.close" />
          </button>
        </div>
          </div>
          <div class="aiMindmapFullscreen__viewport">
            <svg ref="fullscreenSvgRef" class="aiMindmap__svg" />
          </div>
          <div class="aiMindmapFullscreen__footer">
            <p v-if="stats" class="aiMindmapFullscreen__stats">
              节点数：{{ stats.nodeCount }}，深度：{{ stats.maxDepth }}
            </p>
            <p class="aiMindmapFullscreen__hint">
              拖动移动 · 滚轮缩放 · 点击节点展开/收起
            </p>
          </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.aiMindmap {
  margin-top: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel, #f3f3f3);
  overflow: hidden;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}

.aiMindmap--preview {
  margin-top: 0;
  margin-bottom: 10px;
  user-select: none;
  -webkit-user-select: none;
}

.aiMindmap__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}

.aiMindmap__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg, #333);
}

.aiMindmapFullscreen__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.aiMindmapFullscreen__toolbarSep {
  width: 1px;
  height: 16px;
  flex-shrink: 0;
  background: var(--border);
}

.aiMindmapFullscreen__actions .aiActivityLikeBtn {
  color: var(--icon-btn-fg, #1e1e1e);
}

.aiMindmapFullscreen__actions .aiActivityLikeBtn:hover:not(:disabled) {
  color: var(--icon-btn-fg, #1e1e1e);
}

.aiMindmapFullscreen__actions .aiActivityLikeBtn .svg :deep(svg path) {
  fill: currentColor;
}

.aiMindmapFullscreen__actions
  .aiMindmapFullscreen__closeBtn:hover:not(:disabled) {
  color: #fff;
  background: var(--danger);
}

.aiMindmapFullscreen__actions
  .aiMindmapFullscreen__closeBtn:hover:not(:disabled)
  .svg
  :deep(svg path) {
  fill: #fff;
}

/** close.svg 图形占满 viewBox，同 16px 下比复位/导出更显大，略缩小对齐视觉 */
.aiMindmapFullscreen__closeBtn .svg :deep(svg) {
  width: 14px;
  height: 14px;
}

/** 与 AiAssistantDetailsFold .aiFoldSummary / .aiFoldTitle 对齐 */
.aiMindmap__previewHead {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 6px 6px;
  font-size: 12px;
  color: var(--muted, #6b6b6b);
  background: var(--bg, #f8f8f8);
  box-sizing: border-box;
  user-select: none;
}

.aiMindmap__previewLeadIcon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.aiMindmap__previewLeadIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.aiMindmap__previewIcon {
  color: color-mix(in srgb, var(--muted, #6b6b6b) 85%, var(--fg, #333));
}

.aiMindmap__previewLeadIcon :deep(.aiMindmap__previewIcon svg path) {
  fill: currentColor;
}

.aiMindmap__previewTitle {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  color: var(--fg, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.aiMindmap__viewport {
  width: 100%;
  min-height: 160px;
  max-height: 420px;
  position: relative;
  overflow: hidden;
  transition: height 0.2s ease;
  background: var(--panel, #f3f3f3);
}

.aiMindmap__viewport--preview {
  cursor: zoom-in;
  outline: none;
  border-top: 1px solid var(--border);
  user-select: none;
  -webkit-user-select: none;
  /** 与 markmap duration（300ms）对齐，侧栏变宽/变窄时高度同步过渡 */
  transition: height 0.3s ease;
}

.aiMindmap--preview :deep(.markmap-foreign),
.aiMindmap--preview :deep(.markmap-foreign *) {
  user-select: none !important;
  -webkit-user-select: none !important;
}

.aiMindmap__viewport--preview:focus {
  outline: none;
}

.aiMindmap__viewport--preview:focus:not(:focus-visible) {
  box-shadow: none;
}

.aiMindmap__viewport--preview:hover {
  background: color-mix(
    in srgb,
    var(--accent, #409eff) 6%,
    var(--panel, #f3f3f3)
  );
}

.aiMindmap__viewport--preview:focus-visible {
  box-shadow: inset 0 0 0 2px var(--accent, #409eff);
}

.aiMindmap__svg {
  display: block;
  width: 100%;
  height: 100%;
}

.aiMindmap__svg--preview {
  pointer-events: none;
}

.aiMindmap__stats,
.aiMindmap__hint {
  margin: 0;
  padding: 4px 10px 8px;
  font-size: 11px;
  color: var(--muted, #6b6b6b);
}

.aiMindmapFullscreen-enter-active,
.aiMindmapFullscreen-leave-active {
  transition: opacity 0.22s ease;
}

.aiMindmapFullscreen-enter-from,
.aiMindmapFullscreen-leave-to {
  opacity: 0;
}

.aiMindmapFullscreen-enter-active .aiMindmapFullscreen__panel,
.aiMindmapFullscreen-leave-active .aiMindmapFullscreen__panel {
  transform-origin: center center;
  transition:
    transform 0.22s ease-out,
    opacity 0.2s ease-out;
}

.aiMindmapFullscreen-enter-from .aiMindmapFullscreen__panel {
  transform: scale(0.9);
  opacity: 0;
}

.aiMindmapFullscreen-leave-to .aiMindmapFullscreen__panel {
  transform: scale(0.96);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .aiMindmapFullscreen-enter-active,
  .aiMindmapFullscreen-leave-active,
  .aiMindmapFullscreen-enter-active .aiMindmapFullscreen__panel,
  .aiMindmapFullscreen-leave-active .aiMindmapFullscreen__panel {
    transition-duration: 0.01ms !important;
  }
}

.aiMindmapFullscreen {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  /** 固定视口边距，随窗口放大而放大（不限制 max 宽高） */
  padding: 6vh 4vw;
  box-sizing: border-box;
}

.aiMindmapFullscreen__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
}

.aiMindmapFullscreen__panel {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--panel, #f3f3f3);
  color: var(--fg, #333);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.aiMindmapFullscreen__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px 6px 6px;
  border-bottom: 1px solid var(--border);
  background: var(--bg, #f8f8f8);
  user-select: none;
}

.aiMindmapFullscreen__titleLead {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.aiMindmapFullscreen__title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--fg, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
}

.aiMindmapFullscreen__viewport {
  flex: 1;
  min-height: 240px;
  position: relative;
  overflow: hidden;
  background: var(--panel, #f3f3f3);
}

.aiMindmapFullscreen__footer {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted, #6b6b6b);
  user-select: none;
}

.aiMindmapFullscreen__stats {
  margin: 0;
  flex-shrink: 0;
  white-space: nowrap;
}

.aiMindmapFullscreen__hint {
  margin: 0 0 0 auto;
  text-align: right;
  white-space: nowrap;
}

.svg :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}
</style>
