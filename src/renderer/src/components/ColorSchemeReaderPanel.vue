<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { StyleValue } from "vue";
import HexColorPickerField from "./HexColorPickerField.vue";
import IconButton from "./IconButton.vue";
import SwitchToggle from "./SwitchToggle.vue";
import ColorSchemeBackgroundPicker from "./ColorSchemeBackgroundPicker.vue";
import {
  isReaderSurfaceOptionalColorKey,
  READER_SURFACE_LABELS,
  READER_SURFACE_TABLE_ROWS,
  type ReaderSurfaceColorEnabled,
  type ReaderSurfaceOptionalColorKey,
  type ReaderSurfacePalette,
} from "../constants/appUi";
import {
  getBuiltinReaderTexture,
  READER_BACKGROUND_NONE_ID,
} from "../constants/readerBuiltins";
import {
  readerBackgroundPreviewUrl,
  type ReaderCustomBackground,
} from "../constants/readerBackground";
import { icons } from "../icons";

export type ColorSchemeReaderPane = "list" | "colors" | "switches" | "bg";

const props = withDefaults(
  defineProps<{
    displaySurface: ReaderSurfacePalette;
    editingSurface: ReaderSurfacePalette;
    colorEnabled: ReaderSurfaceColorEnabled;
    previewBoxStyle: StyleValue;
    previewTextureStyle?: StyleValue;
    readerPane?: ColorSchemeReaderPane;
    backgroundTextureId?: string;
    backgroundCustom?: readonly ReaderCustomBackground[];
    backgroundCustomUrlById?: Record<string, string>;
    backgroundEnabled?: boolean;
    canEditBgOptions?: boolean;
    bgOptionsBtnTitle?: string;
    bgOptionsOpen?: boolean;
  }>(),
  {
    readerPane: "list",
    previewTextureStyle: () => ({}),
    backgroundTextureId: "none",
    backgroundCustom: () => [],
    backgroundCustomUrlById: () => ({}),
    backgroundEnabled: true,
    canEditBgOptions: false,
    bgOptionsBtnTitle: undefined,
    bgOptionsOpen: false,
  },
);

const emit = defineEmits<{
  "update-surface-key": [key: keyof ReaderSurfacePalette, color: string];
  "update-color-enabled": [key: ReaderSurfaceOptionalColorKey, enabled: boolean];
  "draft-hex": [key: keyof ReaderSurfacePalette, hex: string];
  "draft-end": [];
  "select-background": [id: string];
  "delete-background": [id: string];
  "open-background": [];
  "update-background-enabled": [enabled: boolean];
  "toggle-bg-options": [];
}>();

function switchAriaLabel(key: ReaderSurfaceOptionalColorKey): string {
  return `${READER_SURFACE_LABELS[key]}独立配色`;
}

const bgSwatchUrl = computed(() =>
  readerBackgroundPreviewUrl(
    props.backgroundTextureId,
    props.backgroundCustomUrlById,
  ),
);

const bgSwatchEmpty = computed(
  () =>
    props.backgroundTextureId === READER_BACKGROUND_NONE_ID ||
    !bgSwatchUrl.value,
);

const bgSwatchStyle = computed((): Record<string, string> => {
  if (bgSwatchEmpty.value) {
    return { backgroundImage: "none" };
  }
  return {
    backgroundImage: `url("${bgSwatchUrl.value}")`,
    backgroundSize: "contain",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
});

const bgSwatchLabel = computed(() => {
  const id = props.backgroundTextureId;
  if (id === READER_BACKGROUND_NONE_ID) return "无";
  const builtin = getBuiltinReaderTexture(id);
  if (builtin) return builtin.name;
  const custom = props.backgroundCustom.find((c) => c.id === id);
  return custom?.name ?? "背景图";
});

const showBgOptionsBtn = computed(
  () =>
    props.readerPane === "colors" &&
    props.backgroundTextureId !== READER_BACKGROUND_NONE_ID,
);

const bgScrollEl = ref<HTMLElement | null>(null);
const bgOptionsTableBtnRef = ref<HTMLElement | null>(null);
const bgPickerRef = ref<{
  scheduleScrollActiveIntoView: () => Promise<void>;
} | null>(null);

async function scrollBackgroundToBottom() {
  await nextTick();
  const el = bgScrollEl.value;
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
}

watch(
  () => props.readerPane,
  (pane) => {
    if (pane !== "bg") return;
    void bgPickerRef.value?.scheduleScrollActiveIntoView();
  },
);

defineExpose({
  scrollBackgroundToBottom,
  get bgOptionsTableBtnEl() {
    return bgOptionsTableBtnRef.value;
  },
});
</script>

<template>
  <div class="colorSchemeReader" role="tabpanel">
    <div class="readerPalettePreview" :style="previewBoxStyle">
      <div
        class="readerPalettePreviewTexture"
        :style="previewTextureStyle"
        aria-hidden="true"
      />
      <p class="readerPalettePreviewP">
        <span :style="{ color: displaySurface.chapterTitle }">第6章 实力测试</span>
      </p>
      <p class="readerPalettePreviewP">
        <span class="readerPalettePreviewIndent">　　</span>
        <span :style="{ color: displaySurface.txtrSpecialMarker }"
          >＊＊＊＊＊＊＊＊＊＊</span
        >
      </p>
      <p class="readerPalettePreviewP">
        <span class="readerPalettePreviewIndent">　　</span>
        <span :style="{ color: displaySurface.bodyText }">可靠</span>
        <span :style="{ color: displaySurface.txtrPunctuation }">《</span>
        <span :style="{ color: displaySurface.txtrBracketInner }">九重雷刀</span>
        <span :style="{ color: displaySurface.txtrPunctuation }">》</span>
        <span :style="{ color: displaySurface.bodyText }">发力方法</span>
        <span :style="{ color: displaySurface.txtrPunctuation }">，</span>
        <span :style="{ color: displaySurface.bodyText }">却达到初级战将级</span>
        <span :style="{ color: displaySurface.txtrPunctuation }">，</span>
        <span :style="{ color: displaySurface.bodyText }">而且是远超底线</span>
        <span :style="{ color: displaySurface.txtrNumber }">8000</span>
        <span :style="{ color: displaySurface.txtrEnglish }">kg</span>
        <span :style="{ color: displaySurface.txtrPunctuation }">。</span>
      </p>
      <p class="readerPalettePreviewP">
        <span class="readerPalettePreviewIndent">　　</span>
        <span :style="{ color: displaySurface.txtrPunctuation }">“</span>
        <span :style="{ color: displaySurface.txtrQuoteInner }"
          >最后测试一下神经反应速度</span
        >
        <span :style="{ color: displaySurface.txtrPunctuation }">。”</span>
      </p>
    </div>

    <!-- 不用 v-show：display:none 会清掉 overflow 的 scrollTop -->
    <div class="schemePanelTableStack">
      <div
        class="schemePanelTableScroll schemePanelTableScroll--presets"
        :class="{ 'schemePanelTablePane--inactive': readerPane !== 'list' }"
        :inert="readerPane !== 'list'"
      >
        <slot name="presetList" />
      </div>
      <div
        ref="bgScrollEl"
        class="schemePanelTableScroll schemePanelTableScroll--presets"
        :class="{ 'schemePanelTablePane--inactive': readerPane !== 'bg' }"
        :inert="readerPane !== 'bg'"
      >
      <ColorSchemeBackgroundPicker
        ref="bgPickerRef"
        :texture-id="backgroundTextureId"
        :custom="backgroundCustom"
        :custom-url-by-id="backgroundCustomUrlById"
        :surface-bg="displaySurface.readerBg"
        @select="emit('select-background', $event)"
        @delete-custom="emit('delete-background', $event)"
      />
      </div>
      <div
        class="schemePanelTableScroll"
        :class="{
          'schemePanelTablePane--inactive':
            readerPane !== 'colors' && readerPane !== 'switches',
        }"
        :inert="readerPane !== 'colors' && readerPane !== 'switches'"
      >
      <table class="colorSchemeTable">
        <colgroup>
          <col class="colorSchemeColLabel" />
          <col class="colorSchemeColValue" />
          <col class="colorSchemeColLabel" />
          <col class="colorSchemeColValue" />
        </colgroup>
        <tbody>
          <tr v-for="(row, rowIdx) in READER_SURFACE_TABLE_ROWS" :key="rowIdx">
            <template v-if="row.length === 2">
              <td class="colorSchemeRowLabel">
                <div class="colorSchemeRowLabelInner">
                  <SwitchToggle
                    v-if="
                      readerPane === 'switches' &&
                      isReaderSurfaceOptionalColorKey(row[0])
                    "
                    :model-value="colorEnabled[row[0]]"
                    size="sm"
                    :aria-label="switchAriaLabel(row[0])"
                    @update:model-value="
                      emit('update-color-enabled', row[0], $event)
                    "
                  />
                  <span
                    v-else-if="readerPane === 'switches'"
                    class="colorSchemeSwitchSpacer"
                    aria-hidden="true"
                  />
                  <span>{{ READER_SURFACE_LABELS[row[0]] }}</span>
                </div>
              </td>
              <td>
                <HexColorPickerField
                  class="colorSchemePicker"
                  :class="{
                    'colorSchemePicker--off': readerPane === 'switches',
                  }"
                  :disabled="readerPane === 'switches'"
                  :model-value="editingSurface[row[0]]"
                  @update:model-value="
                    emit('update-surface-key', row[0], $event)
                  "
                  @draft-hex="emit('draft-hex', row[0], $event)"
                  @draft-end="emit('draft-end')"
                />
              </td>
              <td class="colorSchemeRowLabel">
                <div class="colorSchemeRowLabelInner">
                  <SwitchToggle
                    v-if="
                      readerPane === 'switches' &&
                      isReaderSurfaceOptionalColorKey(row[1])
                    "
                    :model-value="colorEnabled[row[1]]"
                    size="sm"
                    :aria-label="switchAriaLabel(row[1])"
                    @update:model-value="
                      emit('update-color-enabled', row[1], $event)
                    "
                  />
                  <span
                    v-else-if="readerPane === 'switches'"
                    class="colorSchemeSwitchSpacer"
                    aria-hidden="true"
                  />
                  <span>{{ READER_SURFACE_LABELS[row[1]] }}</span>
                </div>
              </td>
              <td>
                <HexColorPickerField
                  class="colorSchemePicker"
                  :class="{
                    'colorSchemePicker--off': readerPane === 'switches',
                  }"
                  :disabled="readerPane === 'switches'"
                  :model-value="editingSurface[row[1]]"
                  @update:model-value="
                    emit('update-surface-key', row[1], $event)
                  "
                  @draft-hex="emit('draft-hex', row[1], $event)"
                  @draft-end="emit('draft-end')"
                />
              </td>
            </template>
            <template v-else>
              <td class="colorSchemeRowLabel">
                <div class="colorSchemeRowLabelInner">
                  <span
                    v-if="readerPane === 'switches'"
                    class="colorSchemeSwitchSpacer"
                    aria-hidden="true"
                  />
                  <span>{{ READER_SURFACE_LABELS[row[0]] }}</span>
                </div>
              </td>
              <td>
                <HexColorPickerField
                  class="colorSchemePicker"
                  :class="{
                    'colorSchemePicker--off': readerPane === 'switches',
                  }"
                  :disabled="readerPane === 'switches'"
                  :model-value="editingSurface[row[0]]"
                  @update:model-value="
                    emit('update-surface-key', row[0], $event)
                  "
                  @draft-hex="emit('draft-hex', row[0], $event)"
                  @draft-end="emit('draft-end')"
                />
              </td>
              <td colspan="2" class="colorSchemeTablePadCell" />
            </template>
          </tr>
          <tr>
            <td class="colorSchemeRowLabel">
              <div class="colorSchemeRowLabelInner">
                <SwitchToggle
                  v-if="readerPane === 'switches'"
                  :model-value="backgroundEnabled"
                  size="sm"
                  aria-label="背景图独立叠层"
                  @update:model-value="emit('update-background-enabled', $event)"
                />
                <span>背景图</span>
              </div>
            </td>
            <td>
              <div
                class="colorSchemePicker colorSchemeBgPicker"
                :class="{
                  'colorSchemePicker--off': readerPane === 'switches',
                }"
              >
                <button
                  type="button"
                  class="colorSchemeBgSwatch"
                  :disabled="readerPane === 'switches'"
                  :title="bgSwatchLabel"
                  :aria-label="`背景图：${bgSwatchLabel}`"
                  @click="emit('open-background')"
                >
                  <span
                    class="colorSchemeBgSwatchFill"
                    :style="bgSwatchStyle"
                    aria-hidden="true"
                  >
                    <span
                      v-if="bgSwatchEmpty"
                      class="colorSchemeBgSwatchEmptyIcon"
                      v-html="icons.close"
                    />
                  </span>
                </button>
                <span
                  v-if="showBgOptionsBtn"
                  ref="bgOptionsTableBtnRef"
                  class="colorSchemeBgOptionsBtnWrap"
                >
                  <IconButton
                    :icon-html="icons.options"
                    :title="bgOptionsBtnTitle || '背景图选项'"
                    aria-label="背景图选项"
                    aria-haspopup="dialog"
                    :pressed="bgOptionsOpen"
                    :active="bgOptionsOpen"
                    :disabled="!canEditBgOptions"
                    large
                    @click="emit('toggle-bg-options')"
                  />
                </span>
              </div>
            </td>
            <td colspan="2" class="colorSchemeTablePadCell" />
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.readerPalettePreview {
  position: relative;
  isolation: isolate;
  flex-shrink: 0;
  margin-bottom: 8px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  white-space: pre-wrap;
  word-break: break-word;
}

.readerPalettePreviewTexture {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.readerPalettePreviewP {
  position: relative;
  z-index: 1;
  margin: 0;
}

.readerPalettePreviewIndent {
  color: var(--fg);
}

.colorSchemeTable {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  table-layout: fixed;
}

.colorSchemeTable col.colorSchemeColLabel {
  width: 30%;
}

.colorSchemeTable col.colorSchemeColValue {
  width: 20%;
}

.colorSchemeTable td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

.colorSchemeTable tbody tr:last-child td {
  border-bottom: none;
}

.colorSchemeTablePadCell {
  padding: 0;
}

.colorSchemeRowLabel {
  font-weight: normal;
  color: var(--fg);
}

.colorSchemeTable .colorSchemeRowLabel {
  white-space: nowrap;
}

.colorSchemeRowLabelInner {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.colorSchemeSwitchSpacer {
  flex: 0 0 32px;
  width: 32px;
}

.colorSchemePicker {
  flex: 0 0 auto;
}

.colorSchemeBgPicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.colorSchemeBgOptionsBtnWrap {
  display: inline-flex;
  flex-shrink: 0;
}

.colorSchemePicker--off {
  opacity: 0.45;
}

.colorSchemeBgSwatch {
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
  vertical-align: middle;
}

.colorSchemeBgSwatch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.colorSchemeBgSwatch:focus {
  outline: none;
}

.colorSchemeBgSwatch:focus-visible {
  border-color: var(--accent, #409eff);
}

.colorSchemeBgSwatchFill {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  border-radius: 2px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  background-color: transparent;
  background-repeat: no-repeat;
}

.colorSchemeBgSwatchEmptyIcon {
  display: flex;
  width: 12px;
  height: 12px;
  color: var(--muted, #c0c4cc);
}

.colorSchemeBgSwatchEmptyIcon :deep(svg) {
  width: 12px;
  height: 12px;
  display: block;
}

.colorSchemeBgSwatchEmptyIcon :deep(path) {
  fill: currentColor;
}

.colorSchemeReader {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.schemePanelTableStack {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.schemePanelTableScroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
}

.schemePanelTablePane--inactive {
  visibility: hidden;
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.schemePanelTableScroll--presets {
  padding: 10px;
  scroll-padding-block: 10px;
}
</style>
