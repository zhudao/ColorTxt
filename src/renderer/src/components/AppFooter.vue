<script setup lang="ts">
import { computed, ref } from "vue";
import AppContextMenu from "./AppContextMenu.vue";
import PomodoroFooterControl from "./PomodoroFooterControl.vue";
import LoadingDotsBounce from "./LoadingDotsBounce.vue";
import type {
  PomodoroDisplayMode,
  PomodoroPhase,
} from "../composables/usePomodoroTimer";
import { icons } from "../icons";

const props = withDefaults(
  defineProps<{
    loading: boolean;
    /** 流式读取进度 0–100；未知总大小时为 null */
    loadingProgressPercent: number | null;
    /** 电子书转为 txt 阶段 */
    ebookParsing?: boolean;
    /** PDF 页进度，如 `12/480` */
    ebookConvertProgressText?: string;
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
    /** 是否在路径菜单前置 WebDAV 书包上传/更新 */
    webDavMenuEnabled?: boolean;
    /** 底栏路径右侧：WebDAV 书包上传/同步进度 */
    webDavBookPackProgress?: {
      kind: "upload" | "sync";
      percent: number;
    } | null;
    /** 编辑态底栏光标/选区文案（空串不展示） */
    editCursorLabel?: string;
    /** 自动暂停开启且正在朗读：底栏「阅读进度」左侧倒计时 */
    voiceReadFooterStatus?: string;
    /** 番茄时钟：是否在底栏左侧显示 */
    pomodoroEnabled?: boolean;
    pomodoroPhase?: PomodoroPhase;
    pomodoroDisplayMode?: PomodoroDisplayMode;
    pomodoroProgress?: number;
    pomodoroCountdownText?: string;
    pomodoroPauseResumeLabel?: string;
    pomodoroPaused?: boolean;
  }>(),
  {
    loadingProgressPercent: null,
    ebookParsing: false,
    ebookConvertProgressText: "",
    encodingActionsEnabled: false,
    pathMenuRevealEnabled: true,
    pathMenuReloadEnabled: false,
    pathMenuReconvertEnabled: false,
    pathMenuCloseEnabled: false,
    webDavMenuEnabled: false,
    webDavBookPackProgress: null,
    editCursorLabel: "",
    voiceReadFooterStatus: "",
    pomodoroEnabled: false,
    pomodoroPhase: "idle",
    pomodoroDisplayMode: "pie",
    pomodoroProgress: 0,
    pomodoroCountdownText: "0:00",
    pomodoroPauseResumeLabel: "暂停",
    pomodoroPaused: false,
  },
);

const ebookConvertingLabel = computed(() => {
  const p = props.ebookConvertProgressText.trim();
  return p ? `转换中 ${p}` : "转换中";
});

const emit = defineEmits<{
  pathRevealInFolder: [];
  pathReload: [];
  pathReconvert: [];
  pathClose: [];
  pathExportBookPack: [];
  pathExportBookPackWithProgress: [];
  pathUploadBookPackWebDav: [];
  pathUpdateBookPackWebDav: [];
  pathClearReadingData: [];
  saveFileAsEncoding: [encoding: "utf8" | "gb2312"];
  pomodoroStart: [];
  pomodoroToggleDisplayMode: [];
  pomodoroTogglePause: [];
  pomodoroStop: [];
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
  const exportDisabled = !props.pathMenuCloseEnabled;
  const webDavBusy = props.webDavBookPackProgress != null;
  const items: {
    id: string;
    label?: string;
    type?: "warning" | "danger";
    disabled?: boolean;
    iconHtml?: string;
    separator?: boolean;
  }[] = [];
  if (props.webDavMenuEnabled) {
    items.push(
      {
        id: "uploadBookPackWebDav",
        label: "上传书包",
        iconHtml: icons.webDavUpload,
        disabled: exportDisabled || webDavBusy,
      },
      {
        id: "updateBookPackWebDav",
        label: "同步书包",
        iconHtml: icons.webDavDownload,
        disabled: exportDisabled || webDavBusy,
      },
      { id: "webDavBookPackSep", separator: true },
    );
  }
  items.push(
    {
      id: "exportBookPack",
      label: "导出书包",
      iconHtml: icons.export,
      disabled: exportDisabled,
    },
    {
      id: "exportBookPackWithProgress",
      label: "导出书包（带阅读进度）",
      iconHtml: icons.export,
      disabled: exportDisabled,
    },
    { id: "exportBookPackSep", separator: true },
    {
      id: "clearReadingData",
      label: "清除阅读数据",
      iconHtml: icons.clear,
      type: "danger",
      disabled: exportDisabled,
    },
    { id: "clearReadingDataSep", separator: true },
    {
      id: "reveal",
      label: "在文件管理器中显示",
      iconHtml: icons.folderOpen,
      disabled: !props.pathMenuRevealEnabled,
    },
    {
      id: "reload",
      label: "重新加载",
      iconHtml: icons.refresh,
      disabled: !props.pathMenuReloadEnabled,
    },
  );
  if (props.pathMenuReconvertEnabled) {
    items.push({
      id: "reconvert",
      label: "重新转换",
      iconHtml: icons.refresh,
      type: "warning",
    });
  }
  items.push({
    id: "close",
    label: "关闭文件",
    iconHtml: icons.close,
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
  else if (id === "uploadBookPackWebDav") emit("pathUploadBookPackWebDav");
  else if (id === "updateBookPackWebDav") emit("pathUpdateBookPackWebDav");
  else if (id === "exportBookPack") emit("pathExportBookPack");
  else if (id === "exportBookPackWithProgress")
    emit("pathExportBookPackWithProgress");
  else if (id === "clearReadingData") emit("pathClearReadingData");
  else if (id === "close") emit("pathClose");
}
</script>

<template>
  <footer ref="footerRootRef" class="footer">
    <div class="footer-left">
      <PomodoroFooterControl
        v-if="pomodoroEnabled"
        :phase="pomodoroPhase"
        :display-mode="pomodoroDisplayMode"
        :progress="pomodoroProgress"
        :countdown-text="pomodoroCountdownText"
        :pause-resume-label="pomodoroPauseResumeLabel"
        :paused="pomodoroPaused"
        @start="emit('pomodoroStart')"
        @toggle-display-mode="emit('pomodoroToggleDisplayMode')"
        @toggle-pause="emit('pomodoroTogglePause')"
        @stop="emit('pomodoroStop')"
      />
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
        <span
          v-if="webDavBookPackProgress"
          class="footerWebDavProgress"
          aria-live="polite"
        >
          {{ webDavBookPackProgress.kind === "upload" ? "上传" : "同步" }}进度：{{
            webDavBookPackProgress.percent
          }}%
        </span>
      </div>
    </div>
    <div v-if="currentFile || ebookParsing" class="footer-right">
      <span v-if="loading || ebookParsing" class="footer-loading">
        <template v-if="ebookParsing">
          <span class="footer-loading-ebook">
            {{ ebookConvertingLabel }}<LoadingDotsBounce />
          </span>
        </template>
        <template v-else-if="loadingProgressPercent != null">
          加载中：<span class="footer-loading-pct"
            >{{ loadingProgressPercent }}%</span
          >
        </template>
        <template v-else>加载中<LoadingDotsBounce /></template>
      </span>
      <template v-else>
        <span v-if="editCursorLabel" class="footerEditCursor">{{
          editCursorLabel
        }}</span>
        <span v-if="voiceReadFooterStatus">{{ voiceReadFooterStatus }}</span>
        <span>
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
        <span>总字数：{{ totalCharCountText }}</span>
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
  padding: 0 10px 0 5px;
  gap: 16px;
}

.footer-left {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  min-width: 0;
  flex: 1;
  align-self: stretch;
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: hidden;
}

.footer-loading {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.15em;
}

.footer-loading-pct {
  color: var(--warning);
}

.footer-loading-ebook {
  color: var(--warning);
  display: inline-flex;
  align-items: center;
  gap: 0.15em;
}

.footerPathWrap {
  flex: 1 1 0%;
  min-width: 0;
  overflow: hidden;
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: 8px;
}

.footerPath {
  display: block;
  flex: 1 1 0%;
  min-width: 0;
  box-sizing: border-box;
  font-size: 12px;
  color: var(--fg);
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.footerWebDavProgress {
  flex: 0 0 auto;
  white-space: nowrap;
  color: var(--accent);
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

.footerEditCursor {
  flex-shrink: 0;
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
