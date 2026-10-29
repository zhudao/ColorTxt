<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  useTemplateRef,
} from "vue";
import { icons } from "../icons";
import { syncDismissibleOverlay } from "../utils/dismissibleOverlayStack";

export type CustomSelectItemTagTone =
  | "language"
  | "dialect"
  | "scene"
  | "capability"
  | "note";

export type CustomSelectItemTag = {
  label: string;
  tone: CustomSelectItemTagTone;
};

export type CustomSelectItem =
  | {
      kind: "item";
      id: string;
      label: string;
      /** 左侧 3px 色块颜色（分类下拉等） */
      borderColor?: string;
      /** 标签前内联 SVG 等（本地可信 HTML） */
      prefixHtml?: string;
      disabled?: boolean;
      danger?: boolean;
      /** 为 true 时点击只触发 `action`，不更新 modelValue */
      actionOnly?: boolean;
      /** 分类色块模式下不显示左侧色块（如「全部」「未分类」） */
      skipCategoryMark?: boolean;
      /** 主标签后的附加文案（如「(12)」、说明等），样式见 .appShellMenuItemSuffix */
      labelSuffix?: string;
      /** 主标签下方的第二行说明（如引擎简介） */
      description?: string;
      /** 说明下方的彩色标签（语种 / 方言 / 场景等） */
      tags?: readonly CustomSelectItemTag[];
      /** 追加到 `appShellMenuItemPrefix` 容器上的 class（如旋转动画） */
      prefixWrapperClass?: string;
      /** 追加到菜单按钮上的 class（如 `appShellMenuItem--success`） */
      itemClass?: string;
      /** `actionOnly` 为 true 时点击后不自动收合面板 */
      keepOpenOnAction?: boolean;
    }
  | { kind: "divider" }
  | { kind: "groupLabel"; label: string };

const props = withDefaults(
  defineProps<{
    /** 当前选中项 id */
    modelValue: string;
    /** 触发器上展示文案（有内容时）；为空且设置了 `placeholder` 时显示占位提示 */
    displayLabel: string;
    /** 未选中或 `displayLabel` 为空时在触发器上显示（muted 样式，不写入 modelValue） */
    placeholder?: string;
    /** 触发器主标签后的附加文案（数量、说明等），样式同 .appShellMenuItemSuffix */
    displaySuffix?: string;
    /**
     * 触发器主文案前的颜色方块（如当前为具体分类时传入 catalog 颜色）；
     * 与 triggerPrefixHtml 可同时存在，顺序为：色块 → 前缀图标 → 文案。
     */
    triggerMarkColor?: string;
    /** 触发器标签前的 HTML（如排序方向图标） */
    triggerPrefixHtml?: string;
    /** 顶部固定区 */
    fixedTopItems: readonly CustomSelectItem[];
    /** 中间可滚动区 */
    scrollItems: readonly CustomSelectItem[];
    /** 底部固定区 */
    fixedBottomItems: readonly CustomSelectItem[];
    ariaLabel: string;
    /** 中间区域最大高度（px） */
    scrollMaxHeight?: number;
    /** 在滚动区顶部显示本地下拉过滤输入框 */
    searchable?: boolean;
    searchPlaceholder?: string;
    /**
     * 下拉面板宽度（px）。
     * `> 0` 时按该值；`0`（默认）时取触发器宽度，且不少于 140。
     */
    minPanelWidth?: number;
    /** 下拉 Teleport 面板 z-index；嵌套在其它浮层内时需高于父面板 */
    panelZIndex?: number;
    /** 为 true 时用左侧 3px 色块表示分类色（排序项带 prefixHtml 时不显示色块） */
    categoryColorMarks?: boolean;
  }>(),
  {
    scrollMaxHeight: 220,
    minPanelWidth: 0,
    panelZIndex: 7200,
    triggerPrefixHtml: "",
    categoryColorMarks: false,
    placeholder: "",
    searchable: false,
    searchPlaceholder: "搜索",
  },
);

const emit = defineEmits<{
  "update:modelValue": [id: string];
  /** 特殊项（如「分类管理」）不更新 modelValue 时发出 */
  action: [id: string];
  /** 下拉 Teleport 面板展开状态，供全屏侧栏收起逻辑等使用 */
  "panel-open-change": [open: boolean];
}>();

const open = ref(false);
syncDismissibleOverlay(open);
const triggerRef = useTemplateRef<HTMLButtonElement>("triggerRef");
const panelRef = useTemplateRef<HTMLElement>("panelRef");
const scrollAreaRef = useTemplateRef<HTMLElement>("scrollAreaRef");
const searchInputRef = useTemplateRef<HTMLInputElement>("searchInputRef");
const searchQuery = ref("");
/** 仅在实际出现纵向滚动条时加右侧内边距 */
const scrollAreaHasScrollbar = ref(false);
let scrollAreaResizeObserver: ResizeObserver | null = null;

function updateScrollAreaScrollbarFlag() {
  const el = scrollAreaRef.value;
  if (!el) {
    scrollAreaHasScrollbar.value = false;
    return;
  }
  scrollAreaHasScrollbar.value = el.scrollHeight - el.clientHeight > 0.5;
}

function bindScrollAreaResizeObserver() {
  unbindScrollAreaResizeObserver();
  const el = scrollAreaRef.value;
  if (!el) return;
  scrollAreaResizeObserver = new ResizeObserver(() => {
    updateScrollAreaScrollbarFlag();
  });
  scrollAreaResizeObserver.observe(el);
}

function unbindScrollAreaResizeObserver() {
  scrollAreaResizeObserver?.disconnect();
  scrollAreaResizeObserver = null;
}
const posLeft = ref(0);
const posTop = ref(0);
const panelWidth = ref(160);

/** 根据视口上下可用空间决定向下或向上弹出，并做边缘夹紧 */
function applyPanelPosition(margin = 8, gap = 4) {
  const trig = triggerRef.value;
  const panel = panelRef.value;
  if (!trig || !panel) return;
  const r = trig.getBoundingClientRect();
  const h = panel.offsetHeight;
  const w = panel.offsetWidth;
  if (h < 1 || w < 1) return;

  const spaceBelow = window.innerHeight - margin - r.bottom - gap;
  const spaceAbove = r.top - margin - gap;

  let top: number;
  if (h <= spaceBelow) {
    top = r.bottom + gap;
  } else if (h <= spaceAbove) {
    top = r.top - h - gap;
  } else if (spaceAbove >= spaceBelow) {
    top = Math.max(margin, r.top - h - gap);
  } else {
    top = Math.min(r.bottom + gap, window.innerHeight - margin - h);
  }

  posTop.value = Math.min(
    Math.max(margin, top),
    Math.max(margin, window.innerHeight - h - margin),
  );

  const maxX = Math.max(margin, window.innerWidth - w - margin);
  posLeft.value = Math.min(Math.max(margin, r.left), maxX);
}

async function positionPanel() {
  const trig = triggerRef.value;
  if (!trig) return;
  const r = trig.getBoundingClientRect();
  // 显式 minPanelWidth 优先生效；未指定时跟触发器，并用 140 作下限（原 CSS min-width）
  panelWidth.value =
    props.minPanelWidth > 0
      ? props.minPanelWidth
      : Math.max(r.width, 140);
  posLeft.value = r.left;
  posTop.value = r.bottom + 4;
  await nextTick();
  await nextTick();
  applyPanelPosition();
  requestAnimationFrame(() => {
    applyPanelPosition();
  });
}

function scrollSelectedIntoView() {
  const area = scrollAreaRef.value;
  const id = props.modelValue;
  if (!area || !id) return;
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(id)
      : id.replace(/["\\]/g, "\\$&");
  const el = area.querySelector<HTMLElement>(`[data-select-id="${escaped}"]`);
  if (!el) return;
  const areaRect = area.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const delta =
    elRect.top - areaRect.top - (area.clientHeight - el.offsetHeight) / 2;
  area.scrollTop += delta;
}

function toggle() {
  open.value = !open.value;
  if (open.value) void positionPanel();
}

function close() {
  open.value = false;
}

function searchItemMatches(
  item: Extract<CustomSelectItem, { kind: "item" }>,
  query: string,
): boolean {
  if (
    [item.label, item.id, item.description, item.labelSuffix].some((value) =>
      value?.toLocaleLowerCase().includes(query),
    )
  ) {
    return true;
  }
  return (
    item.tags?.some((tag) => tag.label.toLocaleLowerCase().includes(query)) ===
    true
  );
}

function itemHasDetail(it: Extract<CustomSelectItem, { kind: "item" }>): boolean {
  return Boolean(it.description?.trim() || it.tags?.length);
}

const filteredScrollItems = computed((): readonly CustomSelectItem[] => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  if (!props.searchable || !query) return props.scrollItems;

  const filtered: CustomSelectItem[] = [];
  let currentGroup: Extract<CustomSelectItem, { kind: "groupLabel" }> | null =
    null;
  let currentGroupMatches = false;
  let currentGroupEmitted = false;

  for (const raw of props.scrollItems) {
    if (raw.kind === "groupLabel") {
      currentGroup = raw;
      currentGroupMatches = raw.label.toLocaleLowerCase().includes(query);
      currentGroupEmitted = false;
      continue;
    }
    if (raw.kind !== "item") continue;
    if (!currentGroupMatches && !searchItemMatches(raw, query)) continue;
    if (currentGroup && !currentGroupEmitted) {
      filtered.push(currentGroup);
      currentGroupEmitted = true;
    }
    filtered.push(raw);
  }
  return filtered;
});

function selectItem(it: Extract<CustomSelectItem, { kind: "item" }>) {
  if (it.actionOnly) {
    emit("action", it.id);
    if (!it.keepOpenOnAction) close();
    return;
  }
  emit("update:modelValue", it.id);
  close();
}

function onDocPointerDown(ev: PointerEvent) {
  if (!open.value) return;
  const t = ev.target as Node | null;
  if (t && panelRef.value?.contains(t)) return;
  if (t && triggerRef.value?.contains(t)) return;
  close();
}

function onKey(ev: KeyboardEvent) {
  if (!open.value) return;
  if (ev.key === "Escape") {
    ev.preventDefault();
    ev.stopPropagation();
    close();
  }
}

watch(
  open,
  async (v) => {
    emit("panel-open-change", v);
    if (v) {
      await nextTick();
      await positionPanel();
      await nextTick();
      searchInputRef.value?.focus();
      updateScrollAreaScrollbarFlag();
      bindScrollAreaResizeObserver();
      requestAnimationFrame(() => {
        updateScrollAreaScrollbarFlag();
        scrollSelectedIntoView();
        requestAnimationFrame(() => {
          scrollSelectedIntoView();
          applyPanelPosition();
        });
      });
    } else {
      searchQuery.value = "";
      unbindScrollAreaResizeObserver();
      scrollAreaHasScrollbar.value = false;
    }
  },
  { immediate: true },
);

watch(
  () => [filteredScrollItems.value.length, props.scrollMaxHeight] as const,
  async () => {
    if (!open.value) return;
    await nextTick();
    updateScrollAreaScrollbarFlag();
    applyPanelPosition();
  },
);

watch(
  () => props.fixedTopItems,
  async () => {
    if (!open.value) return;
    await nextTick();
    applyPanelPosition();
    updateScrollAreaScrollbarFlag();
  },
  { deep: true },
);

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", close);
});
onBeforeUnmount(() => {
  unbindScrollAreaResizeObserver();
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", close);
});

defineExpose({
  /** 供父级在全屏侧栏收起等时机强制收合 Teleport 面板 */
  closePanel: close,
});

function itemButtonClass(it: Extract<CustomSelectItem, { kind: "item" }>) {
  const c = ["appShellMenuItem"];
  if (it.danger) c.push("appShellMenuItem--danger");
  if (it.itemClass?.trim()) c.push(it.itemClass.trim());
  if (!it.actionOnly && it.id === props.modelValue) c.push("is-active");
  if (itemHasDetail(it)) c.push("appShellMenuItem--stacked");
  return c.join(" ");
}

function showItemColorMark(it: Extract<CustomSelectItem, { kind: "item" }>) {
  if (!props.categoryColorMarks) return false;
  if (it.prefixHtml) return false;
  if (it.actionOnly) return false;
  if (it.skipCategoryMark) return false;
  return true;
}

function itemMarkBackground(it: Extract<CustomSelectItem, { kind: "item" }>) {
  const c = it.borderColor?.trim();
  if (c) return c;
  return "var(--border)";
}

const triggerLabelIsPlaceholder = computed(
  () => !props.displayLabel.trim() && Boolean(props.placeholder.trim()),
);

const triggerMainText = computed(() => {
  if (props.displayLabel.trim()) return props.displayLabel;
  if (props.placeholder.trim()) return props.placeholder;
  return "\u00a0";
});
</script>

<template>
  <div class="customSelect">
    <button
      ref="triggerRef"
      type="button"
      class="btn customSelectTrigger"
      :aria-expanded="open"
      :aria-haspopup="true"
      :aria-label="ariaLabel"
      @click.stop="toggle"
    >
      <span class="customSelectTriggerStart">
        <span
          v-if="triggerMarkColor"
          class="customSelectTriggerMark"
          aria-hidden="true"
          :style="{ backgroundColor: triggerMarkColor }"
        />
        <span
          v-if="triggerPrefixHtml"
          class="customSelectTriggerPrefix"
          aria-hidden="true"
          v-html="triggerPrefixHtml"
        />
        <span class="customSelectTriggerLabelWithCount">
          <span
            class="customSelectTriggerLabel"
            :class="{
              'customSelectTriggerLabel--placeholder':
                triggerLabelIsPlaceholder,
            }"
            >{{ triggerMainText }}　</span
          >
          <span v-if="displaySuffix?.trim()" class="appShellMenuItemSuffix">{{
            displaySuffix
          }}</span>
        </span>
      </span>
      <span
        class="svg customSelectChevron"
        aria-hidden="true"
        v-html="icons.foldChevron"
      />
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="panelRef"
        data-fullscreen-sidebar-float
        class="customSelectPanel appShellMenuPanel"
        role="listbox"
        :style="{
          left: `${posLeft}px`,
          top: `${posTop}px`,
          width: `${panelWidth}px`,
          zIndex: panelZIndex,
        }"
        @click.stop
      >
        <label v-if="searchable" class="customSelectSearch">
          <span
            class="customSelectSearchIcon"
            aria-hidden="true"
            v-html="icons.find"
          />
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="search"
            :placeholder="searchPlaceholder"
            :aria-label="searchPlaceholder"
            autocomplete="off"
            spellcheck="false"
          />
        </label>
        <div class="customSelectSection">
          <template v-for="(raw, idx) in fixedTopItems" :key="'t' + idx">
            <div v-if="raw.kind === 'divider'" class="appShellMenuDivider" />
            <div
              v-else-if="raw.kind === 'groupLabel'"
              class="appShellMenuGroupLabel"
              role="presentation"
            >
              {{ raw.label }}
            </div>
            <button
              v-else-if="raw.kind === 'item'"
              type="button"
              role="option"
              :data-select-id="raw.actionOnly ? undefined : raw.id"
              :aria-selected="!raw.actionOnly && raw.id === modelValue"
              :class="itemButtonClass(raw)"
              :disabled="raw.disabled"
              @click="raw.disabled ? undefined : selectItem(raw)"
            >
              <span
                v-if="showItemColorMark(raw)"
                class="appShellMenuItemMark"
                aria-hidden="true"
                :style="{ backgroundColor: itemMarkBackground(raw) }"
              />
              <span class="appShellMenuItemRowBody">
                <span
                  v-if="raw.prefixHtml"
                  class="appShellMenuItemPrefix"
                  :class="raw.prefixWrapperClass"
                  aria-hidden="true"
                  v-html="raw.prefixHtml"
                />
                <span class="appShellMenuItemLabelWithCount">
                  <span
                    class="appShellMenuItemLabelBlock"
                    :class="{
                      'appShellMenuItemLabelBlock--stacked': itemHasDetail(raw),
                    }"
                  >
                    <span class="appShellMenuItemLabelText">{{ raw.label }}</span>
                    <span
                      v-if="raw.description?.trim()"
                      class="appShellMenuItemDescription"
                      >{{ raw.description }}</span
                    >
                    <span
                      v-if="raw.tags?.length"
                      class="appShellMenuItemTags"
                    >
                      <span
                        v-for="tag in raw.tags"
                        :key="`${tag.tone}-${tag.label}`"
                        class="appShellMenuItemTag"
                        :data-tone="tag.tone"
                        >{{ tag.label }}</span
                      >
                    </span>
                  </span>
                  <span
                    v-if="raw.labelSuffix?.trim()"
                    class="appShellMenuItemSuffix"
                    >{{ raw.labelSuffix }}</span
                  >
                </span>
              </span>
            </button>
          </template>
        </div>
        <div
          ref="scrollAreaRef"
          class="customSelectScroll"
          :class="{
            'customSelectScroll--scrollbarPad': scrollAreaHasScrollbar,
          }"
          :style="{ maxHeight: `${scrollMaxHeight}px` }"
        >
          <template
            v-for="(raw, idx) in filteredScrollItems"
            :key="'s' + idx"
          >
            <div v-if="raw.kind === 'divider'" class="appShellMenuDivider" />
            <div
              v-else-if="raw.kind === 'groupLabel'"
              class="appShellMenuGroupLabel"
              role="presentation"
            >
              {{ raw.label }}
            </div>
            <button
              v-else-if="raw.kind === 'item'"
              type="button"
              role="option"
              :data-select-id="raw.actionOnly ? undefined : raw.id"
              :aria-selected="!raw.actionOnly && raw.id === modelValue"
              :class="itemButtonClass(raw)"
              :disabled="raw.disabled"
              @click="raw.disabled ? undefined : selectItem(raw)"
            >
              <span
                v-if="showItemColorMark(raw)"
                class="appShellMenuItemMark"
                aria-hidden="true"
                :style="{ backgroundColor: itemMarkBackground(raw) }"
              />
              <span class="appShellMenuItemRowBody">
                <span
                  v-if="raw.prefixHtml"
                  class="appShellMenuItemPrefix"
                  :class="raw.prefixWrapperClass"
                  aria-hidden="true"
                  v-html="raw.prefixHtml"
                />
                <span class="appShellMenuItemLabelWithCount">
                  <span
                    class="appShellMenuItemLabelBlock"
                    :class="{
                      'appShellMenuItemLabelBlock--stacked': itemHasDetail(raw),
                    }"
                  >
                    <span class="appShellMenuItemLabelText">{{ raw.label }}</span>
                    <span
                      v-if="raw.description?.trim()"
                      class="appShellMenuItemDescription"
                      >{{ raw.description }}</span
                    >
                    <span
                      v-if="raw.tags?.length"
                      class="appShellMenuItemTags"
                    >
                      <span
                        v-for="tag in raw.tags"
                        :key="`${tag.tone}-${tag.label}`"
                        class="appShellMenuItemTag"
                        :data-tone="tag.tone"
                        >{{ tag.label }}</span
                      >
                    </span>
                  </span>
                  <span
                    v-if="raw.labelSuffix?.trim()"
                    class="appShellMenuItemSuffix"
                    >{{ raw.labelSuffix }}</span
                  >
                </span>
              </span>
            </button>
          </template>
          <div
            v-if="searchable && filteredScrollItems.length === 0"
            class="customSelectEmpty"
          >
            无匹配项
          </div>
        </div>
        <div class="customSelectSection">
          <template v-for="(raw, idx) in fixedBottomItems" :key="'b' + idx">
            <div v-if="raw.kind === 'divider'" class="appShellMenuDivider" />
            <div
              v-else-if="raw.kind === 'groupLabel'"
              class="appShellMenuGroupLabel"
              role="presentation"
            >
              {{ raw.label }}
            </div>
            <button
              v-else-if="raw.kind === 'item'"
              type="button"
              role="option"
              :data-select-id="raw.actionOnly ? undefined : raw.id"
              :aria-selected="!raw.actionOnly && raw.id === modelValue"
              :class="itemButtonClass(raw)"
              :disabled="raw.disabled"
              @click="raw.disabled ? undefined : selectItem(raw)"
            >
              <span
                v-if="showItemColorMark(raw)"
                class="appShellMenuItemMark"
                aria-hidden="true"
                :style="{ backgroundColor: itemMarkBackground(raw) }"
              />
              <span class="appShellMenuItemRowBody">
                <span
                  v-if="raw.prefixHtml"
                  class="appShellMenuItemPrefix"
                  :class="raw.prefixWrapperClass"
                  aria-hidden="true"
                  v-html="raw.prefixHtml"
                />
                <span class="appShellMenuItemLabelWithCount">
                  <span
                    class="appShellMenuItemLabelBlock"
                    :class="{
                      'appShellMenuItemLabelBlock--stacked': itemHasDetail(raw),
                    }"
                  >
                    <span class="appShellMenuItemLabelText">{{ raw.label }}</span>
                    <span
                      v-if="raw.description?.trim()"
                      class="appShellMenuItemDescription"
                      >{{ raw.description }}</span
                    >
                    <span
                      v-if="raw.tags?.length"
                      class="appShellMenuItemTags"
                    >
                      <span
                        v-for="tag in raw.tags"
                        :key="`${tag.tone}-${tag.label}`"
                        class="appShellMenuItemTag"
                        :data-tone="tag.tone"
                        >{{ tag.label }}</span
                      >
                    </span>
                  </span>
                  <span
                    v-if="raw.labelSuffix?.trim()"
                    class="appShellMenuItemSuffix"
                    >{{ raw.labelSuffix }}</span
                  >
                </span>
              </span>
            </button>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.customSelect {
  position: relative;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}
.customSelectTrigger.btn {
  flex-shrink: 1;
  min-width: 0;
  width: 100%;
  max-width: 100%;
}
.customSelectTrigger {
  box-sizing: border-box;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  text-align: left;
  white-space: nowrap;
  padding: 4px 8px;
}
.customSelectTrigger[aria-expanded="true"] {
  color: var(--accent);
  border-color: var(--accent);
}
.customSelectTriggerStart {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  justify-content: flex-start;
}
.customSelectTriggerMark {
  flex-shrink: 0;
  width: 3px;
  height: 12px;
  border-radius: 2px;
  margin-bottom: -2px;
  box-sizing: border-box;
}
.customSelectTriggerLabelWithCount {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  flex: 1 1 0%;
  overflow: hidden;
}
.customSelectTriggerPrefix {
  flex-shrink: 0;
  display: inline-flex;
  width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
}
.customSelectTriggerPrefix :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;

  path {
    fill: var(--secondary);
  }
}
.customSelectTriggerLabel {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.customSelectTriggerLabel--placeholder {
  color: var(--muted);
  font-weight: 400;
}
/* 与 AiAssistantChatMessages `.aiFoldChevron` 一致 */
.customSelectChevron {
  flex-shrink: 0;
  margin-left: auto;
  color: color-mix(in srgb, var(--muted) 85%, var(--fg));
  transition: transform 0.22s ease;
}
.customSelectChevron :deep(svg) {
  width: 10px;
  height: 10px;
  display: block;
}
.customSelectChevron :deep(svg path) {
  fill: currentColor;
}
.customSelectTrigger[aria-expanded="true"] .customSelectChevron {
  transform: rotate(180deg);
}
.customSelectPanel {
  position: fixed;
  z-index: 7200;
  box-sizing: border-box;
  /* 宽度由 positionPanel 写入的 inline width 决定，勿再写死 min-width */
}
.customSelectSearch {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding: 0 7px;
  min-width: 0;
  height: 30px;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
}
.customSelectSearch:focus-within {
  border-color: var(--accent);
}
.customSelectSearchIcon {
  flex: 0 0 auto;
  display: inline-flex;
  width: 14px;
  height: 14px;
  color: var(--muted);
}
.customSelectSearchIcon :deep(svg) {
  width: 14px;
  height: 14px;
}
.customSelectSearchIcon :deep(path) {
  fill: currentColor;
}
.customSelectSearch input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  outline: 0;
  color: var(--fg);
  background: transparent;
  font: inherit;
  font-size: 13px;
}
.customSelectSearch input::placeholder {
  color: var(--muted);
}
.customSelectEmpty {
  padding: 10px 12px;
  color: var(--muted);
  text-align: center;
  font-size: 13px;
}
/* 与字体列表 / 历史会话一致：相邻项间距 4px（全局 .appShellMenuItem 为 1px），行高统一 */
.customSelectPanel :deep(.appShellMenuItem + .appShellMenuItem) {
  margin-top: 4px;
}
.customSelectPanel :deep(.appShellMenuItem) {
  min-height: 36px;
  box-sizing: border-box;
  line-height: 1.2;
}
.customSelectPanel
  :deep(.appShellMenuItemRowBody:has(.appShellMenuItemPrefix) .appShellMenuItemLabelWithCount) {
  margin-top: 0;
}
.customSelectPanel :deep(.appShellMenuItemLabelText) {
  white-space: normal;
  word-break: break-all;
  overflow: visible;
  text-overflow: clip;
}
.customSelectPanel :deep(.appShellMenuItem--stacked) {
  min-height: 0;
}
.customSelectPanel :deep(.appShellMenuGroupLabel + .appShellMenuItem) {
  margin-top: 0;
}
.customSelectSection {
  flex-shrink: 0;
}
.customSelectScroll {
  overflow-y: auto;
  min-height: 0;
  box-sizing: border-box;
}

/* 有纵向滚动条时：与轨道留出间距；无条时不加此类，左右与固定区一致 */
.customSelectScroll--scrollbarPad {
  padding-right: 8px;
}

/** 与设置页 AI「拉取模型」按钮一致 */
.customSelectPanel
  :deep(.appShellMenuItemPrefix.customSelectMenuPrefixSpin svg) {
  animation: customSelectIconSpin 0.65s linear infinite;
}

@keyframes customSelectIconSpin {
  to {
    transform: rotate(360deg);
  }
}
</style>
