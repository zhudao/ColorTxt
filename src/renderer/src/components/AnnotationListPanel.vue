<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { icons } from "../icons";
import type {
  AnnotationListChapterGroup,
  AnnotationListRow,
} from "../utils/readerAnnotations";
import type { ReaderAnnotationRecord } from "../stores/fileMetaStore";
import { lineationColorAt } from "../constants/annotationColors";
import { useAnchoredAppShellMenu } from "../composables/useAnchoredAppShellMenu";
import AppShellMenuTeleport from "./AppShellMenuTeleport.vue";
import AppContextMenu from "./AppContextMenu.vue";

const NOTES_HEADER_MORE_MENU_W = 200;

const props = withDefaults(
  defineProps<{
    currentFilePath: string | null;
    groups: AnnotationListChapterGroup[];
    monacoFontFamily: string;
    lineationColors: readonly string[];
    menuAnchorEl?: HTMLButtonElement | null;
  }>(),
  {
    currentFilePath: null,
    groups: () => [],
    lineationColors: () => [],
    menuAnchorEl: null,
  },
);

const emit = defineEmits<{
  jumpToAnnotation: [ann: ReaderAnnotationRecord];
  removeAnnotation: [id: string];
  clearAnnotations: [];
  clearStaleAnnotations: [];
  exportAnnotationsMd: [];
  exportAnnotationsJson: [];
  importAnnotationsJson: [];
}>();

const moreBtnRef = ref<HTMLButtonElement | null>(null);
const anchorRef = ref<HTMLButtonElement | null>(null);
watch(
  () => props.menuAnchorEl ?? moreBtnRef.value,
  (el) => {
    anchorRef.value = el;
  },
  { immediate: true },
);
const moreMenu = useAnchoredAppShellMenu({
  anchor: anchorRef,
  placement: "below-end",
  widthPx: NOTES_HEADER_MORE_MENU_W,
  gap: 6,
  disabled: computed(() => !props.currentFilePath),
});
const {
  open: moreOpen,
  left: moreLeft,
  top: moreTop,
  panelRef: morePanelRef,
  toggleMenu: toggleMoreMenu,
  closeMenu: closeMoreMenu,
} = moreMenu;

function bindMorePanel(el: HTMLElement | null) {
  morePanelRef.value = el;
}

defineExpose({
  openMoreMenu: toggleMoreMenu,
  moreOpen,
});

const emptyMessage = computed(() =>
  props.currentFilePath ? "当前文件暂无标注或笔记" : "未打开文件",
);

const rowCount = computed(() =>
  props.groups.reduce((n, group) => n + group.rows.length, 0),
);

const staleCount = computed(() =>
  props.groups
    .flatMap((group) => group.rows)
    .filter((row) => row.stale).length,
);

const showChapterHeaders = computed(() =>
  props.groups.some((group) => group.title.trim().length > 0),
);

const contextMenuOpen = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuAnnotationId = ref<string | null>(null);
const contextMenuItems = [
  { id: "remove", label: "移除", type: "danger" as const },
];

function onMoreSelect(action: string) {
  closeMoreMenu();
  if (action === "exportMd") emit("exportAnnotationsMd");
  else if (action === "exportJson") emit("exportAnnotationsJson");
  else if (action === "importJson") emit("importAnnotationsJson");
  else if (action === "clearStale") emit("clearStaleAnnotations");
}

function closeContextMenu() {
  contextMenuOpen.value = false;
  contextMenuAnnotationId.value = null;
}

function onItemContextMenu(id: string, ev: MouseEvent) {
  ev.preventDefault();
  contextMenuAnnotationId.value = id;
  contextMenuX.value = ev.clientX;
  contextMenuY.value = ev.clientY;
  contextMenuOpen.value = true;
}

function onContextMenuSelect(actionId: string) {
  const id = contextMenuAnnotationId.value;
  if (id == null) return;
  if (actionId === "remove") emit("removeAnnotation", id);
  closeContextMenu();
}

function itemAccentColor(item: AnnotationListRow): string | undefined {
  if (!item.lineationType && item.colorIndex == null) return undefined;
  return lineationColorAt(item.colorIndex ?? 0, props.lineationColors);
}

function itemIconColorStyle(
  item: AnnotationListRow,
): Record<string, string> | undefined {
  const color = itemAccentColor(item);
  return color ? { color } : undefined;
}

function itemLineationAccentStyle(
  item: AnnotationListRow,
): Record<string, string> | undefined {
  const color = itemAccentColor(item);
  return color ? { "--lineation-accent": color } : undefined;
}

function itemMarkerBgStyle(
  item: AnnotationListRow,
): Record<string, string> | undefined {
  const color = itemAccentColor(item);
  return color
    ? { background: `color-mix(in srgb, ${color} 45%, transparent)` }
    : undefined;
}

function readerFontStyle(): Record<string, string> {
  return { fontFamily: props.monacoFontFamily };
}

function chapterHeaderPadding(
  level?: number,
): { paddingLeft: string } | undefined {
  if (level == null || level <= 1) return undefined;
  return { paddingLeft: `${16 + (level - 1) * 10}px` };
}
</script>

<template>
  <div class="sidebarListWrap">
    <div class="sidebarTabBody">
      <div v-if="rowCount === 0" class="empty">
        {{ emptyMessage }}
      </div>
      <div v-else class="sidebarListViewportPad">
        <div class="annotationList">
          <section
            v-for="group in groups"
            :key="group.key"
            class="annotationChapterGroup"
          >
            <div
              v-if="showChapterHeaders && group.title"
              class="annotationChapterHeader"
              :style="chapterHeaderPadding(group.headingLevel)"
              :title="group.title"
            >
              {{ group.title }}
            </div>
            <div
              v-for="item in group.rows"
              :key="item.id"
              class="annotationItem"
              :class="{ 'annotationItem--stale': item.stale }"
              @click="emit('jumpToAnnotation', item.record)"
              @contextmenu="onItemContextMenu(item.id, $event)"
            >
            <div class="annotationItemIcon" aria-hidden="true">
              <span
                v-if="item.kind === 'note'"
                class="annotationIconInner"
                :style="itemIconColorStyle(item)"
                v-html="icons.note"
              />
              <span
                v-else
                class="annotationIconInner annotationIconInner--lineation"
                :class="`annotationIconInner--${item.lineationType ?? 'marker'}`"
                :style="itemLineationAccentStyle(item)"
              >
                <span
                  v-if="(item.lineationType ?? 'marker') === 'marker'"
                  class="annotationLineationMarkerBg"
                  :style="itemMarkerBgStyle(item)"
                ></span>
                <span
                  v-if="
                    item.lineationType === 'wavy' ||
                    item.lineationType === 'straight'
                  "
                  class="annotationLineationGlyphWrap"
                >
                  <span
                    class="annotationLineationGlyph"
                    v-html="icons.fontFamily"
                  ></span>
                  <svg
                    v-if="item.lineationType === 'wavy'"
                    class="annotationLineationDeco annotationLineationDeco--wavy"
                    viewBox="0 0 14 4"
                    width="14"
                    height="3"
                    aria-hidden="true"
                  >
                    <path
                      d="M0 3Q1.4 1 2.8 3T5.6 3T8.4 3T11.2 3T14 3"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <svg
                    v-if="item.lineationType === 'straight'"
                    class="annotationLineationDeco annotationLineationDeco--straight"
                    viewBox="0 0 12 2"
                    width="12"
                    height="2"
                    aria-hidden="true"
                  >
                    <line
                      x1="0"
                      y1="1"
                      x2="12"
                      y2="1"
                      stroke="currentColor"
                      stroke-width="1.2"
                      stroke-linecap="round"
                    />
                  </svg>
                </span>
                <span
                  v-else-if="(item.lineationType ?? 'marker') === 'marker'"
                  class="annotationLineationGlyph"
                  v-html="icons.fontFamily"
                ></span>
              </span>
            </div>
            <div class="annotationItemContent">
              <template v-if="item.kind === 'note'">
                <div class="annotationNoteText" :title="item.text" :style="readerFontStyle()">
                  {{ item.text }}
                </div>
                <div class="annotationQuote" :title="item.noteContent">
                  {{ item.noteContent }}
                </div>
              </template>
              <template v-else>
                <div class="annotationLineText" :title="item.text" :style="readerFontStyle()">
                  {{ item.text }}
                </div>
                <div v-if="item.stale" class="annotationStaleBadge">已失效</div>
              </template>
            </div>
            </div>
          </section>
        </div>
      </div>
    </div>
    <div v-if="rowCount > 0" class="sidebarTabFooter">
      <span class="sidebarTabFooterStat">共 {{ rowCount }} 条</span>
      <button
        type="button"
        class="link danger hoverMode sidebarTabFooterAction"
        :disabled="!currentFilePath"
        @click="emit('clearAnnotations')"
      >
        清空
      </button>
    </div>
    <AppShellMenuTeleport
      v-model:open="moreOpen"
      :left="moreLeft"
      :top="moreTop"
      :width="NOTES_HEADER_MORE_MENU_W"
      caret="end"
      :on-panel-mount="bindMorePanel"
      aria-label="笔记更多"
    >
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        :disabled="rowCount <= 0"
        @click="onMoreSelect('exportMd')"
      >
        <span class="appShellMenuIconSlot" v-html="icons.export" />
        <span class="appShellMenuLabel">导出笔记（Markdown）</span>
      </button>
      <div class="appShellMenuDivider" role="separator" />
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        :disabled="rowCount <= 0"
        @click="onMoreSelect('exportJson')"
      >
        <span class="appShellMenuIconSlot" v-html="icons.export" />
        <span class="appShellMenuLabel">导出笔记（JSON）</span>
      </button>
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        @click="onMoreSelect('importJson')"
      >
        <span class="appShellMenuIconSlot" v-html="icons.import" />
        <span class="appShellMenuLabel">导入笔记（JSON）</span>
      </button>
      <div class="appShellMenuDivider" role="separator" />
      <button
        type="button"
        class="appShellMenuItem"
        role="menuitem"
        :disabled="staleCount <= 0"
        @click="onMoreSelect('clearStale')"
      >
        <span class="appShellMenuIconSlot" v-html="icons.clear" />
        <span class="appShellMenuLabel">清除失效笔记</span>
      </button>
    </AppShellMenuTeleport>
    <Teleport to="body">
      <AppContextMenu
        data-fullscreen-sidebar-float
        :open="contextMenuOpen"
        :x="contextMenuX"
        :y="contextMenuY"
        :items="contextMenuItems"
        :min-width="140"
        @close="closeContextMenu"
        @select="onContextMenuSelect"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.sidebarListWrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.sidebarTabBody {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.sidebarListViewportPad {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 0 6px 6px;
  box-sizing: border-box;
  background: var(--bg);
}

.empty {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 10px 16px;
  font-size: 12px;
  color: var(--secondary);
}

.annotationList {
  display: flex;
  flex-direction: column;
}

.annotationChapterGroup .annotationItem:last-child {
  margin-bottom: 20px;
}

.annotationChapterHeader {
  position: sticky;
  top: 0;
  z-index: 5;
  box-sizing: border-box;
  width: calc(100% + 12px);
  margin-left: -6px;
  margin-right: -6px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--fg);
  padding: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none;
  background: var(--bg);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--border) 65%, transparent);
}

.annotationChapterHeader::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: -8px;
  height: 8px;
  background: var(--bg);
  pointer-events: none;
}

.annotationChapterHeader + .annotationItem {
  margin-top: 6px;
}

.annotationItem {
  position: relative;
  z-index: 0;
  text-align: left;
  background: transparent;
  border: none;
  color: var(--list-item-fg);
  padding: 8px 10px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  gap: 8px;
  align-items: flex-start;
  min-width: 0;
}

.annotationItem + .annotationItem {
  margin-top: 5px;
}

.annotationItem:hover {
  color: var(--list-item-fg);
  background: var(--list-item-bg-hover);
}

.annotationItem--stale {
  opacity: 0.72;
}

.annotationItemIcon {
  flex-shrink: 0;
  width: 20px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  position: relative;
  z-index: 0;
}

.annotationIconInner:not(.annotationIconInner--lineation) :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.annotationIconInner--lineation {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 20px;
  overflow: visible;
}

.annotationLineationMarkerBg {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: 2px;
}

.annotationLineationGlyph {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--list-item-fg);
}

.annotationLineationGlyph :deep(svg path) {
  fill: currentColor;
}

.annotationLineationGlyph :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;
}

.annotationLineationGlyphWrap {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  line-height: 0;
}

.annotationIconInner--wavy .annotationLineationGlyph :deep(svg),
.annotationIconInner--straight .annotationLineationGlyph :deep(svg) {
  width: 13px;
  height: 13px;
}

.annotationLineationDeco {
  display: block;
  flex: 0 0 auto;
  width: 12px;
  overflow: visible;
  color: var(--lineation-accent, var(--list-item-fg));
}

.annotationLineationDeco--wavy {
  width: 14px;
  height: 3px;
  margin-top: -1px;
}

.annotationLineationDeco--straight {
  height: 2px;
}

.annotationLineationDeco path,
.annotationLineationDeco line {
  fill: none;
  stroke: currentColor;
  vector-effect: non-scaling-stroke;
}

.annotationIconInner:not(.annotationIconInner--lineation) :deep(svg path) {
  fill: currentColor;
}

.annotationItemContent {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.annotationNoteText {
  font-size: 13px;
  line-height: 1.35;
  color: var(--list-item-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  white-space: pre-wrap;
  word-break: break-word;
}

.annotationQuote {
  font-size: 12px;
  line-height: 1.35;
  color: var(--list-item-fg);
  opacity: 0.7;
  padding-left: 8px;
  border-left: 2px solid color-mix(in srgb, var(--border) 70%, transparent);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  white-space: pre-wrap;
  word-break: break-word;
}

.annotationLineText {
  font-size: 13px;
  line-height: 1.35;
  color: var(--list-item-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  white-space: pre-wrap;
  word-break: break-word;
}

.annotationStaleBadge {
  font-size: 11px;
  color: var(--list-item-fg);
  opacity: 0.65;
}

.sidebarTabFooter {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--muted);
  border-top: 1px solid var(--border);
  background: var(--bg);
  user-select: none;
}

.sidebarTabFooterStat {
  flex: 1;
  min-width: 0;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebarTabFooterAction {
  flex-shrink: 0;
}
</style>
