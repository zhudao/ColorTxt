<script setup lang="ts">
import { computed, ref } from "vue";
import AppContextMenu from "./AppContextMenu.vue";

const props = withDefaults(
  defineProps<{
    loading: boolean;
    /** 流式读取进度 0–100；未知总大小时为 null */
    loadingProgressPercent: number | null;
    /** 电子书转为 txt 阶段 */
    ebookParsing?: boolean;
    currentFile: string | null;
    /** 底栏左侧路径展示（电子书为实际打开的转换结果 .txt 路径） */
    pathCaption: string;
    readingProgressPercentPart: string;
    readingProgressDetailPart: string;
    readingProgressPlaceholder: boolean;
    readingProgressComplete: boolean;
    totalCharCountText: string;
    fileSizeText: string;
    fileEncoding: string;
    /** 是否允许点击编码弹出「另存为指定编码」（有磁盘路径且非加载中等） */
    encodingActionsEnabled: boolean;
    /** 底栏路径菜单：「在文件管理器中显示」是否可用 */
    pathMenuRevealEnabled: boolean;
    pathMenuReloadEnabled: boolean;
    pathMenuReconvertEnabled: boolean;
    pathMenuCloseEnabled: boolean;
  }>(),
  {
    loadingProgressPercent: null,
    ebookParsing: false,
    encodingActionsEnabled: false,
    pathMenuRevealEnabled: true,
    pathMenuReloadEnabled: false,
    pathMenuReconvertEnabled: false,
    pathMenuCloseEnabled: false,
  },
);

const emit = defineEmits<{
  pathRevealInFolder: [];
  pathReload: [];
  pathReconvert: [];
  pathClose: [];
  saveFileAsEncoding: [encoding: "utf8" | "gb2312"];
}>();

const footerRootRef = ref<HTMLElement | null>(null);
/** 底栏弹出菜单共用：同一时间只开一个 */
const footerPopoverFooterTopPx = ref(0);
const footerPopoverPointerXPx = ref(0);

const pathMenuOpen = ref(false);
const pathLinkRef = ref<HTMLButtonElement | null>(null);

const encodingMenuOpen = ref(false);
const encodingLinkRef = ref<HTMLButtonElement | null>(null);

const encodingMenuItems = [
  { id: "utf8", label: "保存为 UTF-8" },
  { id: "gb2312", label: "保存为 GB2312" },
] as const;

const pathMenuItems = computed(() => {
  const items: {
    id: string;
    label: string;
    type?: "warning" | "danger";
    disabled?: boolean;
  }[] = [
    {
      id: "reveal",
      label: "在文件管理器中显示",
      disabled: !props.pathMenuRevealEnabled,
    },
    {
      id: "reload",
      label: "重新加载",
      disabled: !props.pathMenuReloadEnabled,
    },
  ];
  if (props.pathMenuReconvertEnabled) {
    items.push({
      id: "reconvert",
      label: "重新转换",
      type: "warning",
    });
  }
  items.push({
    id: "close",
    label: "关闭文件",
    type: "danger",
    disabled: !props.pathMenuCloseEnabled,
  });
  return items;
});

function closePathMenu() {
  pathMenuOpen.value = false;
}

function closeEncodingMenu() {
  encodingMenuOpen.value = false;
}

function setPopoverPointerFromEvent(ev: MouseEvent): boolean {
  const foot = footerRootRef.value;
  if (!foot) return false;
  footerPopoverFooterTopPx.value = foot.getBoundingClientRect().top;
  footerPopoverPointerXPx.value = ev.clientX;
  return true;
}

function openPathMenu(ev: MouseEvent) {
  if (!setPopoverPointerFromEvent(ev)) return;
  closeEncodingMenu();
  pathMenuOpen.value = true;
}

function openEncodingMenu(ev: MouseEvent) {
  if (!setPopoverPointerFromEvent(ev)) return;
  closePathMenu();
  encodingMenuOpen.value = true;
}

function onPathLinkClick(ev: MouseEvent) {
  if (pathMenuOpen.value) {
    closePathMenu();
    return;
  }
  openPathMenu(ev);
}

function onEncodingLinkClick(ev: MouseEvent) {
  if (!props.encodingActionsEnabled) return;
  if (encodingMenuOpen.value) {
    closeEncodingMenu();
    return;
  }
  openEncodingMenu(ev);
}

function onEncodingMenuSelect(id: string) {
  closeEncodingMenu();
  if (id === "utf8") emit("saveFileAsEncoding", "utf8");
  if (id === "gb2312") emit("saveFileAsEncoding", "gb2312");
}

function onPathMenuSelect(id: string) {
  closePathMenu();
  if (id === "reveal") emit("pathRevealInFolder");
  else if (id === "reload") emit("pathReload");
  else if (id === "reconvert") emit("pathReconvert");
  else if (id === "close") emit("pathClose");
}
</script>

<template>
  <footer ref="footerRootRef" class="footer">
    <div class="footer-left">
      <div v-if="currentFile || ebookParsing" class="footerPathWrap">
        <button
          ref="pathLinkRef"
          type="button"
          class="link footerPath"
          aria-haspopup="menu"
          :aria-expanded="pathMenuOpen"
          :title="pathCaption"
          aria-label="文件路径与操作"
          @click="onPathLinkClick($event)"
        >
          {{ pathCaption }}
        </button>
      </div>
    </div>
    <div v-if="currentFile || ebookParsing" class="footer-right">
      <span v-if="loading || ebookParsing" class="footer-loading">
        <template v-if="ebookParsing">
          <span class="footer-loading-ebook">转换中…</span>
        </template>
        <template v-else-if="loadingProgressPercent != null">
          加载中：<span class="footer-loading-pct"
            >{{ loadingProgressPercent }}%</span
          >
        </template>
        <template v-else>加载中...</template>
      </span>
      <span v-else>
        阅读进度：<span
          class="footer-reading-progress-pct"
          :class="{
            'footer-reading-progress-pct--placeholder':
              readingProgressPlaceholder,
            'footer-reading-progress-pct--complete': readingProgressComplete,
          }"
          >{{ readingProgressPercentPart }}</span
        >{{ readingProgressDetailPart }}
      </span>
      <template v-if="!ebookParsing">
        <span v-if="!loading">总字数：{{ totalCharCountText }}</span>
        <span>文件大小：{{ fileSizeText }}</span>
        <span class="footerEncodingWrap"
          >编码：<button
            ref="encodingLinkRef"
            type="button"
            class="link footerEncoding"
            :disabled="!encodingActionsEnabled"
            aria-haspopup="menu"
            :aria-expanded="encodingMenuOpen"
            aria-label="保存为编码…"
            title="保存为编码…"
            @click="onEncodingLinkClick($event)"
          >
            {{ fileEncoding }}
          </button></span
        >
      </template>
    </div>
  </footer>
  <Teleport to="body">
    <AppContextMenu
      :open="pathMenuOpen"
      placement="aboveFooterMouseX"
      :footer-top-px="footerPopoverFooterTopPx"
      :pointer-x-px="footerPopoverPointerXPx"
      :x="0"
      :y="0"
      :items="pathMenuItems"
      :exclude-close-within="pathLinkRef"
      @close="closePathMenu"
      @select="onPathMenuSelect"
    />
    <AppContextMenu
      :open="encodingMenuOpen"
      placement="aboveFooterMouseX"
      :footer-top-px="footerPopoverFooterTopPx"
      :pointer-x-px="footerPopoverPointerXPx"
      :x="0"
      :y="0"
      :items="[...encodingMenuItems]"
      :exclude-close-within="encodingLinkRef"
      @close="closeEncodingMenu"
      @select="onEncodingMenuSelect"
    />
  </Teleport>
</template>

<style scoped>
.footer {
  height: 28px;
  flex-shrink: 0;
  min-width: 0;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  gap: 16px;
}

.footer-left {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: hidden;
}

.footer-loading {
  flex-shrink: 0;
}

.footer-loading-pct {
  color: var(--warning);
}

.footer-loading-ebook {
  color: var(--warning);
}

.footerPathWrap {
  flex: 1 1 0%;
  min-width: 0;
  overflow: hidden;
  display: flex;
  justify-content: flex-start;
  align-items: center;
}

.footerPath {
  display: block;
  min-width: 0;
  box-sizing: border-box;
  font-size: 12px;
  color: var(--fg);
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.footer-right {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  display: inline-flex;
  min-width: 0;
  flex-shrink: 0;
  gap: 20px;
}

.footer-reading-progress-pct {
  color: var(--warning);
}

.footer-reading-progress-pct--placeholder {
  color: var(--muted);
}

.footer-reading-progress-pct--complete {
  color: var(--success);
}

.footerEncodingWrap {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.footerEncoding {
  max-width: 14em;
  vertical-align: bottom;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  color: var(--muted);
}
</style>
