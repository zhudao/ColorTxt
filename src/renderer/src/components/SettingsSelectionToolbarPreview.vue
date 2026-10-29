<script setup lang="ts">
import AppCheckbox from "./AppCheckbox.vue";
import { icons } from "../icons";
import type { SelectionToolbarButtons } from "../constants/selectionToolbar";
import type { ReaderLineationType } from "../stores/fileMetaStore";

const props = withDefaults(
  defineProps<{
    modelValue: SelectionToolbarButtons;
    /** 设置预览是否展示「高亮词」（与阅读器自定义高亮开关一致） */
    showHighlight: boolean;
    /**
     * 是否展示高亮词 / 划线 / 记笔记（找书设置预览为 false）。
     * 为 false 时忽略 showHighlight。
     */
    showAnnotationTools?: boolean;
    /** 是否展示「问 AI」（找书无 AI 阅读助手时为 false） */
    showAskAi?: boolean;
  }>(),
  {
    showAnnotationTools: true,
    showAskAi: true,
  },
);

const emit = defineEmits<{
  "update:modelValue": [v: SelectionToolbarButtons];
}>();

const lineationActions: Array<{
  id: string;
  label: string;
  type: ReaderLineationType;
}> = [
  { id: "marker", label: "马克笔", type: "marker" },
  { id: "wavy", label: "波浪线", type: "wavy" },
  { id: "straight", label: "直线", type: "straight" },
];

function setButton(key: keyof SelectionToolbarButtons, checked: boolean) {
  emit("update:modelValue", { ...props.modelValue, [key]: checked });
}

function toggleButton(key: keyof SelectionToolbarButtons) {
  setButton(key, !props.modelValue[key]);
}
</script>

<template>
  <div class="stbPreview" aria-label="选区工具条显示项">
    <div class="stbToolbar">
      <div
        class="stbAction stbAction--checkable"
        role="checkbox"
        :aria-checked="modelValue.copy"
        tabindex="0"
        @click="toggleButton('copy')"
        @keydown.space.prevent="toggleButton('copy')"
        @keydown.enter.prevent="toggleButton('copy')"
      >
        <AppCheckbox
          class="stbCheck"
          passive
          :model-value="modelValue.copy"
          aria-label="工具条显示复制"
        />
        <span class="stbActionIcon" aria-hidden="true" v-html="icons.copy" />
        <span class="stbActionLabel">复制</span>
      </div>

      <div
        v-if="showAnnotationTools && showHighlight"
        class="stbAction stbAction--colorIcon"
      >
        <span
          class="stbActionIcon"
          aria-hidden="true"
          v-html="icons.highlightMark"
        />
        <span class="stbActionLabel">高亮词</span>
      </div>

      <template v-if="showAnnotationTools">
        <div
          v-for="item in lineationActions"
          :key="item.id"
          class="stbAction"
        >
          <span
            class="stbActionIcon stbLineationIcon"
            :class="{
              'stbLineationIcon--marker': item.type === 'marker',
              'stbLineationIcon--wavy': item.type === 'wavy',
              'stbLineationIcon--straight': item.type === 'straight',
            }"
            aria-hidden="true"
          >
            <span
              v-if="item.type === 'marker'"
              class="stbLineationMarkerBg"
            />
            <span
              v-if="item.type === 'wavy' || item.type === 'straight'"
              class="stbLineationGlyphWrap"
            >
              <span class="stbLineationGlyph" v-html="icons.fontFamily" />
              <svg
                v-if="item.type === 'wavy'"
                class="stbLineationDeco stbLineationDeco--wavy"
                viewBox="0 0 18 4"
                width="18"
                height="3"
                aria-hidden="true"
              >
                <path
                  d="M0 3Q1.8 1 3.6 3T7.2 3T10.8 3T14.4 3T18 3"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <svg
                v-if="item.type === 'straight'"
                class="stbLineationDeco stbLineationDeco--straight"
                viewBox="0 0 16 2"
                width="16"
                height="2"
                aria-hidden="true"
              >
                <line
                  x1="0"
                  y1="1"
                  x2="16"
                  y2="1"
                  stroke="currentColor"
                  stroke-width="1.2"
                  stroke-linecap="round"
                />
              </svg>
            </span>
            <span
              v-else
              class="stbLineationGlyph"
              v-html="icons.fontFamily"
            />
          </span>
          <span class="stbActionLabel">{{ item.label }}</span>
        </div>

        <div class="stbAction">
          <span class="stbActionIcon" aria-hidden="true" v-html="icons.note" />
          <span class="stbActionLabel">记笔记</span>
        </div>
      </template>

      <div
        class="stbAction stbAction--checkable"
        role="checkbox"
        :aria-checked="modelValue.find"
        tabindex="0"
        @click="toggleButton('find')"
        @keydown.space.prevent="toggleButton('find')"
        @keydown.enter.prevent="toggleButton('find')"
      >
        <AppCheckbox
          class="stbCheck"
          passive
          :model-value="modelValue.find"
          aria-label="工具条显示查找"
        />
        <span class="stbActionIcon" aria-hidden="true" v-html="icons.find" />
        <span class="stbActionLabel">查找</span>
      </div>

      <div
        class="stbAction stbAction--checkable"
        role="checkbox"
        :aria-checked="modelValue.dictionary"
        tabindex="0"
        @click="toggleButton('dictionary')"
        @keydown.space.prevent="toggleButton('dictionary')"
        @keydown.enter.prevent="toggleButton('dictionary')"
      >
        <AppCheckbox
          class="stbCheck"
          passive
          :model-value="modelValue.dictionary"
          aria-label="工具条显示词典"
        />
        <span
          class="stbActionIcon"
          aria-hidden="true"
          v-html="icons.dictionary"
        />
        <span class="stbActionLabel">词典</span>
      </div>

      <div
        class="stbAction stbAction--checkable"
        role="checkbox"
        :aria-checked="modelValue.translate"
        tabindex="0"
        @click="toggleButton('translate')"
        @keydown.space.prevent="toggleButton('translate')"
        @keydown.enter.prevent="toggleButton('translate')"
      >
        <AppCheckbox
          class="stbCheck"
          passive
          :model-value="modelValue.translate"
          aria-label="工具条显示翻译"
        />
        <span
          class="stbActionIcon"
          aria-hidden="true"
          v-html="icons.translate"
        />
        <span class="stbActionLabel">翻译</span>
      </div>

      <div
        v-if="showAskAi"
        class="stbAction stbAction--checkable"
        role="checkbox"
        :aria-checked="modelValue.askAi"
        tabindex="0"
        @click="toggleButton('askAi')"
        @keydown.space.prevent="toggleButton('askAi')"
        @keydown.enter.prevent="toggleButton('askAi')"
      >
        <AppCheckbox
          class="stbCheck"
          passive
          :model-value="modelValue.askAi"
          aria-label="工具条显示问 AI"
        />
        <span
          class="stbActionIcon"
          aria-hidden="true"
          v-html="icons.aiChat"
        />
        <span class="stbActionLabel">问 AI</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stbPreview {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.stbToolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  box-shadow: 0 4px 16px color-mix(in srgb, #000 12%, transparent);
}

.stbAction {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 44px;
  padding: 4px 2px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg);
}

.stbAction--checkable {
  cursor: pointer;
}

.stbAction--checkable:hover {
  background: var(--icon-btn-bg-hover);
}

.stbCheck {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  gap: 0;
}

.stbActionIcon {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  color: var(--fg);
  pointer-events: none;
}

.stbActionIcon:not(.stbLineationIcon) :deep(svg) {
  width: 20px;
  height: 20px;
  display: block;
}

.stbAction:not(.stbAction--colorIcon) .stbActionIcon:not(.stbLineationIcon) :deep(svg path) {
  fill: currentColor;
}

.stbActionLabel {
  font-size: 10px;
  line-height: 1.1;
  white-space: nowrap;
  pointer-events: none;
}

.stbLineationIcon {
  position: relative;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: visible;
}

.stbLineationMarkerBg {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: 3px;
  background: color-mix(in srgb, var(--icon-btn-bg-hover) 45%, var(--bg));
}

.stbLineationGlyph {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: var(--fg);
}

.stbLineationGlyph :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.stbLineationGlyphWrap {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  line-height: 0;
  flex: 0 0 auto;
}

.stbLineationIcon--wavy .stbLineationGlyph :deep(svg),
.stbLineationIcon--straight .stbLineationGlyph :deep(svg) {
  width: 15px;
  height: 15px;
  display: block;
}

.stbLineationGlyph :deep(svg path) {
  fill: currentColor;
}

.stbLineationDeco {
  display: block;
  flex: 0 0 auto;
  width: 16px;
  color: var(--fg);
  overflow: visible;
}

.stbLineationDeco--wavy {
  width: 18px;
  height: 3px;
  margin-top: -1px;
}

.stbLineationDeco--straight {
  height: 2px;
}

.stbLineationDeco path,
.stbLineationDeco line {
  fill: none;
  stroke: currentColor;
  vector-effect: non-scaling-stroke;
}

.stbHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--muted-fg, color-mix(in srgb, var(--fg) 62%, transparent));
}
</style>
