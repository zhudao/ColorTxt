<script setup lang="ts">
import ScrollableTabNav from "../../components/ScrollableTabNav.vue";

export type FindBookSettingsTabId =
  | "download"
  | "reading"
  | "edit"
  | "voiceRead"
  | "proxy"
  | "webDav";

defineProps<{
  activeTab: FindBookSettingsTabId;
}>();

const emit = defineEmits<{
  "update:activeTab": [value: FindBookSettingsTabId];
}>();
</script>

<template>
  <div class="settingsTabBar" role="tablist" aria-label="找书设置分类">
    <ScrollableTabNav :active-key="activeTab">
      <div class="tabs">
        <button
          type="button"
          role="tab"
          class="tabBtn"
          :class="{ active: activeTab === 'download' }"
          :aria-selected="activeTab === 'download'"
          @click="emit('update:activeTab', 'download')"
        >
          下载
        </button>
        <button
          type="button"
          role="tab"
          class="tabBtn"
          :class="{ active: activeTab === 'reading' }"
          :aria-selected="activeTab === 'reading'"
          @click="emit('update:activeTab', 'reading')"
        >
          阅读
        </button>
        <button
          type="button"
          role="tab"
          class="tabBtn"
          :class="{ active: activeTab === 'edit' }"
          :aria-selected="activeTab === 'edit'"
          @click="emit('update:activeTab', 'edit')"
        >
          编辑
        </button>
        <button
          type="button"
          role="tab"
          class="tabBtn"
          :class="{ active: activeTab === 'voiceRead' }"
          :aria-selected="activeTab === 'voiceRead'"
          @click="emit('update:activeTab', 'voiceRead')"
        >
          语音朗读
        </button>
        <button
          type="button"
          role="tab"
          class="tabBtn"
          :class="{ active: activeTab === 'proxy' }"
          :aria-selected="activeTab === 'proxy'"
          @click="emit('update:activeTab', 'proxy')"
        >
          代理
        </button>
        <button
          type="button"
          role="tab"
          class="tabBtn"
          :class="{ active: activeTab === 'webDav' }"
          :aria-selected="activeTab === 'webDav'"
          @click="emit('update:activeTab', 'webDav')"
        >
          WebDAV
        </button>
      </div>
    </ScrollableTabNav>
  </div>
</template>

<style scoped>
.settingsTabBar {
  flex-shrink: 0;
  margin-bottom: 0;
  border-bottom: 1px solid var(--border);
  min-width: 0;
}

.tabs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
  line-height: 1.2;
  display: inline-flex;
  align-items: center;
}

.tabBtn:hover {
  color: var(--tab-fg-hover);
}

.tabBtn.active {
  color: var(--tab-fg-active);
  border-bottom: 2px solid var(--tab-underline);
  font-weight: 600;
}
</style>
