<script setup lang="ts">
import { ref, watch } from "vue";
import IconButton from "./IconButton.vue";
import AppShellMenuTeleport from "./AppShellMenuTeleport.vue";
import { useAnchoredAppShellMenu } from "../composables/useAnchoredAppShellMenu";
import { icons } from "../icons";

export type ColorSchemeTabId = "reader" | "highlight" | "lineation";

const props = withDefaults(
  defineProps<{
    activeTab: ColorSchemeTabId;
    visibleTabs?: readonly ColorSchemeTabId[];
    currentTheme: string;
    /** 配色弹窗关闭时收起「更多」菜单 */
    panelOpen?: boolean;
    /** 编辑配色或背景图时不可切换主题 */
    themeLocked?: boolean;
    /** 当前选中的是用户方案时才能导出当前方案 */
    canExportCurrentScheme?: boolean;
  }>(),
  {
    visibleTabs: () => ["reader", "highlight", "lineation"],
    panelOpen: true,
    themeLocked: false,
    canExportCurrentScheme: false,
  },
);

const emit = defineEmits<{
  "update:activeTab": [value: ColorSchemeTabId];
  changeTheme: [theme: "vs" | "vs-dark"];
  exportCurrentColorScheme: [];
  exportAllColorSchemes: [];
  importColorScheme: [];
}>();

const tabLabels: Record<ColorSchemeTabId, string> = {
  reader: "阅读器",
  highlight: "高亮色",
  lineation: "标注色",
};

const moreBtnRef = ref<HTMLElement | null>(null);
const moreMenu = useAnchoredAppShellMenu({
  anchor: moreBtnRef,
  placement: "below-end",
  widthPx: 200,
  gap: 6,
  zIndex: 7300,
});
const {
  open: moreOpen,
  left: moreLeft,
  top: moreTop,
  toggleMenu: toggleMoreMenu,
  closeMenu: closeMoreMenu,
  panelRef: morePanelRef,
} = moreMenu;

function bindMorePanel(el: HTMLElement | null) {
  morePanelRef.value = el;
}

watch(
  () => props.panelOpen,
  (open) => {
    if (!open) closeMoreMenu();
  },
);

function onExportCurrent() {
  if (!props.canExportCurrentScheme) return;
  closeMoreMenu();
  emit("exportCurrentColorScheme");
}

function onExportAll() {
  closeMoreMenu();
  emit("exportAllColorSchemes");
}

function onImport() {
  closeMoreMenu();
  emit("importColorScheme");
}
</script>

<template>
  <div class="colorSchemeTabBar">
    <div class="tabs" role="tablist" aria-label="配色分类">
      <button
        v-for="tab in visibleTabs"
        :key="tab"
        type="button"
        role="tab"
        class="tabBtn"
        :class="{ active: activeTab === tab }"
        :aria-selected="activeTab === tab"
        @click="emit('update:activeTab', tab)"
      >
        {{ tabLabels[tab] }}
      </button>
    </div>
    <div class="tabBarEnd">
      <IconButton
        class="tabBarIconBtn"
        :icon-html="currentTheme === 'vs' ? icons.light : icons.dark"
        :disabled="themeLocked"
        :title="
          themeLocked
            ? '编辑配色或背景时不可切换主题'
            : currentTheme === 'vs'
              ? '当前亮色，点击切换暗色'
              : '当前暗色，点击切换亮色'
        "
        aria-label="切换主题色"
        @click="
          emit('changeTheme', currentTheme === 'vs' ? 'vs-dark' : 'vs')
        "
      />
      <div ref="moreBtnRef" class="tabBarMoreWrap">
        <IconButton
          class="tabBarIconBtn"
          :icon-html="icons.more"
          :active="moreOpen"
          :pressed="moreOpen"
          title="更多"
          aria-label="更多"
          aria-haspopup="menu"
          :aria-expanded="moreOpen"
          @click="toggleMoreMenu"
        />
        <AppShellMenuTeleport
          v-model:open="moreOpen"
          :left="moreLeft"
          :top="moreTop"
          :z-index="7300"
          caret="end"
          :on-panel-mount="bindMorePanel"
        >
          <button
            type="button"
            class="appShellMenuItem"
            role="menuitem"
            @click="onExportAll"
          >
            <span class="appShellMenuIconSlot" v-html="icons.export" />
            <span class="appShellMenuLabel">导出配色</span>
          </button>
          <button
            type="button"
            class="appShellMenuItem"
            role="menuitem"
            @click="onImport"
          >
            <span class="appShellMenuIconSlot" v-html="icons.import" />
            <span class="appShellMenuLabel">导入配色</span>
          </button>
          <div class="appShellMenuDivider" role="separator" />
          <button
            type="button"
            class="appShellMenuItem"
            role="menuitem"
            :disabled="!canExportCurrentScheme"
            @click="onExportCurrent"
          >
            <span class="appShellMenuIconSlot" v-html="icons.export" />
            <span class="appShellMenuLabel">导出当前配色方案</span>
          </button>
        </AppShellMenuTeleport>
      </div>
    </div>
  </div>
</template>

<style scoped>
.colorSchemeTabBar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  margin-bottom: 0;
  border-bottom: 1px solid var(--border);
}

.tabs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.tabBtn {
  box-sizing: border-box;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--tab-fg);
  font-size: 14px;
  padding: 8px 10px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
  display: inline-flex;
  align-items: center;
}

.tabBtn:hover {
  color: var(--tab-fg-hover);
  background: transparent;
}

.tabBtn.active {
  color: var(--tab-fg-active);
  background: transparent;
  border-bottom: 2px solid var(--tab-underline);
  font-weight: 600;
}

.tabBarEnd {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  margin-bottom: 2px;
}

.tabBarMoreWrap {
  position: relative;
}

.tabBarIconBtn {
  flex-shrink: 0;
}
</style>
