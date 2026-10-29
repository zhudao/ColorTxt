<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import IconButton from "./IconButton.vue";
import { icons } from "../icons";
import { syncDismissibleOverlay } from "../utils/dismissibleOverlayStack";
import {
  TEXT_CONVERT_WIDTH_EDIT_MENU,
  TEXT_CONVERT_WIDTH_READ_MENU,
  TEXT_CONVERT_ZH_EDIT_MENU,
  TEXT_CONVERT_ZH_READ_MENU,
  isTextConvertDisplayActive,
  type TextConvertWidthMode,
  type TextConvertZhMode,
} from "@shared/textConvertTypes";

const props = withDefaults(
  defineProps<{
    readerEditMode?: boolean;
    disabled?: boolean;
    textConvertZh?: TextConvertZhMode;
    textConvertLetter?: TextConvertWidthMode;
    textConvertDigit?: TextConvertWidthMode;
  }>(),
  {
    readerEditMode: false,
    disabled: false,
    textConvertZh: "off",
    textConvertLetter: "off",
    textConvertDigit: "off",
  },
);

const emit = defineEmits<{
  selectZhRead: [mode: TextConvertZhMode];
  selectLetterRead: [mode: TextConvertWidthMode];
  selectDigitRead: [mode: TextConvertWidthMode];
  applyZhEdit: [mode: Exclude<TextConvertZhMode, "off">];
  applyLetterEdit: [mode: Exclude<TextConvertWidthMode, "off">];
  applyDigitEdit: [mode: Exclude<TextConvertWidthMode, "off">];
}>();

const menuOpen = ref(false);
const menuRootEl = ref<HTMLElement | null>(null);
const zhSubWrapEl = ref<HTMLElement | null>(null);
const letterSubWrapEl = ref<HTMLElement | null>(null);
const digitSubWrapEl = ref<HTMLElement | null>(null);
const zhSubOpen = ref(false);
const letterSubOpen = ref(false);
const digitSubOpen = ref(false);
const zhFlyoutSide = ref<"left" | "right">("right");
const letterFlyoutSide = ref<"left" | "right">("right");
const digitFlyoutSide = ref<"left" | "right">("right");

syncDismissibleOverlay(menuOpen);

/** 与 `.convertMenuFlyout` 的 min-width 一致，用于打开前估算能否放在右侧 */
const CONVERT_FLYOUT_ESTIMATE_WIDTH = 160;
const FLYOUT_VIEWPORT_MARGIN = 8;

const buttonTitle = computed(() =>
  props.readerEditMode ? "格式化：转换" : "转换",
);

const displayActive = computed(() =>
  isTextConvertDisplayActive(
    props.textConvertZh,
    props.textConvertLetter,
    props.textConvertDigit,
  ),
);

const zhMenuItems = computed(() =>
  props.readerEditMode
    ? TEXT_CONVERT_ZH_EDIT_MENU
    : TEXT_CONVERT_ZH_READ_MENU,
);

const letterMenuItems = computed(() =>
  props.readerEditMode
    ? TEXT_CONVERT_WIDTH_EDIT_MENU
    : TEXT_CONVERT_WIDTH_READ_MENU,
);

const digitMenuItems = computed(() =>
  props.readerEditMode
    ? TEXT_CONVERT_WIDTH_EDIT_MENU
    : TEXT_CONVERT_WIDTH_READ_MENU,
);

function toggleMenu() {
  if (props.disabled) return;
  menuOpen.value = !menuOpen.value;
  if (!menuOpen.value) closeSubmenus();
}

function closeSubmenus() {
  zhSubOpen.value = false;
  letterSubOpen.value = false;
  digitSubOpen.value = false;
}

function closeMenu() {
  menuOpen.value = false;
  closeSubmenus();
}

function onDocPointerDown(ev: PointerEvent) {
  if (!menuOpen.value) return;
  const root = menuRootEl.value;
  if (!root) return;
  const t = ev.target as Node | null;
  if (t && root.contains(t)) return;
  closeMenu();
}

function onDocKeydown(ev: KeyboardEvent) {
  if (ev.key !== "Escape" || !menuOpen.value) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (zhSubOpen.value || letterSubOpen.value || digitSubOpen.value) {
    closeSubmenus();
    return;
  }
  closeMenu();
}

function isZhItemActive(id: TextConvertZhMode): boolean {
  return !props.readerEditMode && props.textConvertZh === id;
}

function isLetterItemActive(id: TextConvertWidthMode): boolean {
  return !props.readerEditMode && props.textConvertLetter === id;
}

function isDigitItemActive(id: TextConvertWidthMode): boolean {
  return !props.readerEditMode && props.textConvertDigit === id;
}

function onSelectZh(id: TextConvertZhMode) {
  closeMenu();
  if (props.readerEditMode) {
    if (id === "off") return;
    emit("applyZhEdit", id);
    return;
  }
  emit("selectZhRead", id);
}

function onSelectLetter(id: TextConvertWidthMode) {
  closeMenu();
  if (props.readerEditMode) {
    if (id === "off") return;
    emit("applyLetterEdit", id);
    return;
  }
  emit("selectLetterRead", id);
}

function onSelectDigit(id: TextConvertWidthMode) {
  closeMenu();
  if (props.readerEditMode) {
    if (id === "off") return;
    emit("applyDigitEdit", id);
    return;
  }
  emit("selectDigitRead", id);
}

function showDividerBefore(
  item: { dividerBeforeRead?: boolean; dividerBeforeEdit?: boolean },
): boolean {
  return props.readerEditMode
    ? item.dividerBeforeEdit === true
    : item.dividerBeforeRead === true;
}

function pickFlyoutSide(wrapEl: HTMLElement | null): "left" | "right" {
  if (!wrapEl) return "right";
  const rect = wrapEl.getBoundingClientRect();
  const needed = CONVERT_FLYOUT_ESTIMATE_WIDTH + FLYOUT_VIEWPORT_MARGIN;
  const spaceRight = window.innerWidth - rect.right;
  const spaceLeft = rect.left;
  if (spaceRight >= needed) return "right";
  if (spaceLeft >= needed) return "left";
  return spaceRight >= spaceLeft ? "right" : "left";
}

function openZhSubmenu() {
  zhFlyoutSide.value = pickFlyoutSide(zhSubWrapEl.value);
  zhSubOpen.value = true;
}

function openLetterSubmenu() {
  letterFlyoutSide.value = pickFlyoutSide(letterSubWrapEl.value);
  letterSubOpen.value = true;
}

function openDigitSubmenu() {
  digitFlyoutSide.value = pickFlyoutSide(digitSubWrapEl.value);
  digitSubOpen.value = true;
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeydown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onDocKeydown, true);
});
</script>

<template>
  <div ref="menuRootEl" class="convertMenuWrap">
    <IconButton
      :icon-html="icons.convert"
      :primary="readerEditMode"
      :active="menuOpen || (!readerEditMode && displayActive)"
      :pressed="menuOpen || (!readerEditMode && displayActive)"
      :title="buttonTitle"
      :aria-label="buttonTitle"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      :disabled="disabled"
      @click.stop="toggleMenu"
    />
    <div
      v-if="menuOpen"
      class="convertMenuHost appShellMenuPanel"
      role="menu"
      @click.stop
    >
      <div
        ref="zhSubWrapEl"
        class="appShellMenuSubWrap"
        @mouseenter="openZhSubmenu"
        @mouseleave="zhSubOpen = false"
      >
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          aria-haspopup="menu"
          :aria-expanded="zhSubOpen"
        >
          <span class="appShellMenuIconSlot" aria-hidden="true"></span>
          <span class="appShellMenuLabel">简繁</span>
          <span class="appShellMenuSubChevron">›</span>
        </button>
        <div
          v-show="zhSubOpen"
          class="appShellMenuFlyout convertMenuFlyout"
          :class="
            zhFlyoutSide === 'right'
              ? 'appShellMenuFlyout--right'
              : 'appShellMenuFlyout--left'
          "
          role="menu"
          @click.stop
        >
          <template v-for="item in zhMenuItems" :key="item.id">
            <div
              v-if="showDividerBefore(item)"
              class="appShellMenuDivider convertMenuDivider"
              role="separator"
            ></div>
            <button
              type="button"
              class="appShellMenuFlyoutItem"
              :class="{ 'is-active': isZhItemActive(item.id) }"
              role="menuitem"
              @click="onSelectZh(item.id)"
            >
              <span class="appShellMenuFlyoutLabel">{{ item.label }}</span>
            </button>
          </template>
        </div>
      </div>

      <div
        ref="letterSubWrapEl"
        class="appShellMenuSubWrap"
        @mouseenter="openLetterSubmenu"
        @mouseleave="letterSubOpen = false"
      >
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          aria-haspopup="menu"
          :aria-expanded="letterSubOpen"
        >
          <span class="appShellMenuIconSlot" aria-hidden="true"></span>
          <span class="appShellMenuLabel">字母</span>
          <span class="appShellMenuSubChevron">›</span>
        </button>
        <div
          v-show="letterSubOpen"
          class="appShellMenuFlyout convertMenuFlyout"
          :class="
            letterFlyoutSide === 'right'
              ? 'appShellMenuFlyout--right'
              : 'appShellMenuFlyout--left'
          "
          role="menu"
          @click.stop
        >
          <template v-for="item in letterMenuItems" :key="item.id">
            <div
              v-if="showDividerBefore(item)"
              class="appShellMenuDivider convertMenuDivider"
              role="separator"
            ></div>
            <button
              type="button"
              class="appShellMenuFlyoutItem"
              :class="{ 'is-active': isLetterItemActive(item.id) }"
              role="menuitem"
              @click="onSelectLetter(item.id)"
            >
              <span class="appShellMenuFlyoutLabel">{{ item.label }}</span>
            </button>
          </template>
        </div>
      </div>

      <div
        ref="digitSubWrapEl"
        class="appShellMenuSubWrap"
        @mouseenter="openDigitSubmenu"
        @mouseleave="digitSubOpen = false"
      >
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          aria-haspopup="menu"
          :aria-expanded="digitSubOpen"
        >
          <span class="appShellMenuIconSlot" aria-hidden="true"></span>
          <span class="appShellMenuLabel">数字</span>
          <span class="appShellMenuSubChevron">›</span>
        </button>
        <div
          v-show="digitSubOpen"
          class="appShellMenuFlyout convertMenuFlyout"
          :class="
            digitFlyoutSide === 'right'
              ? 'appShellMenuFlyout--right'
              : 'appShellMenuFlyout--left'
          "
          role="menu"
          @click.stop
        >
          <template v-for="item in digitMenuItems" :key="item.id">
            <div
              v-if="showDividerBefore(item)"
              class="appShellMenuDivider convertMenuDivider"
              role="separator"
            ></div>
            <button
              type="button"
              class="appShellMenuFlyoutItem"
              :class="{ 'is-active': isDigitItemActive(item.id) }"
              role="menuitem"
              @click="onSelectDigit(item.id)"
            >
              <span class="appShellMenuFlyoutLabel">{{ item.label }}</span>
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.convertMenuWrap {
  position: relative;
}

.convertMenuHost {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 5000;
  min-width: 120px;
}

.convertMenuHost::before,
.convertMenuHost::after {
  content: "";
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  pointer-events: none;
}

.convertMenuHost::before {
  top: -8px;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-bottom: 8px solid var(--border);
}

.convertMenuHost::after {
  top: -7px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-bottom: 7px solid var(--bg);
}

.convertMenuFlyout {
  width: max-content;
  min-width: 160px;
  max-width: min(50vw, 260px);
  max-height: min(70vh, 420px);
  overflow-x: hidden;
  overflow-y: auto;
}

.convertMenuDivider {
  margin: 4px 0;
}
</style>
