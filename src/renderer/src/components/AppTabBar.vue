<script setup lang="ts">
export type AppTabItem = {
  id: string;
  label: string;
  hidden?: boolean;
  iconHtml?: string;
};

withDefaults(
  defineProps<{
    activeTab: string;
    tabs: AppTabItem[];
    ariaLabel?: string;
  }>(),
  { ariaLabel: "分类" },
);

const emit = defineEmits<{
  "update:activeTab": [value: string];
}>();
</script>

<template>
  <div class="appTabBar" role="tablist" :aria-label="ariaLabel">
    <div class="tabs">
      <button
        v-for="tab in tabs"
        v-show="!tab.hidden"
        :key="tab.id"
        type="button"
        role="tab"
        class="tabBtn"
        :class="{ active: activeTab === tab.id }"
        :aria-selected="activeTab === tab.id"
        @click="emit('update:activeTab', tab.id)"
      >
        <span
          v-if="tab.iconHtml"
          class="tabIcon"
          aria-hidden="true"
          v-html="tab.iconHtml"
        />
        {{ tab.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.appTabBar {
  flex-shrink: 0;
  margin-bottom: 0;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}

.tabs {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: min-content;
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
  gap: 6px;
}

.tabIcon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.tabIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.tabIcon :deep(svg path) {
  fill: currentColor;
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
