<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from "vue";
import { icons } from "../icons";
import {
  BUILTIN_READER_TEXTURES,
  READER_BACKGROUND_NONE_ID,
  resolveBuiltinReaderTextureUrl,
} from "../constants/readerBuiltins";
import type { ReaderCustomBackground } from "../constants/readerBackground";

const props = defineProps<{
  textureId: string;
  custom: readonly ReaderCustomBackground[];
  customUrlById: Record<string, string>;
  /** 当前选中配色方案的阅读器背景色（不是已应用到阅读器的 `--reader-bg`） */
  surfaceBg: string;
}>();

const emit = defineEmits<{
  select: [id: string];
  deleteCustom: [id: string];
}>();

const rootRef = useTemplateRef<HTMLElement>("root");

function thumbStyle(url: string): Record<string, string> {
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: "100% auto",
    backgroundPosition: "top center",
  };
}

function onThumbKeydown(ev: KeyboardEvent, id: string) {
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    emit("select", id);
  }
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const overflowY = style.overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

function isLaidOut(el: HTMLElement): boolean {
  if (el.getClientRects().length === 0) return false;
  return getComputedStyle(el).visibility !== "hidden";
}

function scrollActiveIntoView() {
  const root = rootRef.value;
  if (!root) return;
  const el = root.querySelector(
    `[data-texture-id="${CSS.escape(props.textureId)}"]`,
  );
  if (!(el instanceof HTMLElement) || !isLaidOut(el)) return;
  const scroller = scrollParent(el);
  if (!scroller) {
    el.scrollIntoView({ block: "center", inline: "nearest" });
    return;
  }
  if (!isLaidOut(scroller)) return;
  const er = el.getBoundingClientRect();
  const sr = scroller.getBoundingClientRect();
  const layoutH = scroller.clientHeight;
  const scale = layoutH > 0 && sr.height > 0 ? sr.height / layoutH : 1;
  const elMid = (er.top + er.bottom) / 2;
  const scrollerMid = (sr.top + sr.bottom) / 2;
  scroller.scrollTop += (elMid - scrollerMid) / scale;
}

async function scheduleScrollActiveIntoView() {
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      scrollActiveIntoView();
      resolve();
    });
  });
}

watch(
  () => props.textureId,
  async () => {
    await nextTick();
    const root = rootRef.value;
    if (!root) return;
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !root.contains(focused)) return;
    if (!focused.closest(".bgPickerThumb")) return;
    const selected = root.querySelector(
      `[data-texture-id="${CSS.escape(props.textureId)}"] .bgPickerThumb`,
    );
    if (!(selected instanceof HTMLElement) || selected === focused) return;
    selected.focus({ preventScroll: true });
  },
);

defineExpose({ scrollActiveIntoView, scheduleScrollActiveIntoView });
</script>

<template>
  <div
    ref="root"
    class="bgPicker"
    :style="{ '--bg-picker-surface': surfaceBg }"
  >
    <div class="bgPickerGrid" role="listbox" aria-label="背景图">
      <div
        v-for="t in BUILTIN_READER_TEXTURES"
        :key="t.id"
        class="bgPickerThumbWrap"
        :data-texture-id="t.id"
      >
        <button
          type="button"
          class="bgPickerThumb"
          role="option"
          :class="{ 'bgPickerThumb--active': textureId === t.id }"
          :aria-selected="textureId === t.id"
          :aria-label="t.name"
          @click="emit('select', t.id)"
        >
          <span
            v-if="t.id !== READER_BACKGROUND_NONE_ID"
            class="bgPickerThumbFill"
            :style="thumbStyle(resolveBuiltinReaderTextureUrl(t.url))"
            aria-hidden="true"
          />
          <span class="bgPickerThumbName" :title="t.name">{{ t.name }}</span>
        </button>
      </div>
      <div
        v-for="c in custom"
        :key="c.id"
        class="bgPickerThumbWrap"
        :data-texture-id="c.id"
      >
        <div
          class="bgPickerThumb"
          role="option"
          tabindex="0"
          :class="{ 'bgPickerThumb--active': textureId === c.id }"
          :aria-selected="textureId === c.id"
          :aria-label="c.name"
          @click="emit('select', c.id)"
          @keydown="onThumbKeydown($event, c.id)"
        >
          <span
            v-if="customUrlById[c.id]"
            class="bgPickerThumbFill"
            :style="thumbStyle(customUrlById[c.id]!)"
            aria-hidden="true"
          />
          <span class="bgPickerThumbName bgPickerThumbName--custom">
            <span class="bgPickerThumbNameSpacer" aria-hidden="true" />
            <span class="bgPickerThumbNameText" :title="c.name">{{
              c.name
            }}</span>
            <button
              type="button"
              class="bgPickerDelete"
              :aria-label="`移除 ${c.name}`"
              title="移除"
              @click.stop="emit('deleteCustom', c.id)"
            >
              <span aria-hidden="true" v-html="icons.remove" />
            </button>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bgPicker {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.bgPickerGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.bgPickerThumbWrap {
  position: relative;
  min-width: 0;
  scroll-margin-block: 10px;
}

.bgPickerThumb {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-height: 92px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-end;
  font: inherit;
  text-align: center;
  background-color: var(--bg-picker-surface);
}

.bgPickerThumbFill {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-repeat: no-repeat;
}

.bgPickerThumb:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.14);
}

.bgPickerThumb--active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 1px 4px rgba(0, 0, 0, 0.1);
}

.bgPickerThumb:focus {
  outline: none;
}

.bgPickerThumb:focus-visible:not(.bgPickerThumb--active) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.bgPickerThumb--active:hover,
.bgPickerThumb--active:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 2px 8px rgba(0, 0, 0, 0.14);
}

.bgPickerThumbName {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  width: 100%;
  padding: 8px 12px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--fg);
  background: transparent;
}

.bgPickerThumbName::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background: var(--bg);
  opacity: 0.55;
}

.bgPickerThumbName--custom {
  padding: 6px 6px 6px 8px;
  gap: 2px;
}

.bgPickerThumbNameText {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bgPickerThumbNameSpacer,
.bgPickerDelete {
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
}

.bgPickerDelete {
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.bgPickerDelete:hover,
.bgPickerDelete:focus-visible {
  color: var(--danger);
  outline: none;
}

.bgPickerDelete :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;
}

.bgPickerDelete :deep(path) {
  fill: currentColor;
}
</style>
