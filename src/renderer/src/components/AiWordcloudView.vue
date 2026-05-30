<script setup lang="ts">

import cloud from "d3-cloud";

import { scaleLinear, scaleOrdinal } from "d3-scale";

import {

  computed,

  nextTick,

  onBeforeUnmount,

  onMounted,

  ref,

  watch,

} from "vue";

import FontPicker from "./FontPicker.vue";
import IconButton from "./IconButton.vue";
import { icons } from "../icons";

import {
  WORDCLOUD_ANGLE_OPTIONS,
  WORDCLOUD_DEFAULT_ANGLE_MODE,
  WORDCLOUD_DEFAULT_FONT_FAMILY,
  wordcloudAngleModeLabel,
  type WordcloudAngleMode,
} from "../constants/wordcloudUi";

import {
  WORDCLOUD_DEFAULT_PALETTE_ID,
  WORDCLOUD_PALETTES,
  wordcloudPaletteLabel,
  type WordcloudPaletteId,
} from "../constants/wordcloudPalettes";

import type { AIWordcloudMode } from "@shared/aiTypes";
import { WORDCLOUD_MAX_WORDS_MAX } from "@shared/aiTypes";



type CloudWord = {

  text: string;

  size: number;

  color?: string;

  x?: number;

  y?: number;

  rotate?: number;

};



/** 词云布局固定宽高比（与 d3-cloud 布局坐标系一致） */

const LAYOUT_ASPECT_W = 3;

const LAYOUT_ASPECT_H = 2;

const LAYOUT_WIDTH = 900;

const LAYOUT_HEIGHT = (LAYOUT_WIDTH * LAYOUT_ASPECT_H) / LAYOUT_ASPECT_W;



function createWordcloudFillScale(
  paletteId: WordcloudPaletteId,
  texts: string[],
) {
  const palette = WORDCLOUD_PALETTES.find((p) => p.id === paletteId)
    ?? WORDCLOUD_PALETTES[0];
  return scaleOrdinal<string, string>()
    .domain(texts)
    .range([...palette.colors]);
}



const props = withDefaults(

  defineProps<{

    title?: string;

    mode?: AIWordcloudMode;

    semanticQuery?: string;

    words: Array<{ text: string; weight: number }>;

    stats?: {

      totalChars: number;

      uniqueTerms: number;

      cacheHits: number;

      termsExtracted?: number;

    };

    /** 词云字体（与阅读器独立，持久化于设置） */

    wordcloudFontFamily: string;

    /** 词云角度布局（持久化于设置） */

    wordcloudAngleMode: WordcloudAngleMode;

    /** 词云配色（持久化于设置） */

    wordcloudPaletteId: WordcloudPaletteId;

    /** 每条词云独立的布局 seed（随 tool 消息持久化） */
    layoutSeed?: number;

    preview?: boolean;

  }>(),

  {

    title: "",

    mode: "general",

    wordcloudFontFamily: WORDCLOUD_DEFAULT_FONT_FAMILY,

    wordcloudAngleMode: WORDCLOUD_DEFAULT_ANGLE_MODE,

    wordcloudPaletteId: WORDCLOUD_DEFAULT_PALETTE_ID,

    layoutSeed: 0,

    preview: true,

  },

);



const emit = defineEmits<{

  "update:wordcloudFontFamily": [fontFamily: string];

  "update:wordcloudAngleMode": [mode: WordcloudAngleMode];

  "update:wordcloudPaletteId": [paletteId: WordcloudPaletteId];

  "update:layoutSeed": [layoutSeed: number];

}>();



/** 布局用 seed（与 prop 解耦，避免 emit 回写前被重置） */
const activeLayoutSeed = ref(props.layoutSeed ?? 0);



const canvasRef = ref<HTMLCanvasElement | null>(null);

const previewViewportRef = ref<HTMLElement | null>(null);

const fullscreenCanvasRef = ref<HTMLCanvasElement | null>(null);

const expanded = ref(false);



const panX = ref(0);

const panY = ref(0);

const zoom = ref(1);

const dragState = ref<{ x: number; y: number; panX: number; panY: number } | null>(

  null,

);



const cachedLayout = ref<CloudWord[] | null>(null);

const layoutCacheKey = ref("");

const angleMenuOpen = ref(false);

const angleMenuRootEl = ref<HTMLElement | null>(null);

const paletteMenuOpen = ref(false);

const paletteMenuRootEl = ref<HTMLElement | null>(null);



let layoutGen = 0;

let inlineObserver: ResizeObserver | null = null;



const displayTitle = computed(() => {

  const t = (props.title ?? "").trim() || "词云";

  return t.length > 24 ? `${t.slice(0, 24)}…` : t;

});



const statsLine = computed(() => {

  const s = props.stats;

  if (!s) return "";

  const termPart = `词项：${s.uniqueTerms}`;

  if (props.mode === "semantic" && props.semanticQuery?.trim()) {

    const q = props.semanticQuery.trim();

    const qDisplay = q.length > 28 ? `${q.slice(0, 28)}…` : q;

    return `语义：${qDisplay}，${termPart}`;

  }

  return termPart;

});



function themeFgColor(): string {

  if (typeof window === "undefined") return "#333";

  const v = getComputedStyle(document.documentElement)

    .getPropertyValue("--fg")

    .trim();

  return v || "#333";

}



function wordsSignature(): string {

  return JSON.stringify(

    props.words

      .filter((w) => w.text.trim() && w.weight > 0)

      .map((w) => [w.text, w.weight]),

  );

}



let lastWordsSignature = wordsSignature();



function layoutSeedValue(): number {

  return activeLayoutSeed.value;

}



function currentLayoutKey(seed = layoutSeedValue()): string {

  return `${wordsSignature()}|${seed}|${props.wordcloudFontFamily}|${props.wordcloudAngleMode}`;

}



function mulberry32(seed: number): () => number {

  let s = seed >>> 0;

  return () => {

    s = (s + 0x6d2b79f5) >>> 0;

    let t = Math.imul(s ^ (s >>> 15), 1 | s);

    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;

  };

}



/** d3-cloud 对每个词连续 3 次 random：锚点 x、锚点 y、螺旋方向；权重越高锚点越靠近中心 */

function createWeightBiasedCloudRandom(

  sortedBySize: { size?: number }[],

  rng: () => number,

): () => number {

  const maxSize = sortedBySize[0]?.size ?? 1;

  let callsInWord = 0;

  let wordIndex = 0;

  return () => {

    let result: number;

    if (callsInWord < 2) {

      const w = sortedBySize[Math.min(wordIndex, sortedBySize.length - 1)];

      const ratio = (w?.size ?? maxSize) / maxSize;

      const spread = (1 - ratio) * 0.5;

      result = 0.5 + (rng() - 0.5) * 2 * spread;

    } else {

      result = rng();

    }

    callsInWord++;

    if (callsInWord >= 3) {

      callsInWord = 0;

      wordIndex++;

    }

    return result;

  };

}



const CLOUD_LAYOUT_MAX_WORDS = WORDCLOUD_MAX_WORDS_MAX;



const cloudFontFamily = computed(() => {

  const f = props.wordcloudFontFamily.trim();

  return f || WORDCLOUD_DEFAULT_FONT_FAMILY;

});



const angleModeLabel = computed(() =>

  wordcloudAngleModeLabel(props.wordcloudAngleMode),

);



const paletteModeLabel = computed(() =>

  wordcloudPaletteLabel(props.wordcloudPaletteId),

);



/** d3-cloud 在 cloudSprite 里用 (size + 1)px 栅格化碰撞位图 */

function cloudLayoutFontCss(size: number): string {

  return `normal normal ${Math.round(size + 1)}px ${cloudFontFamily.value}`;

}



function cloudRotateForMode(mode: WordcloudAngleMode, rng: () => number): number {

  if (mode === "horizontal") return 0;

  if (mode === "mixed") return rng() > 0.5 ? 90 : 0;

  return (Math.floor(rng() * 6) - 3) * 30;

}



async function layoutWords(seed: number): Promise<CloudWord[]> {

  const list = props.words

    .filter((w) => w.text.trim() && w.weight > 0)

    .sort((a, b) => b.weight - a.weight)

    .slice(0, CLOUD_LAYOUT_MAX_WORDS);

  if (list.length === 0) return [];

  const weights = list.map((w) => w.weight);

  const minW = Math.min(...weights);

  const maxW = Math.max(...weights);

  const sizeScale = scaleLinear()

    .domain([minW, maxW])

    .range([

      Math.max(12, LAYOUT_WIDTH * 0.022),

      Math.max(18, LAYOUT_WIDTH * 0.09),

    ]);

  const payload = list.map((w) => ({

    text: w.text,

    size: sizeScale(w.weight),

  }));

  const rng = mulberry32(seed);

  const sortedBySize = [...payload].sort((a, b) => (b.size ?? 0) - (a.size ?? 0));

  const cloudRandom = createWeightBiasedCloudRandom(sortedBySize, rng);

  return new Promise((resolve) => {

    cloud()

      .size([LAYOUT_WIDTH, LAYOUT_HEIGHT])

      .words(payload)

      .padding(2)

      .random(cloudRandom)

      .rotate(() => cloudRotateForMode(props.wordcloudAngleMode, rng))

      .font(cloudFontFamily.value)

      .fontStyle("normal")

      .fontWeight("normal")

      .fontSize((d) => d.size ?? 14)

      .on("end", (words) => {

        resolve(

          (words as CloudWord[]).map((w) => ({ ...w })),

        );

      })

      .start();

  });

}



async function computeLayout(
  force: boolean,
  seedOverride?: number,
): Promise<CloudWord[]> {

  const seed = seedOverride ?? layoutSeedValue();

  const key = currentLayoutKey(seed);

  if (!force && cachedLayout.value && layoutCacheKey.value === key) {

    return cachedLayout.value;

  }

  const gen = ++layoutGen;

  const laid = await layoutWords(seed);

  if (gen !== layoutGen) return cachedLayout.value ?? laid;

  cachedLayout.value = laid;

  layoutCacheKey.value = key;

  return laid;

}



function drawCloud(

  canvas: HTMLCanvasElement,

  laid: CloudWord[],

  opts: { interactive: boolean },

) {

  const dpr = window.devicePixelRatio || 1;

  const rect = canvas.getBoundingClientRect();

  const w = Math.max(1, Math.round(rect.width));

  const h = Math.max(1, Math.round(rect.height));

  canvas.width = Math.round(w * dpr);

  canvas.height = Math.round(h * dpr);

  const ctx = canvas.getContext("2d");

  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, w, h);

  const fallbackColor = themeFgColor();

  const fillScale = createWordcloudFillScale(

    props.wordcloudPaletteId,

    laid.map((w) => w.text),

  );



  const fitScale = Math.min(w / LAYOUT_WIDTH, h / LAYOUT_HEIGHT);

  const cx = w / 2 + (opts.interactive ? panX.value : 0);

  const cy = h / 2 + (opts.interactive ? panY.value : 0);

  const z = opts.interactive ? zoom.value : 1;



  ctx.save();

  ctx.translate(cx, cy);

  ctx.scale(fitScale * z, fitScale * z);

  for (const word of laid) {

    if (word.x == null || word.y == null) continue;

    ctx.save();

    ctx.translate(word.x, word.y);

    ctx.rotate(((word.rotate ?? 0) * Math.PI) / 180);

    const size = word.size ?? 14;

    ctx.font = cloudLayoutFontCss(size);

    ctx.textAlign = "left";

    ctx.textBaseline = "alphabetic";

    ctx.fillStyle = fillScale(word.text) ?? fallbackColor;

    const anchor = -Math.floor(ctx.measureText(word.text).width / 2);

    ctx.fillText(word.text, anchor, 0);

    ctx.restore();

  }

  ctx.restore();

}



async function paintCanvas(

  canvas: HTMLCanvasElement | null,

  interactive: boolean,

  forceLayout = false,

  seedOverride?: number,

) {

  if (!canvas) return;

  const laid = await computeLayout(forceLayout, seedOverride);

  if (laid.length === 0) return;

  drawCloud(canvas, laid, { interactive });

}



function scheduleRedraw(interactive: boolean) {

  void nextTick(() => {

    void paintCanvas(

      interactive ? fullscreenCanvasRef.value : canvasRef.value,

      interactive,

      false,

    );

  });

}



async function relayoutAll(seedOverride?: number) {

  await paintCanvas(canvasRef.value, false, true, seedOverride);

  if (expanded.value) {

    await paintCanvas(fullscreenCanvasRef.value, true, true, seedOverride);

  }

}



function invalidateLayoutState(resetSeed = true) {

  if (resetSeed) {

    activeLayoutSeed.value = 0;

    emit("update:layoutSeed", 0);

  }

  cachedLayout.value = null;

  layoutCacheKey.value = "";

  panX.value = 0;

  panY.value = 0;

  zoom.value = 1;

}



function openFullscreen() {

  expanded.value = true;

  panX.value = 0;

  panY.value = 0;

  zoom.value = 1;

  void nextTick(() => scheduleRedraw(true));

}



function closeFullscreen() {

  expanded.value = false;

  blurPreviewFocus();

}



function blurPreviewFocus() {

  previewViewportRef.value?.blur();

}



function handleRegenerate() {

  activeLayoutSeed.value += 1;

  cachedLayout.value = null;

  layoutCacheKey.value = "";

  panX.value = 0;

  panY.value = 0;

  zoom.value = 1;

  emit("update:layoutSeed", activeLayoutSeed.value);

  void relayoutAll();

}



function handleReset() {

  panX.value = 0;

  panY.value = 0;

  zoom.value = 1;

  scheduleRedraw(expanded.value);

}



function onWordcloudFontChange(fontFamily: string) {

  emit("update:wordcloudFontFamily", fontFamily);

}



function closeToolbarMenus() {

  angleMenuOpen.value = false;

  paletteMenuOpen.value = false;

}



function closeAngleMenu() {

  angleMenuOpen.value = false;

}



function closePaletteMenu() {

  paletteMenuOpen.value = false;

}



function toggleAngleMenu() {

  if (!angleMenuOpen.value) closePaletteMenu();

  angleMenuOpen.value = !angleMenuOpen.value;

}



function togglePaletteMenu() {

  if (!paletteMenuOpen.value) closeAngleMenu();

  paletteMenuOpen.value = !paletteMenuOpen.value;

}



function chooseAngleMode(mode: WordcloudAngleMode) {

  if (props.wordcloudAngleMode !== mode) {

    emit("update:wordcloudAngleMode", mode);

  }

  closeAngleMenu();

}



function choosePalette(id: WordcloudPaletteId) {

  if (props.wordcloudPaletteId !== id) {

    emit("update:wordcloudPaletteId", id);

  }

  closePaletteMenu();

}



function onToolbarMenuPointerDown(ev: PointerEvent) {

  const target = ev.target as Node | null;

  if (angleMenuOpen.value) {

    const root = angleMenuRootEl.value;

    if (root && target && !root.contains(target)) closeAngleMenu();

  }

  if (paletteMenuOpen.value) {

    const root = paletteMenuRootEl.value;

    if (root && target && !root.contains(target)) closePaletteMenu();

  }

}



function handleDownload() {

  const canvas = expanded.value

    ? fullscreenCanvasRef.value

    : canvasRef.value;

  if (!canvas) return;

  canvas.toBlob((blob) => {

    if (!blob) return;

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    const base = (props.title ?? "词云").trim() || "词云";

    a.href = url;

    a.download = `${base}.png`;

    a.click();

    URL.revokeObjectURL(url);

  }, "image/png");

}



function onPreviewKeydown(ev: KeyboardEvent) {

  if (ev.key === "Enter" || ev.key === " ") {

    ev.preventDefault();

    openFullscreen();

  }

}



function onWheel(ev: WheelEvent) {

  if (!expanded.value) return;

  ev.preventDefault();

  const delta = ev.deltaY > 0 ? 0.92 : 1.08;

  zoom.value = Math.min(4, Math.max(0.35, zoom.value * delta));

  scheduleRedraw(true);

}



function onPointerDown(ev: PointerEvent) {

  if (!expanded.value) return;

  dragState.value = {

    x: ev.clientX,

    y: ev.clientY,

    panX: panX.value,

    panY: panY.value,

  };

  (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);

}



function onPointerMove(ev: PointerEvent) {

  const st = dragState.value;

  if (!st) return;

  panX.value = st.panX + (ev.clientX - st.x);

  panY.value = st.panY + (ev.clientY - st.y);

  scheduleRedraw(true);

}



function onPointerUp(ev: PointerEvent) {

  dragState.value = null;

  try {

    (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);

  } catch {

    /* ignore */

  }

}



function onKeydown(ev: KeyboardEvent) {

  if (ev.key === "Escape" && expanded.value) {

    if (angleMenuOpen.value) {

      ev.preventDefault();

      closeAngleMenu();

      return;

    }

    if (paletteMenuOpen.value) {

      ev.preventDefault();

      closePaletteMenu();

      return;

    }

    ev.preventDefault();

    closeFullscreen();

  }

}



watch(

  () => props.words,

  () => {

    const sig = wordsSignature();

    if (sig === lastWordsSignature) return;

    lastWordsSignature = sig;

    invalidateLayoutState(true);

    void relayoutAll();

  },

  { deep: true },

);



watch(

  () => props.layoutSeed,

  (next) => {

    const n = next ?? 0;

    if (n === activeLayoutSeed.value) return;

    activeLayoutSeed.value = n;

    cachedLayout.value = null;

    layoutCacheKey.value = "";

    void relayoutAll();

  },

);



watch(

  () => [props.wordcloudFontFamily, props.wordcloudAngleMode] as const,

  () => {

    cachedLayout.value = null;

    layoutCacheKey.value = "";

    void relayoutAll();

  },

);



watch(

  () => props.wordcloudPaletteId,

  () => {

    scheduleRedraw(expanded.value);

  },

);



onMounted(() => {

  void paintCanvas(canvasRef.value, false, true);

  if (previewViewportRef.value) {

    inlineObserver = new ResizeObserver(() => scheduleRedraw(false));

    inlineObserver.observe(previewViewportRef.value);

  }

  window.addEventListener("keydown", onKeydown);

  document.addEventListener("pointerdown", onToolbarMenuPointerDown, true);

});



watch(expanded, (v) => {

  if (v) {

    void nextTick(() => scheduleRedraw(true));

  }

});



onBeforeUnmount(() => {

  inlineObserver?.disconnect();

  window.removeEventListener("keydown", onKeydown);

  document.removeEventListener("pointerdown", onToolbarMenuPointerDown, true);

});

</script>



<template>

  <div class="aiWordcloud" :class="{ 'aiWordcloud--preview': preview }">

    <template v-if="preview">

      <div v-if="displayTitle" class="aiWordcloud__previewHead" :title="title">

        <span class="aiWordcloud__previewLeadIcon" aria-hidden="true">

          <span class="svg aiWordcloud__previewIcon" v-html="icons.wordcloud" />

        </span>

        <span class="aiWordcloud__previewTitle">{{ displayTitle }}</span>

      </div>

      <div

        ref="previewViewportRef"

        class="aiWordcloud__viewport aiWordcloud__viewport--preview"

        role="button"

        tabindex="0"

        title="点击放大查看词云"

        @mousedown.prevent

        @click="openFullscreen"

        @keydown="onPreviewKeydown"

      >

        <canvas ref="canvasRef" class="aiWordcloud__canvas aiWordcloud__canvas--preview" />

      </div>

    </template>



    <Teleport to="body">

      <Transition name="aiWordcloudFullscreen" @after-leave="blurPreviewFocus">

        <div

          v-if="expanded"

          class="aiWordcloudFullscreen"

          role="dialog"

          aria-modal="true"

          :aria-label="displayTitle"

        >

          <div

            class="aiWordcloudFullscreen__backdrop"

            aria-hidden="true"

            @click="closeFullscreen"

          />

          <div class="aiWordcloudFullscreen__panel">

            <div class="aiWordcloudFullscreen__toolbar">

              <div class="aiWordcloudFullscreen__titleLead">

                <span class="aiWordcloud__previewLeadIcon" aria-hidden="true">

                  <span class="svg aiWordcloud__previewIcon" v-html="icons.wordcloud" />

                </span>

                <span class="aiWordcloudFullscreen__title" :title="title">{{

                  displayTitle

                }}</span>

              </div>

              <div class="aiWordcloudFullscreen__actions">

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

                  class="aiWordcloudFullscreen__toolbarSep"

                  role="separator"

                  aria-hidden="true"

                />

                <FontPicker

                  class="aiWordcloudFullscreen__fontPicker"

                  :monaco-font-family="wordcloudFontFamily"

                  @set-monaco-font="onWordcloudFontChange"

                />

                <div

                  ref="angleMenuRootEl"

                  class="aiWordcloudFullscreen__anglePicker"

                >

                  <button

                    type="button"

                    class="aiActivityLikeBtn"

                    :class="{ 'aiActivityLikeBtn--active': angleMenuOpen }"

                    :title="`角度：${angleModeLabel}`"

                    :aria-label="`角度：${angleModeLabel}`"

                    :aria-expanded="angleMenuOpen"

                    aria-haspopup="menu"

                    @click.stop="toggleAngleMenu"

                  >

                    <span class="svg" v-html="icons.wordcloudAngle" />

                  </button>

                  <div

                    v-if="angleMenuOpen"

                    class="aiWordcloudFullscreen__angleMenu"

                    role="menu"

                    @click.stop

                  >

                    <button

                      v-for="opt in WORDCLOUD_ANGLE_OPTIONS"

                      :key="opt.value"

                      type="button"

                      class="aiWordcloudFullscreen__angleMenuItem"

                      :class="{

                        'aiWordcloudFullscreen__angleMenuItem--active':

                          wordcloudAngleMode === opt.value,

                      }"

                      role="menuitemradio"

                      :aria-checked="wordcloudAngleMode === opt.value"

                      @click="chooseAngleMode(opt.value)"

                    >

                      {{ opt.label }}

                    </button>

                  </div>

                </div>

                <div

                  ref="paletteMenuRootEl"

                  class="aiWordcloudFullscreen__palettePicker"

                >

                  <IconButton

                    class="aiWordcloudFullscreen__paletteBtn"

                    :icon-html="icons.palette"

                    multicolor

                    :active="paletteMenuOpen"

                    :pressed="paletteMenuOpen"

                    :title="`配色：${paletteModeLabel}`"

                    :aria-label="`配色：${paletteModeLabel}`"

                    @click.stop="togglePaletteMenu"

                  />

                  <div

                    v-if="paletteMenuOpen"

                    class="aiWordcloudFullscreen__paletteMenu"

                    role="menu"

                    @click.stop

                  >

                    <button

                      v-for="palette in WORDCLOUD_PALETTES"

                      :key="palette.id"

                      type="button"

                      class="aiWordcloudFullscreen__paletteMenuItem"

                      :class="{

                        'aiWordcloudFullscreen__paletteMenuItem--active':

                          wordcloudPaletteId === palette.id,

                      }"

                      role="menuitemradio"

                      :aria-checked="wordcloudPaletteId === palette.id"

                      @click="choosePalette(palette.id)"

                    >

                      {{ palette.label }}

                    </button>

                  </div>

                </div>

                <button

                  type="button"

                  class="aiActivityLikeBtn"

                  title="重新生成"

                  aria-label="重新生成"

                  @click="handleRegenerate"

                >

                  <span class="svg" v-html="icons.refresh" />

                </button>

                <span

                  class="aiWordcloudFullscreen__toolbarSep"

                  role="separator"

                  aria-hidden="true"

                />

                <button

                  type="button"

                  class="aiActivityLikeBtn"

                  title="导出 PNG"

                  aria-label="导出 PNG"

                  @click="handleDownload"

                >

                  <span class="svg" v-html="icons.download" />

                </button>

                <button

                  type="button"

                  class="aiActivityLikeBtn aiWordcloudFullscreen__closeBtn"

                  title="关闭"

                  aria-label="关闭"

                  @click="closeFullscreen"

                >

                  <span class="svg" v-html="icons.close" />

                </button>

              </div>

            </div>

            <div

              class="aiWordcloudFullscreen__viewport"

              @wheel.prevent="onWheel"

              @pointerdown="onPointerDown"

              @pointermove="onPointerMove"

              @pointerup="onPointerUp"

              @pointercancel="onPointerUp"

            >

              <canvas ref="fullscreenCanvasRef" class="aiWordcloud__canvas" />

            </div>

            <div class="aiWordcloudFullscreen__footer">

              <p v-if="statsLine" class="aiWordcloudFullscreen__stats">

                {{ statsLine }}

              </p>

              <p class="aiWordcloudFullscreen__hint">

                拖动移动 · 滚轮缩放 · 重新生成可换布局

              </p>

            </div>

          </div>

        </div>

      </Transition>

    </Teleport>

  </div>

</template>



<style scoped>

.aiWordcloud {

  margin-top: 8px;

  border: 1px solid var(--border);

  border-radius: 8px;

  background: var(--panel, #f3f3f3);

  overflow: hidden;

  min-width: 0;

  max-width: 100%;

  box-sizing: border-box;

}



.aiWordcloud--preview {

  margin-top: 0;

  margin-bottom: 10px;

  user-select: none;

  -webkit-user-select: none;

}



.aiWordcloud__previewHead {

  display: flex;

  align-items: center;

  gap: 6px;

  padding: 6px 10px;

  border-bottom: 1px solid var(--border);

  min-width: 0;

}



.aiWordcloud__previewLeadIcon {

  display: inline-flex;

  flex-shrink: 0;

  align-items: center;

  justify-content: center;

  width: 18px;

  height: 18px;

}



.aiWordcloud__previewLeadIcon :deep(svg) {

  width: 16px;

  height: 16px;

  display: block;

}



.aiWordcloud__previewLeadIcon :deep(.aiWordcloud__previewIcon svg path) {

  fill: currentColor;

}



.aiWordcloud__previewTitle {

  font-size: 13px;

  font-weight: 600;

  color: var(--fg, #333);

  white-space: nowrap;

  overflow: hidden;

  text-overflow: ellipsis;

}



.aiWordcloud__viewport {

  position: relative;

  width: 100%;

  overflow: hidden;

  background: var(--panel, #f3f3f3);

}



.aiWordcloud__viewport--preview {

  aspect-ratio: 3 / 2;

  height: auto;

  min-height: 120px;

  max-height: 420px;

  cursor: pointer;

  pointer-events: auto;

}



.aiWordcloud__viewport--preview:focus-visible {

  outline: 2px solid var(--accent, #0078d4);

  outline-offset: -2px;

}



.aiWordcloud__canvas {

  display: block;

  width: 100%;

  height: 100%;

}



.aiWordcloud__canvas--preview {

  pointer-events: none;

}



.aiWordcloudFullscreen-enter-active,

.aiWordcloudFullscreen-leave-active {

  transition: opacity 0.22s ease;

}



.aiWordcloudFullscreen-enter-from,

.aiWordcloudFullscreen-leave-to {

  opacity: 0;

}



.aiWordcloudFullscreen-enter-active .aiWordcloudFullscreen__panel,

.aiWordcloudFullscreen-leave-active .aiWordcloudFullscreen__panel {

  transform-origin: center center;

  transition:

    transform 0.22s ease-out,

    opacity 0.2s ease-out;

}



.aiWordcloudFullscreen-enter-from .aiWordcloudFullscreen__panel {

  transform: scale(0.9);

  opacity: 0;

}



.aiWordcloudFullscreen-leave-to .aiWordcloudFullscreen__panel {

  transform: scale(0.96);

  opacity: 0;

}



.aiWordcloudFullscreen {

  position: fixed;

  inset: 0;

  z-index: 10000;

  display: flex;

  align-items: center;

  justify-content: center;

  padding: 6vh 4vw;

  box-sizing: border-box;

}



.aiWordcloudFullscreen__backdrop {

  position: absolute;

  inset: 0;

  background: rgba(0, 0, 0, 0.45);

}



.aiWordcloudFullscreen__panel {

  position: relative;

  z-index: 1;

  width: min(100%, calc((100vh - 12vh) * 1.5));

  aspect-ratio: 3 / 2;

  max-height: calc(100vh - 12vh);

  min-width: 0;

  min-height: 0;

  display: flex;

  flex-direction: column;

  border-radius: 12px;

  border: 1px solid var(--border);

  background: var(--panel, #f3f3f3);

  color: var(--fg, #333);

  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);

  overflow: visible;

}



.aiWordcloudFullscreen__toolbar {

  display: flex;

  align-items: center;

  justify-content: space-between;

  gap: 8px;

  padding: 6px 10px 6px 6px;

  border-bottom: 1px solid var(--border);

  background: var(--bg, #f8f8f8);

  flex-shrink: 0;

  position: relative;

  z-index: 2;

  overflow: visible;

}



.aiWordcloudFullscreen__titleLead {

  display: flex;

  align-items: center;

  gap: 6px;

  flex: 1;

  min-width: 0;

}



.aiWordcloudFullscreen__title {

  flex: 1;

  min-width: 0;

  font-size: 12px;

  font-weight: 600;

  white-space: nowrap;

  overflow: hidden;

  text-overflow: ellipsis;

}



.aiWordcloudFullscreen__actions {

  display: flex;

  align-items: center;

  gap: 6px;

  flex-shrink: 0;

}



.aiWordcloudFullscreen__actions .aiActivityLikeBtn {

  color: var(--icon-btn-fg, #1e1e1e);

}



.aiWordcloudFullscreen__actions .aiActivityLikeBtn:hover:not(:disabled) {

  color: var(--icon-btn-fg, #1e1e1e);

}



.aiWordcloudFullscreen__actions .aiActivityLikeBtn .svg :deep(svg path) {

  fill: currentColor;

}



.aiWordcloudFullscreen__actions .aiActivityLikeBtn--active {

  background: var(--icon-btn-bg-active);

}



.aiWordcloudFullscreen__toolbarSep {

  width: 1px;

  height: 16px;

  flex-shrink: 0;

  background: var(--border);

}



.aiWordcloudFullscreen__fontPicker {

  position: relative;

  display: inline-flex;

}



.aiWordcloudFullscreen__fontPicker :deep(.iconBtn) {

  width: 24px;

  height: 24px;

  border-radius: 6px;

  color: var(--icon-btn-fg, #1e1e1e);

}



.aiWordcloudFullscreen__fontPicker :deep(.iconBtn:hover:not(:disabled)) {

  background: var(--icon-btn-bg-hover);

}



.aiWordcloudFullscreen__fontPicker :deep(.iconBtn.active) {

  background: var(--icon-btn-bg-active);

}



/* font_family.svg 同 16px 下比工具栏其它图标更显大，词云全屏内略缩小 */

.aiWordcloudFullscreen__fontPicker :deep(.icon) {

  width: 14px;

  height: 14px;

}



.aiWordcloudFullscreen__fontPicker :deep(.icon svg) {

  width: 14px;

  height: 14px;

}



.aiWordcloudFullscreen__anglePicker {

  position: relative;

  display: inline-flex;

}



.aiWordcloudFullscreen__palettePicker {

  position: relative;

  display: inline-flex;

}



.aiWordcloudFullscreen__palettePicker :deep(.iconBtn) {

  width: 24px;

  height: 24px;

  border-radius: 6px;

}



.aiWordcloudFullscreen__angleMenu,
.aiWordcloudFullscreen__paletteMenu {

  position: absolute;

  top: calc(100% + 6px);

  left: 50%;

  transform: translateX(-50%);

  z-index: 3;

  box-sizing: border-box;

  width: max-content;

  min-width: 120px;

  padding: 6px;

  border: 1px solid var(--border);

  border-radius: 6px;

  background: var(--bg);

  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);

  display: flex;

  flex-direction: column;

  gap: 4px;

}



.aiWordcloudFullscreen__angleMenu::before,
.aiWordcloudFullscreen__angleMenu::after,
.aiWordcloudFullscreen__paletteMenu::before,
.aiWordcloudFullscreen__paletteMenu::after {

  content: "";

  position: absolute;

  left: 50%;

  transform: translateX(-50%);

  width: 0;

  height: 0;

  pointer-events: none;

}



.aiWordcloudFullscreen__angleMenu::before,
.aiWordcloudFullscreen__paletteMenu::before {

  top: -8px;

  border-left: 8px solid transparent;

  border-right: 8px solid transparent;

  border-bottom: 8px solid var(--border);

}



.aiWordcloudFullscreen__angleMenu::after,
.aiWordcloudFullscreen__paletteMenu::after {

  top: -7px;

  border-left: 7px solid transparent;

  border-right: 7px solid transparent;

  border-bottom: 7px solid var(--bg);

}



.aiWordcloudFullscreen__angleMenuItem {

  box-sizing: border-box;

  width: 100%;

  min-height: 32px;

  display: flex;

  align-items: center;

  padding: 0 10px;

  border: none;

  border-radius: 4px;

  background: transparent;

  color: var(--list-item-fg);

  font-size: 12px;

  text-align: left;

  white-space: nowrap;

  cursor: pointer;

}



.aiWordcloudFullscreen__angleMenuItem:hover {

  background: var(--list-item-bg-hover);

}



.aiWordcloudFullscreen__angleMenuItem--active {

  color: var(--list-item-fg-active);

  background: var(--list-item-bg-active);

}



.aiWordcloudFullscreen__paletteMenuItem {

  box-sizing: border-box;

  width: 100%;

  min-height: 32px;

  display: flex;

  align-items: center;

  padding: 0 10px;

  border: none;

  border-radius: 4px;

  background: transparent;

  color: var(--list-item-fg);

  font-size: 12px;

  text-align: left;

  white-space: nowrap;

  cursor: pointer;

}



.aiWordcloudFullscreen__paletteMenuItem:hover {

  background: var(--list-item-bg-hover);

}



.aiWordcloudFullscreen__paletteMenuItem--active {

  color: var(--list-item-fg-active);

  background: var(--list-item-bg-active);

}



.aiWordcloudFullscreen__fontPicker :deep(.fontMenu) {

  z-index: 3;

}



.aiWordcloudFullscreen__viewport {

  flex: 1;

  min-height: 0;

  position: relative;

  overflow: hidden;

  touch-action: none;

  cursor: grab;

}



.aiWordcloudFullscreen__viewport:active {

  cursor: grabbing;

}



.aiWordcloudFullscreen__footer {

  display: flex;

  flex-direction: row;

  align-items: center;

  gap: 12px;

  padding: 8px 10px;

  border-top: 1px solid var(--border);

  font-size: 11px;

  color: var(--muted, #6b6b6b);

  flex-shrink: 0;

}



.aiWordcloudFullscreen__stats {

  margin: 0;

  flex-shrink: 0;

}



.aiWordcloudFullscreen__hint {

  margin: 0 0 0 auto;

  text-align: right;

}



.aiWordcloudFullscreen__closeBtn:hover:not(:disabled) {

  color: var(--danger, #c42b1c);

}



.svg :deep(svg) {

  width: 16px;

  height: 16px;

  display: block;

}

</style>


