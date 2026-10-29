<script setup lang="ts">
import { computed } from "vue";
import NumericInput from "./NumericInput.vue";
import SwitchToggle from "./SwitchToggle.vue";
import PathPickerInput from "./PathPickerInput.vue";
import {
  maxChapterMinCharCount,
  maxRecentFilesHistoryLimit,
  minChapterMinCharCount,
} from "../constants/appUi";
import { resolveDefaultUnpackedBooksDirSync } from "../utils/defaultCacheDirs";
import { icons } from "../icons";

defineProps<{
  draftRestore: boolean;
  draftSyncCurrentFile: boolean;
  draftRecentLimit: number;
  draftChapterMinCharCount: number;
  draftChapterCharCountExact: boolean;
  draftEbookConvertOutputDir: string;
  draftBookPackUnpackDir: string;
  draftBookPackPassword: string;
  showBookPackPassword: boolean;
}>();

defineEmits<{
  "update:draftRestore": [v: boolean];
  "update:draftSyncCurrentFile": [v: boolean];
  "update:draftRecentLimit": [v: number];
  "update:draftChapterMinCharCount": [v: number];
  "update:draftChapterCharCountExact": [v: boolean];
  "update:draftEbookConvertOutputDir": [v: string];
  "update:draftBookPackUnpackDir": [v: string];
  "update:draftBookPackPassword": [v: string];
  "update:showBookPackPassword": [v: boolean];
  openReadingData: [];
  clearCache: [];
}>();

/** 留空时实际使用的绝对路径，用作输入框 placeholder */
const bookPackUnpackDirPlaceholder = computed(() => {
  const p = resolveDefaultUnpackedBooksDirSync().trim();
  return p || "";
});
</script>

<template>
  <div class="settingsGeneralRoot">
    <div class="settingsBody">
      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel">启动时恢复上次关闭的文件</span>
          <SwitchToggle
            :model-value="draftRestore"
            aria-label="启动时恢复上次关闭的文件"
            @update:model-value="$emit('update:draftRestore', $event)"
          />
        </div>
        <p class="settingsHint">
          关闭后，退出应用时不再保存当前阅读会话（打开的文件及阅读位置）。
        </p>
      </div>

      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel">同步当前文件</span>
          <SwitchToggle
            :model-value="draftSyncCurrentFile"
            aria-label="同步当前文件"
            @update:model-value="$emit('update:draftSyncCurrentFile', $event)"
          />
        </div>
        <p class="settingsHint">
          开启后，如果当前正在阅读的文件被修改，将自动重新加载。
        </p>
      </div>

      <div class="settingsRow">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel">历史记录数量</span>
          <NumericInput
            :model-value="draftRecentLimit"
            :min="0"
            :max="maxRecentFilesHistoryLimit"
            integer
            aria-label="历史记录数量"
            @update:model-value="$emit('update:draftRecentLimit', $event)"
          />
        </div>
        <p class="settingsHint">
          最近打开文件的保留条数；设置为 0 时不记录最近打开的文件。
        </p>
      </div>
    </div>

    <div class="settingsBody settingsBody--chapter">
      <div class="settingsRow">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel">章节最少字数</span>
          <NumericInput
            :model-value="draftChapterMinCharCount"
            :min="minChapterMinCharCount"
            :max="maxChapterMinCharCount"
            integer
            aria-label="章节最少字数"
            @update:model-value="
              $emit('update:draftChapterMinCharCount', $event)
            "
          />
        </div>
        <p class="settingsHint">
          少于该字数的将不会被识别为章节；设置为 0 时不限制。
        </p>
      </div>

      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel">字数显示具体数值</span>
          <SwitchToggle
            :model-value="draftChapterCharCountExact"
            aria-label="字数显示具体数值"
            @update:model-value="
              $emit('update:draftChapterCharCountExact', $event)
            "
          />
        </div>
        <p class="settingsHint">
          开启后章节列表字数与底栏总字数显示为具体数值（如
          <code>23,123 字</code>，而不是 <code>2.3 万字</code>）。
        </p>
      </div>
    </div>

    <div class="settingsBody settingsBody--ebook">
      <h3 class="settingsSectionTitle settingsSectionTitle--ebook">电子书转换</h3>

      <div class="settingsRow">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel short">电子书转换缓存目录</span>
          <div class="settingsEbookDirActions">
            <PathPickerInput
              :model-value="draftEbookConvertOutputDir"
              is-directory
              placeholder="源文件目录"
              aria-label="电子书转换缓存目录"
              class="settingsEbookPathPicker"
              @update:model-value="
                $emit('update:draftEbookConvertOutputDir', $event)
              "
            />
          </div>
        </div>
        <p class="settingsHint">
          打开其他格式的电子书时，会自动转换为 <code>.md</code> 格式并缓存到该目录下；如果放空，将缓存到源文件同目录下。
        </p>
      </div>
    </div>

    <div class="settingsBody settingsBody--bookPack">
      <h3 class="settingsSectionTitle settingsSectionTitle--bookPack">书包</h3>

      <div class="settingsRow">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel short">书包解压目录</span>
          <div class="settingsEbookDirActions">
            <PathPickerInput
              :model-value="draftBookPackUnpackDir"
              is-directory
              :placeholder="bookPackUnpackDirPlaceholder"
              aria-label="书包解压目录"
              class="settingsEbookPathPicker"
              @update:model-value="
                $emit('update:draftBookPackUnpackDir', $event)
              "
            />
          </div>
        </div>
        <p class="settingsHint">
          导入书包时，如果「当前打开」「最近的文件」「文件列表」都没有同名书，将解压到该目录，并添加到「文件列表」。
        </p>
      </div>

      <div class="settingsRow">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel">书包默认密码</span>
          <div class="aiRowField">
            <div class="settingsPasswordRow aiPasswordRow">
              <input
                class="settingsStretchInput settingsPasswordRow__input"
                :value="draftBookPackPassword"
                :type="showBookPackPassword ? 'text' : 'password'"
                autocomplete="off"
                spellcheck="false"
                aria-label="书包默认密码"
                @input="
                  $emit(
                    'update:draftBookPackPassword',
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
              <button
                type="button"
                class="btn iconOnly"
                :title="showBookPackPassword ? '隐藏' : '显示'"
                @click="
                  $emit('update:showBookPackPassword', !showBookPackPassword)
                "
              >
                <span
                  class="iconSvg"
                  v-html="showBookPackPassword ? icons.view : icons.viewOff"
                />
              </button>
            </div>
          </div>
        </div>
        <p class="settingsHint">
          填写密码后，导出的书包将加密为 <code>.ctzx</code>，导入加密书包时需使用相同密码；留空则导出普通
          <code>.ctz</code>。
        </p>
      </div>
    </div>

    <div class="settingsBody settingsBody--dataManage">
      <div class="settingsRow settingsRow--cache">
        <div class="settingsRowMain">
          <span class="settingsLabel">数据管理</span>
          <div class="settingsDataManageActions">
            <button
              class="btn"
              type="button"
              size="large"
              @click="$emit('openReadingData')"
            >
              <span
                class="settingsDataManageBtnIcon"
                aria-hidden="true"
                v-html="icons.read"
              />
              阅读数据
            </button>
            <button
              class="btn danger"
              type="button"
              size="large"
              @click="$emit('clearCache')"
            >
              <span
                class="settingsDataManageBtnIcon"
                aria-hidden="true"
                v-html="icons.clear"
              />
              清除缓存
            </button>
          </div>
        </div>
        <p class="settingsHint">清除本地缓存数据（不影响界面相关的设置）。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settingsGeneralRoot {
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

.settingsSectionTitle {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
}

.settingsBody--ebook,
.settingsBody--chapter,
.settingsBody--bookPack {
  gap: 10px;
}

.settingsSectionTitle--ebook,
.settingsSectionTitle--chapter,
.settingsSectionTitle--bookPack {
  margin-bottom: 10px;
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

.settingsDataManageActions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 0 auto;
}

.settingsDataManageBtnIcon {
  display: inline-flex;
  line-height: 0;
  flex-shrink: 0;
}

.settingsDataManageBtnIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.settingsDataManageBtnIcon :deep(svg path) {
  fill: currentColor;
}

.settingsEbookPathPicker {
  flex: 1;
  min-width: 0;
  max-width: 100%;
}

.iconOnly {
  padding: 6px;
  flex-shrink: 0;
}

.iconSvg :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.iconSvg :deep(svg path) {
  fill: currentColor;
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
