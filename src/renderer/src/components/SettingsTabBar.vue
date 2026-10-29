<script setup lang="ts">
import ScrollableTabNav from "./ScrollableTabNav.vue";

export type SettingsTabId =
  | "general"
  | "reading"
  | "edit"
  | "voiceRead"
  | "ai"
  | "vectorModel"
  | "txt2img"
  | "skills"
  | "proxy"
  | "webDav";

withDefaults(
  defineProps<{
    activeTab: SettingsTabId;
    /** false 时隐藏依赖 AI 总开关的子标签（向量模型 / 文生图 / 技能） */
    showAiExtensionTabs?: boolean;
  }>(),
  { showAiExtensionTabs: true },
);

const emit = defineEmits<{
  "update:activeTab": [value: SettingsTabId];
}>();
</script>

<template>
  <div class="settingsTabBar" role="tablist" aria-label="设置分类">
    <ScrollableTabNav
      :active-key="activeTab"
      :content-key="showAiExtensionTabs"
    >
      <div class="tabs">
        <button
          type="button"
          role="tab"
          class="tabBtn"
          :class="{ active: activeTab === 'general' }"
          :aria-selected="activeTab === 'general'"
          @click="emit('update:activeTab', 'general')"
        >
          常规
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
          :class="{ active: activeTab === 'ai' }"
          :aria-selected="activeTab === 'ai'"
          @click="emit('update:activeTab', 'ai')"
        >
          AI 阅读助手
        </button>
        <button
          v-show="showAiExtensionTabs"
          type="button"
          role="tab"
          class="tabBtn"
          :class="{ active: activeTab === 'vectorModel' }"
          :aria-selected="activeTab === 'vectorModel'"
          @click="emit('update:activeTab', 'vectorModel')"
        >
          向量模型
        </button>
        <button
          v-show="showAiExtensionTabs"
          type="button"
          role="tab"
          class="tabBtn"
          :class="{ active: activeTab === 'txt2img' }"
          :aria-selected="activeTab === 'txt2img'"
          @click="emit('update:activeTab', 'txt2img')"
        >
          角色卡
        </button>
        <button
          v-show="showAiExtensionTabs"
          type="button"
          role="tab"
          class="tabBtn"
          :class="{ active: activeTab === 'skills' }"
          :aria-selected="activeTab === 'skills'"
          @click="emit('update:activeTab', 'skills')"
        >
          技能
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
