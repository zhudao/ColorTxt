<script setup lang="ts">
import { computed } from "vue";
import SwitchToggle from "../../components/SwitchToggle.vue";
import PathPickerInput from "../../components/PathPickerInput.vue";
import AppCustomSelect, {
  type CustomSelectItem,
} from "../../components/AppCustomSelect.vue";
import {
  FIND_BOOK_DOWNLOAD_AFTER_ACTION_OPTIONS,
  labelForFindBookDownloadAfterAction,
  type FindBookDownloadAfterAction,
} from "../constants/findBookSettings";

defineProps<{
  draftCacheDir: string;
  draftDownloadDir: string;
  draftDownloadAfterAction: FindBookDownloadAfterAction;
  draftDownloadAddToMainFileList: boolean;
  draftDownloadDefaultCategory: string;
}>();

defineEmits<{
  "update:draftCacheDir": [v: string];
  "update:draftDownloadDir": [v: string];
  "update:draftDownloadAfterAction": [v: FindBookDownloadAfterAction];
  "update:draftDownloadAddToMainFileList": [v: boolean];
  "update:draftDownloadDefaultCategory": [v: string];
  clearCache: [];
}>();

const selectListsEmpty: CustomSelectItem[] = [];

const downloadAfterActionItems = computed<CustomSelectItem[]>(() =>
  FIND_BOOK_DOWNLOAD_AFTER_ACTION_OPTIONS.map((option) => ({
    kind: "item" as const,
    id: option.id,
    label: option.label,
  })),
);
</script>

<template>
  <div class="settingsDownloadRoot">
    <div class="settingsBody">
      <div class="settingsRow">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel short">下载目录</span>
          <div class="settingsEbookDirActions">
            <PathPickerInput
              :model-value="draftDownloadDir"
              is-directory
              placeholder="下载目录"
              aria-label="下载目录"
              class="settingsEbookPathPicker"
              @update:model-value="$emit('update:draftDownloadDir', $event)"
            />
          </div>
        </div>
        <p class="settingsHint">
          下载的整书将保存到该目录。
        </p>
      </div>

      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel">下载后加入主界面「文件」</span>
          <SwitchToggle
            :model-value="draftDownloadAddToMainFileList"
            aria-label="下载后加入主界面文件"
            @update:model-value="
              $emit('update:draftDownloadAddToMainFileList', $event)
            "
          />
        </div>
        <p class="settingsHint">
          下载完成后，将文件加入主界面侧栏「文件」列表。
        </p>
      </div>

      <div v-if="draftDownloadAddToMainFileList" class="settingsRow">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel">默认分类</span>
          <input
            class="settingsTextInput"
            type="text"
            :value="draftDownloadDefaultCategory"
            aria-label="默认分类"
            placeholder="留空则为未分类"
            @input="
              $emit(
                'update:draftDownloadDefaultCategory',
                ($event.target as HTMLInputElement).value,
              )
            "
          />
        </div>
        <p class="settingsHint">
          将文件自动归入该分类，若分类不存在则自动创建；留空时不设置分类，文件会显示在「未分类」。
        </p>
      </div>

      <div class="settingsRow">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel">下载完成后</span>
          <AppCustomSelect
            class="settingsSelect"
            :model-value="draftDownloadAfterAction"
            :display-label="
              labelForFindBookDownloadAfterAction(draftDownloadAfterAction)
            "
            :fixed-top-items="selectListsEmpty"
            :scroll-items="downloadAfterActionItems"
            :fixed-bottom-items="selectListsEmpty"
            :scroll-max-height="160"
            ariaLabel="下载完成后"
            @update:model-value="
              $emit(
                'update:draftDownloadAfterAction',
                $event as FindBookDownloadAfterAction,
              )
            "
          />
        </div>
      </div>
    </div>

    <div class="settingsBody">
      <div class="settingsRow">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel short">缓存目录</span>
          <div class="settingsEbookDirActions">
            <PathPickerInput
              :model-value="draftCacheDir"
              is-directory
              placeholder="缓存目录"
              aria-label="缓存目录"
              class="settingsEbookPathPicker"
              @update:model-value="$emit('update:draftCacheDir', $event)"
            />
          </div>
        </div>
        <p class="settingsHint">
          阅读与下载时的章节正文离线缓存目录。
        </p>
      </div>

      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel">清除缓存</span>
          <button
            class="btn warning"
            type="button"
            size="large"
            @click="$emit('clearCache')"
          >
            清除缓存
          </button>
        </div>
        <p class="settingsHint">
          清除缓存目录下的全部章节正文离线缓存。
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settingsDownloadRoot {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settingsBody {
  padding: 8px 0 4px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px;
  background-color: var(--bg);
  border-radius: 8px;
}

.settingsRow {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settingsRowMain {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
}

.settingsRowMain--baseline {
  align-items: baseline;
}

.settingsEbookDirActions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 1 1 65%;
  min-width: 0;
}

.settingsEbookPathPicker {
  flex: 1;
  min-width: 0;
  max-width: 100%;
}

.settingsSelect {
  width: 120px;
  flex: 0 0 120px;
}

.settingsTextInput {
  box-sizing: border-box;
  width: 120px;
  flex: 0 0 120px;
}

.settingsLabel {
  font-size: 14px;
  color: var(--fg);
  flex: 1 1 60%;
  min-width: 60%;
}

.settingsLabel.short {
  flex: 1 1 30%;
  min-width: 30%;
}

.settingsHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}
</style>
