<script setup lang="ts">
import IconButton from "./IconButton.vue";
import { icons } from "../icons";

defineProps<{
  scopeLabel: string;
  changeCount: number;
  showWhitespaceDiff: boolean;
  hideUnchangedRegions: boolean;
}>();

const emit = defineEmits<{
  goToPrevious: [];
  goToNext: [];
  toggleWhitespace: [];
  toggleHideUnchanged: [];
  discard: [];
  apply: [];
}>();
</script>

<template>
  <div class="smartFormatReviewBar">
    <div class="smartFormatReviewBarMain">
      <span class="smartFormatReviewBarTitle">排版预览</span>
      <span class="smartFormatReviewBarMeta">{{ scopeLabel }}</span>
    </div>
    <div class="smartFormatReviewBarActions">
      <div class="smartFormatReviewBarTools">
        <span
          v-if="changeCount > 0"
          class="smartFormatReviewBarChanges"
        >
          {{ changeCount }} 处差异
        </span>
        <IconButton
          :icon-html="icons.upThin"
          title="上一个更改 (Ctrl+↑)"
          aria-label="上一个更改"
          :disabled="changeCount === 0"
          @click="emit('goToPrevious')"
        />
        <IconButton
          :icon-html="icons.downThin"
          title="下一个更改 (Ctrl+↓)"
          aria-label="下一个更改"
          :disabled="changeCount === 0"
          @click="emit('goToNext')"
        />
        <IconButton
          :icon-html="icons.paragraph"
          title="显示行首/行尾空白差异"
          aria-label="显示行首/行尾空白差异"
          :active="showWhitespaceDiff"
          :pressed="showWhitespaceDiff"
          @click="emit('toggleWhitespace')"
        />
        <IconButton
          :icon-html="icons.foldUnchanged"
          title="折叠未更改区域"
          aria-label="折叠未更改区域"
          :active="hideUnchangedRegions"
          :pressed="hideUnchangedRegions"
          @click="emit('toggleHideUnchanged')"
        />
      </div>
      <span class="smartFormatReviewBarDivider" aria-hidden="true" />
      <button
        type="button"
        class="btn warning"
        @click="emit('discard')"
      >
        放弃
      </button>
      <button
        type="button"
        class="btn primary"
        @click="emit('apply')"
      >
        应用
      </button>
    </div>
  </div>
</template>

<style scoped>
.smartFormatReviewBar {
  --sf-review-control-h: 28px;
  container-type: inline-size;
  container-name: smart-format-review-bar;
  box-sizing: border-box;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
  gap: 8px;
  flex-shrink: 0;
  min-width: 0;
  height: calc(var(--sf-review-control-h) + 16px);
  overflow: hidden;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg, var(--reader-bg));
}

.smartFormatReviewBarMain {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}

.smartFormatReviewBarTitle {
  flex-shrink: 0;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
}

.smartFormatReviewBarMeta {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--muted);
}

.smartFormatReviewBarChanges {
  font-size: 12px;
  color: var(--muted);
  margin-right: 6px;
  white-space: nowrap;
  flex-shrink: 0;
}

.smartFormatReviewBarActions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.smartFormatReviewBarActions .btn {
  box-sizing: border-box;
  height: var(--sf-review-control-h);
  padding-block: 0;
  line-height: 1;
  white-space: nowrap;
  flex-shrink: 0;
}

.smartFormatReviewBarTools {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  height: var(--sf-review-control-h);
}

.smartFormatReviewBarTools :deep(.iconBtn) {
  width: var(--sf-review-control-h);
  height: var(--sf-review-control-h);
}

.smartFormatReviewBarDivider {
  width: 1px;
  height: calc(var(--sf-review-control-h) - 6px);
  margin: 0 4px;
  background: var(--border);
  flex-shrink: 0;
}

/* 渐窄：先藏范围标签，再藏差异计数/工具按钮，保底标题 + 放弃/应用 */
@container smart-format-review-bar (max-width: 620px) {
  .smartFormatReviewBarMeta {
    display: none;
  }
}

@container smart-format-review-bar (max-width: 460px) {
  .smartFormatReviewBarTools,
  .smartFormatReviewBarDivider {
    display: none;
  }
}
</style>
