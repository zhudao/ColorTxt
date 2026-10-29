<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import IconButton from "./IconButton.vue";
import AppShellMenuTeleport from "./AppShellMenuTeleport.vue";
import { icons } from "../icons";
import type { ShortcutBindingMap } from "../services/shortcutRegistry";
import { acceleratorToDisplayText } from "../services/shortcutUtils";
import { useAnchoredAppShellMenu } from "../composables/useAnchoredAppShellMenu";

type RecentFileItem = { path: string; progress?: number };

const props = withDefaults(
  defineProps<{
    recentFiles?: RecentFileItem[];
    shortcutBindings: ShortcutBindingMap;
    inMinimalist?: boolean;
    inFullscreen?: boolean;
    canEnterStealth?: boolean;
  }>(),
  { recentFiles: () => [], inMinimalist: false, inFullscreen: false, canEnterStealth: false },
);

const isMacPlatform = computed(() =>
  /mac|iphone|ipad|ipod/i.test(navigator.platform || ""),
);

function bindingLabel(accel: string) {
  return acceleratorToDisplayText(accel, isMacPlatform.value);
}

const findShortcutLabel = computed(() =>
  bindingLabel(props.shortcutBindings.toggleFind),
);
const settingsShortcutLabel = computed(() =>
  bindingLabel(props.shortcutBindings.openSettings),
);
const newWindowShortcutLabel = computed(() =>
  bindingLabel(props.shortcutBindings.openNewWindow),
);
const colorSchemeShortcutLabel = computed(() =>
  bindingLabel(props.shortcutBindings.openColorScheme),
);
const findBookShortcutLabel = computed(() =>
  bindingLabel(props.shortcutBindings.openFindBook),
);
const stealthShortcutLabel = computed(() =>
  bindingLabel(props.shortcutBindings.enterStealthReader),
);

const emit = defineEmits<{
  toggleFind: [];
  openGithub: [];
  checkForUpdates: [];
  openShortcuts: [];
  openSettings: [];
  openColorScheme: [];
  openFindBook: [];
  enterStealthReader: [];
  openNewWindow: [];
  openAbout: [];
  quitApp: [];
  openRecentFile: [filePath: string];
  clearRecentFiles: [];
}>();

const moreBtnRef = ref<HTMLElement | null>(null);
const recentSubOpen = ref(false);
const recentFlyoutRef = ref<HTMLElement | null>(null);
const moreMenu = useAnchoredAppShellMenu({
  anchor: moreBtnRef,
  placement: "below-end",
  gap: 6,
  excludeCloseWithin: computed(() => [recentFlyoutRef.value]),
  onClose: () => {
    recentSubOpen.value = false;
  },
});
const {
  open: moreMenuOpen,
  left: moreMenuLeft,
  top: moreMenuTop,
  availableMaxHeight,
  toggleMenu: toggleMoreMenu,
  closeMenu: closeAnchoredMenu,
  panelRef: moreMenuPanelRef,
} = moreMenu;

function bindMoreMenuPanel(el: HTMLElement | null) {
  moreMenuPanelRef.value = el;
}

const recentSubWrapRef = ref<HTMLElement | null>(null);
const recentFlyoutStyle = ref<Record<string, string>>({});

const FLYOUT_OVERLAP_PX = 4;
const VIEW_MARGIN_PX = 8;
let recentLeaveTimer: ReturnType<typeof setTimeout> | undefined;

function clearRecentLeaveTimer() {
  if (recentLeaveTimer == null) return;
  clearTimeout(recentLeaveTimer);
  recentLeaveTimer = undefined;
}

onBeforeUnmount(clearRecentLeaveTimer);

function closeMoreMenu() {
  clearRecentLeaveTimer();
  recentSubOpen.value = false;
  closeAnchoredMenu();
}

function updateRecentFlyoutPos() {
  const wrap = recentSubWrapRef.value;
  const flyout = recentFlyoutRef.value;
  if (!wrap || !flyout) return;
  const wrapRect = wrap.getBoundingClientRect();
  const panelRect = moreMenuPanelRef.value?.getBoundingClientRect();
  const menuLeft = panelRect?.left ?? wrapRect.left;
  const w = flyout.offsetWidth;
  const h = flyout.offsetHeight;
  if (w <= 0) return;
  let left = menuLeft - w + FLYOUT_OVERLAP_PX;
  if (left < VIEW_MARGIN_PX) left = VIEW_MARGIN_PX;
  let top = wrapRect.top - 6;
  const maxTop = window.innerHeight - VIEW_MARGIN_PX - h;
  top = Math.min(
    Math.max(VIEW_MARGIN_PX, top),
    Math.max(VIEW_MARGIN_PX, maxTop),
  );
  recentFlyoutStyle.value = {
    position: "fixed",
    visibility: "visible",
    top: `${top}px`,
    left: `${left}px`,
    right: "auto",
    zIndex: "7300",
  };
}

function scheduleRecentFlyoutPos() {
  void nextTick(() => {
    updateRecentFlyoutPos();
    void nextTick(() => updateRecentFlyoutPos());
  });
}

function onRecentSubEnter() {
  clearRecentLeaveTimer();
  recentFlyoutStyle.value = {
    position: "fixed",
    visibility: "hidden",
    top: "0px",
    left: "0px",
    right: "auto",
    zIndex: "7300",
  };
  recentSubOpen.value = true;
  scheduleRecentFlyoutPos();
}

function onRecentFlyoutEnter() {
  clearRecentLeaveTimer();
}

function onRecentSubLeave() {
  clearRecentLeaveTimer();
  recentLeaveTimer = setTimeout(() => {
    recentSubOpen.value = false;
  }, 120);
}

function onMoreMenuItemsScroll() {
  if (recentSubOpen.value) updateRecentFlyoutPos();
}

function basenameFromPath(filePath: string) {
  const p = filePath.replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function formatRecentLabel(filePath: string) {
  const base = basenameFromPath(filePath);
  return base.length > 36 ? `${base.slice(0, 33)}...` : base;
}

function formatRecentProgress(progress: number | undefined) {
  if (typeof progress !== "number") return "--";
  return `${progress.toFixed(1).replace(/\.0$/, "")}%`;
}

function isProgressComplete(progress: number | undefined): boolean {
  return typeof progress === "number" && progress >= 100;
}

function onOpenRecentFile(filePath: string) {
  closeMoreMenu();
  emit("openRecentFile", filePath);
}

function onClearRecentFiles() {
  closeMoreMenu();
  emit("clearRecentFiles");
}

function onToggleFind() {
  closeMoreMenu();
  emit("toggleFind");
}

function onOpenGithub() {
  closeMoreMenu();
  emit("openGithub");
}

function onCheckForUpdates() {
  closeMoreMenu();
  emit("checkForUpdates");
}

function onToggleDevTools() {
  closeMoreMenu();
  void window.colorTxt.toggleDevTools();
}

function onOpenAbout() {
  closeMoreMenu();
  emit("openAbout");
}

function onOpenShortcuts() {
  closeMoreMenu();
  emit("openShortcuts");
}

function onOpenSettings() {
  closeMoreMenu();
  emit("openSettings");
}

function onOpenColorScheme() {
  closeMoreMenu();
  emit("openColorScheme");
}

function onOpenFindBook() {
  closeMoreMenu();
  emit("openFindBook");
}

function onEnterStealthReader() {
  if (!props.canEnterStealth) return;
  closeMoreMenu();
  emit("enterStealthReader");
}

function onOpenNewWindow() {
  closeMoreMenu();
  emit("openNewWindow");
}

function onQuit() {
  closeMoreMenu();
  emit("quitApp");
}
</script>

<template>
  <div ref="moreBtnRef" class="moreMenuWrap">
    <IconButton
      :icon-html="icons.more"
      :active="moreMenuOpen"
      :pressed="moreMenuOpen"
      title="更多"
      aria-label="更多"
      aria-haspopup="menu"
      :aria-expanded="moreMenuOpen"
      @click.stop="toggleMoreMenu"
    />
  </div>
  <AppShellMenuTeleport
    v-model:open="moreMenuOpen"
    :left="moreMenuLeft"
    :top="moreMenuTop"
    :min-width="200"
    caret="end"
    :fullscreen-header-float="inFullscreen || inMinimalist"
    :on-panel-mount="bindMoreMenuPanel"
  >
      <div
        class="moreMenuFill"
        :style="
          availableMaxHeight != null
            ? { maxHeight: `${availableMaxHeight}px` }
            : undefined
        "
      >
      <div v-if="$slots.toolbar" class="moreMenuToolbar">
        <slot name="toolbar" />
      </div>
      <div
        v-if="$slots.toolbar"
        class="appShellMenuDivider"
        role="separator"
      ></div>
      <div class="moreMenuItems" @scroll="onMoreMenuItemsScroll">
      <button class="appShellMenuItem" role="menuitem" @click="onToggleFind">
        <span class="appShellMenuIconSlot" v-html="icons.find"></span>
        <span class="appShellMenuLabel">查找</span>
        <span class="appShellMenuShortcut">{{ findShortcutLabel }}</span>
      </button>
      <div class="appShellMenuDivider" role="separator"></div>
      <div
        ref="recentSubWrapRef"
        class="appShellMenuSubWrap"
        @mouseenter="onRecentSubEnter"
        @mouseleave="onRecentSubLeave"
      >
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          aria-haspopup="menu"
          :aria-expanded="recentSubOpen"
        >
          <span class="appShellMenuIconSlot" aria-hidden="true"></span>
          <span class="appShellMenuLabel">打开最近的文件</span>
          <span class="appShellMenuSubChevron">›</span>
        </button>
      </div>
      <button class="appShellMenuItem" role="menuitem" @click="onOpenNewWindow">
        <span class="appShellMenuIconSlot" v-html="icons.newWindow"></span>
        <span class="appShellMenuLabel">新窗口</span>
        <span class="appShellMenuShortcut">{{ newWindowShortcutLabel }}</span>
      </button>
      <div class="appShellMenuDivider" role="separator"></div>
      <button class="appShellMenuItem" role="menuitem" @click="onOpenShortcuts">
        <span class="appShellMenuIconSlot" v-html="icons.shortcut"></span>
        <span class="appShellMenuLabel">快捷键</span>
      </button>
      <button class="appShellMenuItem" role="menuitem" @click="onOpenSettings">
        <span class="appShellMenuIconSlot" v-html="icons.setting"></span>
        <span class="appShellMenuLabel">设置</span>
        <span class="appShellMenuShortcut">{{ settingsShortcutLabel }}</span>
      </button>
      <button class="appShellMenuItem" role="menuitem" @click="onOpenColorScheme">
        <span
          class="appShellMenuIconSlot appShellMenuIconSlot--colorful"
          v-html="icons.palette"
        ></span>
        <span class="appShellMenuLabel">配色</span>
        <span class="appShellMenuShortcut">{{ colorSchemeShortcutLabel }}</span>
      </button>
      <button class="appShellMenuItem" role="menuitem" @click="onOpenFindBook">
        <span class="appShellMenuIconSlot" v-html="icons.findBook"></span>
        <span class="appShellMenuLabel">找书（beta）</span>
        <span class="appShellMenuShortcut">{{ findBookShortcutLabel }}</span>
      </button>
      <button
        class="appShellMenuItem"
        role="menuitem"
        :disabled="!canEnterStealth"
        @click="onEnterStealthReader"
      >
        <span
          class="appShellMenuIconSlot appShellMenuIconSlot--colorful"
          v-html="icons.stealthMode"
        ></span>
        <span class="appShellMenuLabel">摸鱼模式</span>
        <span class="appShellMenuShortcut">{{ stealthShortcutLabel }}</span>
      </button>
      <div class="appShellMenuDivider" role="separator"></div>
      <button class="appShellMenuItem" role="menuitem" @click="onCheckForUpdates">
        <span class="appShellMenuIconSlot" v-html="icons.update"></span>
        <span class="appShellMenuLabel">检查更新</span>
      </button>
      <button class="appShellMenuItem" role="menuitem" @click="onToggleDevTools">
        <span class="appShellMenuIconSlot" v-html="icons.devTools"></span>
        <span class="appShellMenuLabel">开发者工具</span>
      </button>
      <button class="appShellMenuItem" role="menuitem" @click="onOpenGithub">
        <span
          class="appShellMenuIconSlot appShellMenuIconSlot--github"
          v-html="icons.github"
        ></span>
        <span class="appShellMenuLabel">GitHub</span>
      </button>
      <button class="appShellMenuItem" role="menuitem" @click="onOpenAbout">
        <span class="appShellMenuIconSlot" v-html="icons.info"></span>
        <span class="appShellMenuLabel">关于</span>
      </button>
      </div>
      <div class="moreMenuFooter">
        <div class="appShellMenuDivider" role="separator"></div>
        <button class="appShellMenuItem" role="menuitem" @click="onQuit">
          <span class="appShellMenuIconSlot" v-html="icons.quit"></span>
          <span class="appShellMenuLabel">退出</span>
        </button>
      </div>
      </div>
  </AppShellMenuTeleport>
  <Teleport to="body">
    <div
      v-if="recentSubOpen && moreMenuOpen"
      ref="recentFlyoutRef"
      class="appShellMenuFlyout moreMenuRecentFlyout"
      role="menu"
      data-header-float-panel
      :data-fullscreen-header-float="
        inFullscreen || inMinimalist ? true : undefined
      "
      :style="recentFlyoutStyle"
      @mouseenter="onRecentFlyoutEnter"
      @mouseleave="onRecentSubLeave"
      @click.stop
    >
      <template v-if="recentFiles.length">
        <div class="appShellMenuFlyoutList">
          <button
            v-for="item in recentFiles"
            :key="item.path"
            type="button"
            class="appShellMenuFlyoutItem appShellMenuFlyoutItem--rowBetween"
            role="menuitem"
            :title="item.path"
            @click="onOpenRecentFile(item.path)"
          >
            <span class="appShellMenuFlyoutLabel">{{
              formatRecentLabel(item.path)
            }}</span>
            <span
              class="appShellMenuFlyoutMeta"
              :class="{
                'appShellMenuFlyoutMeta--complete': isProgressComplete(
                  item.progress,
                ),
              }"
              >{{ formatRecentProgress(item.progress) }}</span
            >
          </button>
        </div>
        <div
          class="appShellMenuDivider moreMenuDividerTight"
          role="separator"
        ></div>
        <button
          type="button"
          class="appShellMenuFlyoutItem appShellMenuFlyoutAction"
          role="menuitem"
          @click="onClearRecentFiles"
        >
          <span class="appShellMenuFlyoutLabel">清除最近打开的文件</span>
        </button>
      </template>
      <div v-else class="appShellMenuFlyoutEmpty">暂无记录</div>
    </div>
  </Teleport>
</template>

<style scoped>
.moreMenuWrap {
  position: relative;
}

.moreMenuFill {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.moreMenuItems {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.moreMenuFooter {
  flex-shrink: 0;
}

.moreMenuToolbar {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 4px 4px 0;
  overflow: visible;
  flex-shrink: 0;
}

.moreMenuRecentFlyout {
  min-width: 260px;
}

.moreMenuDividerTight {
  margin: 4px 0;
}
</style>
