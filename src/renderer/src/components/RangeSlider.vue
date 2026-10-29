<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

const modelValue = defineModel<number>({ required: true });

const props = withDefaults(
  defineProps<{
    min?: number;
    max?: number;
    step?: number;
    ariaLabel?: string;
    /** 是否在滑动条右侧显示当前百分比 */
    showPercent?: boolean;
    disabled?: boolean;
    /** 悬停时在滑块上方显示当前值 */
    showHoverValue?: boolean;
  }>(),
  {
    min: 0,
    max: 100,
    step: 1,
    ariaLabel: "",
    showPercent: true,
    disabled: false,
    showHoverValue: true,
  },
);

const wrapRef = ref<HTMLElement | null>(null);
const hovering = ref(false);
const tipPos = ref({ x: 0, y: 0 });

const safeRange = computed(() => Math.max(1e-9, props.max - props.min));

const progressPercent = computed(() => {
  const ratio = (modelValue.value - props.min) / safeRange.value;
  return Math.max(0, Math.min(100, ratio * 100));
});

const displayText = computed(() => {
  const v = modelValue.value;
  if (props.showPercent) return `${v}%`;
  return formatValue(v, props.step);
});

const showTip = computed(
  () => props.showHoverValue && hovering.value && !props.disabled,
);

function formatValue(v: number, step: number): string {
  const stepText = String(step);
  const dot = stepText.indexOf(".");
  const decimals = dot === -1 ? 0 : stepText.length - dot - 1;
  return Number(v.toFixed(decimals)).toString();
}

function normalize(raw: number): number {
  let v = Number.isFinite(raw) ? raw : props.min;
  if (props.step > 0) {
    v = Math.round((v - props.min) / props.step) * props.step + props.min;
  }
  v = Math.max(props.min, Math.min(props.max, v));
  return Number(v.toFixed(4));
}

function updateTipPos() {
  const wrap = wrapRef.value;
  if (!wrap) return;
  const input = wrap.querySelector<HTMLInputElement>(".rangeSliderInput");
  if (!input) return;
  const rect = input.getBoundingClientRect();
  const thumbRadius = 8;
  const travel = Math.max(0, rect.width - thumbRadius * 2);
  const ratio = progressPercent.value / 100;
  tipPos.value = {
    x: rect.left + thumbRadius + travel * ratio,
    y: rect.top,
  };
}

function onPointerEnter() {
  hovering.value = true;
  updateTipPos();
}

function onPointerMove() {
  if (!hovering.value) return;
  updateTipPos();
}

function onPointerLeave() {
  hovering.value = false;
}

function onInput(ev: Event) {
  const el = ev.target as HTMLInputElement;
  modelValue.value = normalize(el.valueAsNumber);
  updateTipPos();
}

function onChange(ev: Event) {
  const el = ev.target as HTMLInputElement;
  const next = normalize(el.valueAsNumber);
  modelValue.value = next;
  el.value = String(next);
  updateTipPos();
}

watch(progressPercent, () => {
  if (hovering.value) updateTipPos();
});

onMounted(() => {
  window.addEventListener("scroll", updateTipPos, true);
  window.addEventListener("resize", updateTipPos);
});

onUnmounted(() => {
  window.removeEventListener("scroll", updateTipPos, true);
  window.removeEventListener("resize", updateTipPos);
});
</script>

<template>
  <div
    ref="wrapRef"
    class="rangeSlider"
    :class="{ 'rangeSlider--disabled': disabled }"
    @pointerenter="onPointerEnter"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
  >
    <input
      class="rangeSliderInput"
      type="range"
      :value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      :aria-label="ariaLabel || undefined"
      :style="{ '--range-progress': `${progressPercent}%` }"
      @input="onInput"
      @change="onChange"
    />
    <span v-if="showPercent" class="rangeSliderValue">{{ displayText }}</span>

    <Teleport to="body">
      <span
        v-if="showTip"
        class="rangeSliderHoverValue"
        :style="{
          left: `${tipPos.x}px`,
          top: `${tipPos.y}px`,
        }"
        aria-hidden="true"
      >
        {{ displayText }}
      </span>
    </Teleport>
  </div>
</template>

<style scoped>
.rangeSlider {
  width: 100%;
  min-width: 80px;
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.rangeSlider--disabled {
  opacity: 0.55;
}

.rangeSliderInput {
  width: 100%;
  flex: 1 1 auto;
  height: 20px;
  margin: 0;
  appearance: none;
  background: transparent;
  cursor: pointer;
}

.rangeSlider--disabled .rangeSliderInput {
  cursor: not-allowed;
}

.rangeSliderInput::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--accent) 0%,
    var(--accent) var(--range-progress),
    var(--border) var(--range-progress),
    var(--border) 100%
  );
}

.rangeSliderInput::-webkit-slider-thumb {
  appearance: none;
  margin-top: -5px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--accent);
  background: #ffffff;
}

.rangeSliderInput::-moz-range-track {
  height: 6px;
  border-radius: 999px;
  background: var(--border);
}

.rangeSliderInput::-moz-range-progress {
  height: 6px;
  border-radius: 999px;
  background: var(--accent);
}

.rangeSliderInput::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid var(--accent);
  background: var(--btn-bg);
}

.rangeSliderValue {
  width: 36px;
  text-align: right;
  font-size: 13px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
</style>

<style>
.rangeSliderHoverValue {
  position: fixed;
  z-index: 10000;
  transform: translate(-50%, calc(-100% - 2px));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 20px;
  min-width: 30px;
  padding: 4px 6px;
  font-size: 11px;
  line-height: 1;
  border-radius: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--fg);
  box-shadow: 0 2px 8px color-mix(in srgb, #000 14%, transparent);
  white-space: nowrap;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}
</style>
