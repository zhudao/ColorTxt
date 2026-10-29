<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  hexToHsl,
  hexToHsv,
  hslToHex,
  hsvToHex,
  normalizeLooseHex6,
  type Hsl,
  type Hsv,
} from "../utils/color";
import { pickScreenColor } from "../utils/pickScreenColor";
import {
  getHexColorPickerMode,
  setHexColorPickerMode,
  type HexColorPickerMode,
} from "../utils/hexColorPickerMode";
import RadioGroup from "./RadioGroup.vue";
import IconButton from "./IconButton.vue";
import { icons } from "../icons";

type PickerMode = HexColorPickerMode;

const props = withDefaults(
  defineProps<{
    /** `#RRGGBB` */
    modelValue: string;
    disabled?: boolean;
    /** 弹层 z-index（需高于所在蒙版） */
    popoverZIndex?: number;
  }>(),
  {
    disabled: false,
    popoverZIndex: 12000,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  /** 弹层打开时草稿色变化（用于外部实时预览颜色） */
  draftHex: [value: string];
  /** 弹层关闭（确定/取消/失焦），外部应清除对该行的临时预览 */
  draftEnd: [];
}>();

const rootRef = ref<HTMLElement | null>(null);
const popRef = ref<HTMLElement | null>(null);
const svBoxRef = ref<HTMLElement | null>(null);
const hueBarRef = ref<HTMLElement | null>(null);

const popOpen = ref(false);
const pickerMode = ref<PickerMode>("hsv");
const draft = ref<Hsv>({ h: 210, s: 0.7, v: 0.9 });
const draftHsl = ref<Hsl>({ h: 210, s: 0.7, l: 0.5 });
const hexInput = ref("");
const hexInputElRef = ref<HTMLInputElement | null>(null);
const popStyle = ref<Record<string, string>>({});
/** 避免首帧高度为 0 时用 fallback 判定「贴底」、实测变矮后又改回下方导致跳动 */
const popVertPlacementLock = ref<"below" | "above" | null>(null);
const eyedropperBusy = ref(false);
let suppressOutsideCloseUntil = 0;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function clampHue(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(360, Math.max(0, n));
}

function currentDraftHex(): string {
  if (pickerMode.value === "hsl") {
    return hslToHex(draftHsl.value.h, draftHsl.value.s, draftHsl.value.l);
  }
  return hsvToHex(draft.value.h, draft.value.s, draft.value.v);
}

function applyHexToDrafts(hex: string) {
  const hsv = hexToHsv(hex);
  if (hsv) {
    if (hsv.s < 1e-4) hsv.h = draft.value.h;
    draft.value = { ...hsv };
  }
  const hsl = hexToHsl(hex);
  if (hsl) {
    if (hsl.s < 1e-4) hsl.h = draftHsl.value.h;
    draftHsl.value = { ...hsl };
  }
  hexInput.value = hex;
}

function syncDraftFromModel() {
  const hex = normalizeLooseHex6(props.modelValue) ?? props.modelValue;
  applyHexToDrafts(hex);
}

const POP_GAP = 6;
const POP_FALLBACK_W = 280;
/** 含色盘 + 滑条 + 模式切换，略估高以免误判「下方放得下」导致贴底裁切 */
const POP_FALLBACK_H = 320;

function placePopover(
  popEl?: HTMLElement | null,
  opts?: { unlock?: boolean },
) {
  const root = rootRef.value;
  const pop = popEl ?? popRef.value;
  if (!root) return;
  const r = root.getBoundingClientRect();
  const pr = pop?.getBoundingClientRect();
  const popW =
    pr && pr.width >= 1 ? pr.width : POP_FALLBACK_W;
  // scaleY(0) 入场时高度接近 0，不可信
  const measuredH = pr && pr.height >= 40 ? pr.height : 0;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let placement: "below" | "above";
  if (popVertPlacementLock.value !== null && !opts?.unlock) {
    placement = popVertPlacementLock.value;
  } else {
    const belowTop = r.bottom + POP_GAP;
    const spaceBelow = vh - 8 - belowTop;
    const spaceAbove = r.top - POP_GAP - 8;
    // 入场用估高；unlock 时才用实测。估高偏保守，避免下方「差一点」却先往下开再被裁
    const hForFlip =
      opts?.unlock && measuredH > 0
        ? measuredH
        : Math.max(measuredH, POP_FALLBACK_H);
    if (hForFlip <= spaceBelow) placement = "below";
    else if (hForFlip <= spaceAbove) placement = "above";
    else placement = spaceAbove >= spaceBelow ? "above" : "below";
    popVertPlacementLock.value = placement;
  }

  let left = r.left + r.width / 2 - popW / 2;
  if (left + popW > vw - 8) left = Math.max(8, vw - popW - 8);
  if (left < 8) left = 8;

  /** 在上方时用 bottom 锚定底边到色块顶侧 */
  if (placement === "below") {
    let top = r.bottom + POP_GAP;
    if (top < 8) top = 8;
    popStyle.value = {
      position: "fixed",
      left: `${left}px`,
      top: `${top}px`,
      bottom: "auto",
      zIndex: String(props.popoverZIndex),
      transformOrigin: "top center",
    };
  } else {
    popStyle.value = {
      position: "fixed",
      left: `${left}px`,
      top: "auto",
      bottom: `${vh - r.top + POP_GAP}px`,
      zIndex: String(props.popoverZIndex),
      transformOrigin: "bottom center",
    };
  }
}

function onPopBeforeEnter(el: Element) {
  placePopover(el as HTMLElement);
}

function onPopAfterEnter() {
  requestAnimationFrame(() => {
    // 只微调位置，勿 unlock 改方向——否则 scaleY 展开末尾会突然从上翻到下
    placePopover();
    // 设置窗 body 可滚动：勿因 focus 滚走触发器，否则看起来像「闪一下就没了」
    hexInputElRef.value?.focus({ preventScroll: true });
  });
}

function openPop() {
  if (props.disabled) return;
  pickerMode.value = getHexColorPickerMode();
  syncDraftFromModel();
  popVertPlacementLock.value = null;
  popOpen.value = true;
}

function closePop() {
  popOpen.value = false;
  popVertPlacementLock.value = null;
  emit("draftEnd");
}

function togglePop() {
  if (popOpen.value) closePop();
  else openPop();
}

function onCancel() {
  syncDraftFromModel();
  closePop();
}

function onConfirm() {
  applyHexInputToDraft();
  emit("update:modelValue", currentDraftHex());
  closePop();
}

async function pickFromScreen() {
  if (props.disabled || eyedropperBusy.value) return;
  eyedropperBusy.value = true;
  let hex: string | null = null;
  try {
    hex = await pickScreenColor();
  } finally {
    eyedropperBusy.value = false;
    suppressOutsideCloseUntil = Date.now() + 400;
  }
  if (hex) {
    applyHexToDrafts(hex);
    emit("draftHex", hex);
  }
}

function setPickerMode(mode: PickerMode) {
  if (pickerMode.value === mode) return;
  const hex = currentDraftHex();
  pickerMode.value = mode;
  setHexColorPickerMode(mode);
  applyHexToDrafts(hex);
  popVertPlacementLock.value = null;
  void nextTick(() => placePopover());
}

const pickerModeModel = computed({
  get: () => pickerMode.value,
  set: (v: string) => setPickerMode(v as PickerMode),
});

const pickerModeOptions = [
  { id: "hsv", label: "色盘" },
  { id: "hsl", label: "HSL" },
] as const;

function hueForCss(h: number): number {
  return ((h % 360) + 360) % 360;
}

/** 与 pickHue / 光标一致：自上而下 hue 0°→360°（线性） */
const hueBg =
  "linear-gradient(to bottom, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))";

const hslHueTrack =
  "linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))";

const svLayersStyle = computed(() => ({
  backgroundColor: `hsl(${hueForCss(draft.value.h)}, 100%, 50%)`,
}));

const svCursorStyle = computed(() => ({
  left: `${draft.value.s * 100}%`,
  top: `${(1 - draft.value.v) * 100}%`,
  transform: "translate(-50%, -50%)",
}));

const hueCursorStyle = computed(() => ({
  top: `${(draft.value.h / 360) * 100}%`,
  left: "50%",
  transform: "translate(-50%, -50%)",
}));

const hslSatTrack = computed(() => {
  const h = hueForCss(draftHsl.value.h);
  const l = Math.round(draftHsl.value.l * 100);
  return `linear-gradient(to right, hsl(${h}, 0%, ${l}%), hsl(${h}, 100%, ${l}%))`;
});

const hslLightTrack = computed(() => {
  const h = hueForCss(draftHsl.value.h);
  const s = Math.round(draftHsl.value.s * 100);
  return `linear-gradient(to right, hsl(${h}, ${s}%, 0%), hsl(${h}, ${s}%, 50%), hsl(${h}, ${s}%, 100%))`;
});

const hslHModel = computed({
  get: () => Math.round(draftHsl.value.h),
  set: (n: number) => {
    if (!Number.isFinite(n)) return;
    patchHsl({ h: clampHue(n) });
  },
});

const hslSModel = computed({
  get: () => Math.round(draftHsl.value.s * 100),
  set: (n: number) => {
    if (!Number.isFinite(n)) return;
    patchHsl({ s: clamp01(n / 100) });
  },
});

const hslLModel = computed({
  get: () => Math.round(draftHsl.value.l * 100),
  set: (n: number) => {
    if (!Number.isFinite(n)) return;
    patchHsl({ l: clamp01(n / 100) });
  },
});

function applyHslNum(channel: "h" | "s" | "l", n: number) {
  const max = channel === "h" ? 360 : 100;
  const clamped = Math.min(max, Math.max(0, Math.round(n)));
  if (channel === "h") patchHsl({ h: clamped });
  else if (channel === "s") patchHsl({ s: clamp01(clamped / 100) });
  else patchHsl({ l: clamp01(clamped / 100) });
}

function syncHslNumEl(channel: "h" | "s" | "l", el: HTMLInputElement) {
  const shown =
    channel === "h"
      ? Math.round(draftHsl.value.h)
      : channel === "s"
        ? Math.round(draftHsl.value.s * 100)
        : Math.round(draftHsl.value.l * 100);
  el.value = String(shown);
}

function onHslNumInput(channel: "h" | "s" | "l", ev: Event) {
  const el = ev.target as HTMLInputElement;
  const raw = el.value.trim();
  if (raw === "" || raw === "-") return;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    syncHslNumEl(channel, el);
    return;
  }
  const max = channel === "h" ? 360 : 100;
  applyHslNum(channel, n);
  if (n < 0 || n > max) syncHslNumEl(channel, el);
}

function onHslNumBlur(channel: "h" | "s" | "l", ev: Event) {
  const el = ev.target as HTMLInputElement;
  const raw = el.value.trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    syncHslNumEl(channel, el);
    return;
  }
  applyHslNum(channel, n);
  syncHslNumEl(channel, el);
}

function patchHsl(partial: Partial<Hsl>) {
  const next: Hsl = { ...draftHsl.value, ...partial };
  draftHsl.value = next;
  const hex = hslToHex(next.h, next.s, next.l);
  hexInput.value = hex;
  const hsv = hexToHsv(hex);
  if (hsv) {
    if (hsv.s < 1e-4) hsv.h = next.h;
    draft.value = hsv;
  }
}

/** 弹层打开时用草稿色实时预览；关闭后用已确认的 modelValue */
const swatchDisplayColor = computed(() => {
  if (!popOpen.value) return props.modelValue;
  return currentDraftHex();
});

function afterHsvPick() {
  const hex = hsvToHex(draft.value.h, draft.value.s, draft.value.v);
  hexInput.value = hex;
  const hsl = hexToHsl(hex);
  if (hsl) {
    if (hsl.s < 1e-4) hsl.h = draft.value.h;
    draftHsl.value = hsl;
  }
}

function pickSvFromEvent(ev: PointerEvent, box: HTMLElement) {
  const r = box.getBoundingClientRect();
  const x = Math.max(0, Math.min(r.width, ev.clientX - r.left));
  const y = Math.max(0, Math.min(r.height, ev.clientY - r.top));
  draft.value = {
    ...draft.value,
    s: r.width <= 0 ? 0 : x / r.width,
    v: r.height <= 0 ? 0 : 1 - y / r.height,
  };
  afterHsvPick();
}

function pickHueFromEvent(ev: PointerEvent, bar: HTMLElement) {
  const r = bar.getBoundingClientRect();
  const y = Math.max(0, Math.min(r.height, ev.clientY - r.top));
  const t = r.height <= 0 ? 0 : y / r.height;
  /** 底部 t=1 对应 h=360（与顶部 h=0 同色），勿改为 0，否则滑块会跳到顶端 */
  const h = t * 360;
  draft.value = {
    ...draft.value,
    h,
  };
  afterHsvPick();
}

let svDragging = false;
let hueDragging = false;

function blurHexInput() {
  hexInputElRef.value?.blur();
}

function onSvPointerDown(ev: PointerEvent) {
  const box = svBoxRef.value;
  if (!box) return;
  blurHexInput();
  ev.preventDefault();
  ev.stopPropagation();
  svDragging = true;
  box.setPointerCapture(ev.pointerId);
  pickSvFromEvent(ev, box);
}

function onSvPointerMove(ev: PointerEvent) {
  if (!svDragging) return;
  const box = svBoxRef.value;
  if (!box) return;
  pickSvFromEvent(ev, box);
}

function onSvPointerUp(ev: PointerEvent) {
  if (!svDragging) return;
  svDragging = false;
  try {
    svBoxRef.value?.releasePointerCapture(ev.pointerId);
  } catch {
    // ignore
  }
}

function onHuePointerDown(ev: PointerEvent) {
  const bar = hueBarRef.value;
  if (!bar) return;
  blurHexInput();
  ev.preventDefault();
  ev.stopPropagation();
  hueDragging = true;
  bar.setPointerCapture(ev.pointerId);
  pickHueFromEvent(ev, bar);
}

function onHuePointerMove(ev: PointerEvent) {
  if (!hueDragging) return;
  const bar = hueBarRef.value;
  if (!bar) return;
  pickHueFromEvent(ev, bar);
}

function onHuePointerUp(ev: PointerEvent) {
  if (!hueDragging) return;
  hueDragging = false;
  try {
    hueBarRef.value?.releasePointerCapture(ev.pointerId);
  } catch {
    // ignore
  }
}

function applyHexInputToDraft() {
  const raw = hexInput.value.trim();
  const canonical = normalizeLooseHex6(raw);
  if (!canonical) return;
  applyHexToDrafts(canonical);
}

function onDocPointerDown(ev: PointerEvent) {
  if (!popOpen.value) return;
  if (Date.now() < suppressOutsideCloseUntil) return;
  const t = ev.target as Node | null;
  if (!t) return;
  if (rootRef.value?.contains(t) || popRef.value?.contains(t)) return;
  onCancel();
}

function onWinResize() {
  if (!popOpen.value) return;
  popVertPlacementLock.value = null;
  placePopover();
}

watch(
  () => props.modelValue,
  () => {
    if (!popOpen.value) return;
    hexInput.value = props.modelValue;
  },
);

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled && popOpen.value) onCancel();
  },
);

watch(
  [draft, draftHsl, pickerMode],
  () => {
    if (!popOpen.value) return;
    emit("draftHex", currentDraftHex());
  },
  { deep: true },
);

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown, true);
  window.addEventListener("resize", onWinResize);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  window.removeEventListener("resize", onWinResize);
});
</script>

<template>
  <div ref="rootRef" class="hexColorPicker">
    <button
      type="button"
      class="hexColorPickerTrigger"
      :class="{ 'hexColorPickerTrigger--open': popOpen }"
      :disabled="disabled"
      :aria-expanded="popOpen"
      aria-haspopup="dialog"
      :title="swatchDisplayColor"
      @click.stop="togglePop"
    >
      <span
        class="hexColorPickerSwatch"
        :style="{ backgroundColor: swatchDisplayColor }"
      />
    </button>
    <Teleport to="body">
      <Transition
        name="hexPickerPop"
        @before-enter="onPopBeforeEnter"
        @after-enter="onPopAfterEnter"
      >
        <div
          v-if="popOpen"
          ref="popRef"
          class="hexColorPickerPop"
          :style="popStyle"
          role="dialog"
          aria-label="选择颜色"
          @click.stop
        >
          <div class="hexColorPickerModes">
            <RadioGroup
              v-model="pickerModeModel"
              size="sm"
              aria-label="取色方式"
              :options="pickerModeOptions"
            />
          </div>
          <div v-if="pickerMode === 'hsv'" class="hexColorPickerMain">
            <div
              ref="svBoxRef"
              class="hexColorPickerSv"
              :style="svLayersStyle"
              @pointerdown="onSvPointerDown"
              @pointermove="onSvPointerMove"
              @pointerup="onSvPointerUp"
              @pointercancel="onSvPointerUp"
            >
              <div class="hexColorPickerSvWhite" />
              <div class="hexColorPickerSvBlack" />
              <div class="hexColorPickerSvCursor" :style="svCursorStyle" />
            </div>
            <div
              ref="hueBarRef"
              class="hexColorPickerHue"
              :style="{ background: hueBg }"
              @pointerdown="onHuePointerDown"
              @pointermove="onHuePointerMove"
              @pointerup="onHuePointerUp"
              @pointercancel="onHuePointerUp"
            >
              <div class="hexColorPickerHueCursor" :style="hueCursorStyle" />
            </div>
          </div>
          <div v-else class="hexColorPickerHsl">
            <label class="hexColorPickerHslRow">
              <span class="hexColorPickerHslLabel">H</span>
              <input
                v-model.number="hslHModel"
                class="hexColorPickerHslRange"
                type="range"
                min="0"
                max="360"
                step="1"
                aria-label="色相"
                :style="{ '--hsl-track': hslHueTrack }"
              />
              <input
                :value="hslHModel"
                class="hexColorPickerHslNum"
                type="number"
                min="0"
                max="360"
                step="1"
                aria-label="色相数值"
                @input="onHslNumInput('h', $event)"
                @change="onHslNumBlur('h', $event)"
                @blur="onHslNumBlur('h', $event)"
              />
            </label>
            <label class="hexColorPickerHslRow">
              <span class="hexColorPickerHslLabel">S</span>
              <input
                v-model.number="hslSModel"
                class="hexColorPickerHslRange"
                type="range"
                min="0"
                max="100"
                step="1"
                aria-label="饱和度"
                :style="{ '--hsl-track': hslSatTrack }"
              />
              <input
                :value="hslSModel"
                class="hexColorPickerHslNum"
                type="number"
                min="0"
                max="100"
                step="1"
                aria-label="饱和度数值"
                @input="onHslNumInput('s', $event)"
                @change="onHslNumBlur('s', $event)"
                @blur="onHslNumBlur('s', $event)"
              />
            </label>
            <label class="hexColorPickerHslRow">
              <span class="hexColorPickerHslLabel">L</span>
              <input
                v-model.number="hslLModel"
                class="hexColorPickerHslRange"
                type="range"
                min="0"
                max="100"
                step="1"
                aria-label="亮度"
                :style="{ '--hsl-track': hslLightTrack }"
              />
              <input
                :value="hslLModel"
                class="hexColorPickerHslNum"
                type="number"
                min="0"
                max="100"
                step="1"
                aria-label="亮度数值"
                @input="onHslNumInput('l', $event)"
                @change="onHslNumBlur('l', $event)"
                @blur="onHslNumBlur('l', $event)"
              />
            </label>
          </div>
          <div class="hexColorPickerFooter">
            <input
              ref="hexInputElRef"
              v-model="hexInput"
              class="hexColorPickerHexInput"
              type="text"
              spellcheck="false"
              maxlength="7"
              aria-label="十六进制色值"
              @change="applyHexInputToDraft"
              @keyup.enter="applyHexInputToDraft"
            />
            <IconButton
              class="hexColorPickerDropper"
              :icon-html="icons.eyedropper"
              title="从屏幕取色"
              aria-label="从屏幕取色"
              :disabled="eyedropperBusy"
              @click.stop="pickFromScreen"
            />
            <div class="hexColorPickerActions">
              <button type="button" class="hexColorPickerBtnText" @click="onCancel">
                取消
              </button>
              <button type="button" class="btn" @click="onConfirm">
                确定
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.hexColorPicker {
  display: inline-flex;
  vertical-align: middle;
}

.hexColorPickerTrigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 4px;
  box-sizing: border-box;
  border-radius: 6px;
  border: 1px solid var(--border, #dcdfe6);
  background: var(--panel, #fff);
  cursor: pointer;
}

.hexColorPickerTrigger--open {
  border-color: var(--accent, #409eff);
}

.hexColorPickerTrigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.hexColorPickerSwatch {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1 1 0;
  aspect-ratio: 1;
  border-radius: 2px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}

.hexColorPickerPop {
  --picker-handle-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.28),
    0 1px 2px rgba(0, 0, 0, 0.22);

  width: 280px;
  padding: 12px;
  border-radius: 8px;
  background: var(--panel, #fff);
  border: 1px solid var(--border, #e4e7ed);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  overflow: visible;
}

.hexColorPickerModes {
  margin-bottom: 10px;
}

.hexColorPickerModes :deep(.radioGroup) {
  display: flex;
  width: 100%;
}

.hexColorPickerModes :deep(.radioGroupOption) {
  flex: 1;
  text-align: center;
}

.hexColorPickerHsl {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.hexColorPickerHslRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hexColorPickerHslLabel {
  flex-shrink: 0;
  width: 12px;
  font-size: 12px;
  font-family: ui-monospace, monospace;
  color: var(--muted, #909399);
}

.hexColorPickerHslRange {
  flex: 1;
  min-width: 0;
  height: 16px;
  margin: 0;
  appearance: none;
  background: transparent;
  outline: none;
  cursor: pointer;
}

.hexColorPickerHslRange::-webkit-slider-runnable-track {
  height: 8px;
  border-radius: 999px;
  background: var(--hsl-track);
}

.hexColorPickerHslRange::-moz-range-track {
  height: 8px;
  border-radius: 999px;
  background: var(--hsl-track);
  border: none;
}

.hexColorPickerHslNum::-webkit-inner-spin-button,
.hexColorPickerHslNum::-webkit-outer-spin-button {
  appearance: none;
}

.hexColorPickerHslRange::-webkit-slider-thumb {
  appearance: none;
  margin-top: -2px;
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  border-radius: 50%;
  background: #fff;
  border: 0.5px solid rgba(0, 0, 0, 0.2);
  box-shadow: var(--picker-handle-shadow);
}

.hexColorPickerHslRange::-moz-range-thumb {
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  border-radius: 50%;
  background: #fff;
  border: 0.5px solid rgba(0, 0, 0, 0.2);
  box-shadow: var(--picker-handle-shadow);
}

.hexColorPickerHslNum {
  flex-shrink: 0;
  width: 44px;
  height: 26px;
  padding: 0 4px;
  box-sizing: border-box;
  font-size: 12px;
  font-family: ui-monospace, monospace;
  text-align: right;
}

.hexPickerPop-enter-active,
.hexPickerPop-leave-active {
  transition: transform 0.2s cubic-bezier(0.33, 1, 0.68, 1);
}

.hexPickerPop-enter-from,
.hexPickerPop-leave-to {
  transform: scaleY(0);
}

.hexPickerPop-enter-to,
.hexPickerPop-leave-from {
  transform: scaleY(1);
}

.hexColorPickerMain {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}

.hexColorPickerSv {
  position: relative;
  flex: 1;
  height: 140px;
  border-radius: 0;
  overflow: visible;
  cursor: crosshair;
  touch-action: none;
}

.hexColorPickerSvWhite {
  position: absolute;
  inset: 0;
  background: linear-gradient(to right, #fff, rgba(255, 255, 255, 0));
  pointer-events: none;
}

.hexColorPickerSvBlack {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, #000, rgba(0, 0, 0, 0));
  pointer-events: none;
}

.hexColorPickerSvCursor {
  position: absolute;
  z-index: 2;
  width: 8px;
  height: 8px;
  box-sizing: border-box;
  border: 1.5px solid #fff;
  border-radius: 50%;
  background: transparent;
  box-shadow:
    var(--picker-handle-shadow),
    inset 0 0 0 1px rgba(0, 0, 0, 0.22);
  pointer-events: none;
}

.hexColorPickerHue {
  position: relative;
  flex-shrink: 0;
  width: 12px;
  height: 140px;
  border-radius: 0;
  overflow: visible;
  cursor: ns-resize;
  touch-action: none;
}

.hexColorPickerHueCursor {
  position: absolute;
  z-index: 2;
  width: 14px;
  height: 4px;
  margin-left: 0;
  box-sizing: border-box;
  border-radius: 999px;
  background: #fff;
  border: 0.5px solid rgba(0, 0, 0, 0.2);
  box-shadow: var(--picker-handle-shadow);
  pointer-events: none;
}

.hexColorPickerFooter {
  display: flex;
  align-items: center;
  gap: 10px;
}

.hexColorPickerHexInput {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  font-size: 13px;
  font-family: ui-monospace, monospace;
}

.hexColorPickerDropper {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
}

.hexColorPickerActions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.hexColorPickerBtnText {
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--icon-btn-fg);
  font-size: 13px;
  cursor: pointer;
  transition: 0.1s;
}

.hexColorPickerBtnText:hover {
  background: var(--icon-btn-bg-hover);
}
</style>
