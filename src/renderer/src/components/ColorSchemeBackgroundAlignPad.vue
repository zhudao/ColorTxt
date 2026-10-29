<script setup lang="ts">
import type { ReaderBackgroundPosition } from "../constants/readerBackground";

const modelValue = defineModel<ReaderBackgroundPosition>({ required: true });

const CELLS: readonly {
  id: ReaderBackgroundPosition;
  label: string;
}[] = [
  { id: "left top", label: "左上" },
  { id: "center top", label: "上" },
  { id: "right top", label: "右上" },
  { id: "left center", label: "左" },
  { id: "center center", label: "居中" },
  { id: "right center", label: "右" },
  { id: "left bottom", label: "左下" },
  { id: "center bottom", label: "下" },
  { id: "right bottom", label: "右下" },
];

function select(id: ReaderBackgroundPosition) {
  if (modelValue.value === id) return;
  modelValue.value = id;
}
</script>

<template>
  <div
    class="alignPad"
    role="radiogroup"
    aria-label="背景图对齐方式"
  >
    <button
      v-for="cell in CELLS"
      :key="cell.id"
      type="button"
      class="alignPadBtn"
      role="radio"
      :aria-checked="modelValue === cell.id"
      :aria-label="cell.label"
      :title="cell.label"
      :class="{ 'alignPadBtn--active': modelValue === cell.id }"
      @click="select(cell.id)"
    />
  </div>
</template>

<style scoped>
.alignPad {
  display: grid;
  grid-template-columns: repeat(3, 24px);
  grid-template-rows: repeat(3, 24px);
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}

.alignPadBtn {
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: none;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: var(--control-bg);
  cursor: pointer;
}

.alignPadBtn:nth-child(3n) {
  border-right: none;
}

.alignPadBtn:nth-child(n + 7) {
  border-bottom: none;
}

.alignPadBtn:hover:not(.alignPadBtn--active) {
  background: var(--list-item-bg-hover, var(--control-bg));
}

.alignPadBtn--active {
  z-index: 1;
  background: var(--accent);
}

.alignPadBtn:focus {
  outline: none;
}

.alignPadBtn:focus-visible {
  z-index: 2;
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
</style>
