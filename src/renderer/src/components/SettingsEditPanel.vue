<script setup lang="ts">
import type {
  AiSmartFormatSettings,
  AiSmartFormatUnifyDialogueQuotes,
} from "@shared/aiSmartFormatTypes";
import {
  AI_SMART_FORMAT_DIALOGUE_QUOTE_OPTIONS,
  aiSmartFormatDialogueQuoteLabel,
} from "@shared/aiSmartFormatTypes";
import AppCustomSelect, { type CustomSelectItem } from "./AppCustomSelect.vue";
import SwitchToggle from "./SwitchToggle.vue";
import { icons } from "../icons.js";

withDefaults(
  defineProps<{
    draftReaderEditShowLineNumbers: boolean;
    draftReaderEditMinimap: boolean;
    draftEditAutoRefreshChapterList?: boolean;
    /** 与 AI 阅读助手总开关联动：为 false 时不展示智能排版配置 */
    aiFeaturesEnabled?: boolean;
    draftAiSmartFormat?: AiSmartFormatSettings;
    /** 为 false 时隐藏「自动刷新章节列表」与「AI 智能排版」（找书设置） */
    showMainOnlyEditOptions?: boolean;
  }>(),
  {
    draftEditAutoRefreshChapterList: false,
    aiFeaturesEnabled: false,
    showMainOnlyEditOptions: true,
  },
);

const emit = defineEmits<{
  "update:draftReaderEditShowLineNumbers": [v: boolean];
  "update:draftReaderEditMinimap": [v: boolean];
  "update:draftEditAutoRefreshChapterList": [v: boolean];
  "update:draftAiSmartFormat": [v: AiSmartFormatSettings];
}>();

const selectListsEmpty: CustomSelectItem[] = [];

const dialogueQuoteSelectItems: CustomSelectItem[] =
  AI_SMART_FORMAT_DIALOGUE_QUOTE_OPTIONS.map((o) => ({
    kind: "item",
    id: o.id,
    label: o.label,
  }));

function updateSmart<K extends keyof AiSmartFormatSettings>(
  key: K,
  value: AiSmartFormatSettings[K],
  current: AiSmartFormatSettings,
) {
  emit("update:draftAiSmartFormat", { ...current, [key]: value });
}
</script>

<template>
  <div class="settingsEditRoot">
    <div class="settingsBody">
      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel">显示行号</span>
          <SwitchToggle
            :model-value="draftReaderEditShowLineNumbers"
            aria-label="显示行号"
            @update:model-value="
              $emit('update:draftReaderEditShowLineNumbers', $event)
            "
          />
        </div>
      </div>

      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel">启用小地图</span>
          <SwitchToggle
            :model-value="draftReaderEditMinimap"
            aria-label="启用小地图"
            @update:model-value="$emit('update:draftReaderEditMinimap', $event)"
          />
        </div>
      </div>

      <div v-if="showMainOnlyEditOptions" class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel">自动刷新章节列表</span>
          <SwitchToggle
            :model-value="draftEditAutoRefreshChapterList"
            aria-label="自动刷新章节列表"
            @update:model-value="
              $emit('update:draftEditAutoRefreshChapterList', $event)
            "
          />
        </div>
        <p class="settingsHint">
          如果内容少于 30 万行，内容变更时同步更新章节列表。
        </p>
      </div>
    </div>

    <div
      v-if="showMainOnlyEditOptions && aiFeaturesEnabled && draftAiSmartFormat"
      class="settingsBody"
    >
      <h3 class="settingsSectionTitle">
        <span class="settingsIcon" v-html="icons.aiCompose" />
        AI 智能排版
      </h3>

      <div class="settingsSubsectionDivider" role="separator">
        <span class="settingsSubsectionDividerLabel">预处理</span>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel">清理 HTML 残留</span>
          <SwitchToggle
            :model-value="draftAiSmartFormat.cleanHtmlRemnants"
            aria-label="清理 HTML 残留"
            @update:model-value="
              updateSmart('cleanHtmlRemnants', $event, draftAiSmartFormat)
            "
          />
        </div>
        <p class="settingsHint">
          本地解码 <code>&amp;#35498;</code> 与 <code>&amp;nbsp;</code> 等 HTML 实体，并去除 <code>&lt;br /&gt;</code> 等 HTML 残留。
        </p>
      </div>

      <div class="settingsSubsectionDivider" role="separator">
        <span class="settingsSubsectionDividerLabel">AI 处理</span>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel">修正硬换行</span>
          <SwitchToggle
            :model-value="draftAiSmartFormat.mergeHardWrap"
            aria-label="修正硬换行"
            @update:model-value="
              updateSmart('mergeHardWrap', $event, draftAiSmartFormat)
            "
          />
        </div>
        <p class="settingsHint">
          将同一自然段内因排版产生的句中强行换行合并为一行。
        </p>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel">修正标点符号</span>
          <SwitchToggle
            :model-value="draftAiSmartFormat.fixPunctuation"
            aria-label="修正标点符号"
            @update:model-value="
              updateSmart('fixPunctuation', $event, draftAiSmartFormat)
            "
          />
        </div>
        <p class="settingsHint">
          引号/括号配对、半角转全角、断句补标点等；不改动数字小数点与英文对白中的半角标点。
        </p>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel">统一对话符号</span>
          <AppCustomSelect
            class="settingsSelect"
            :model-value="draftAiSmartFormat.unifyDialogueQuotes"
            :display-label="
              aiSmartFormatDialogueQuoteLabel(
                draftAiSmartFormat.unifyDialogueQuotes,
              )
            "
            :fixed-top-items="selectListsEmpty"
            :scroll-items="dialogueQuoteSelectItems"
            :fixed-bottom-items="selectListsEmpty"
            :scroll-max-height="160"
            ariaLabel="统一对话符号"
            @update:model-value="
              updateSmart(
                'unifyDialogueQuotes',
                $event as AiSmartFormatUnifyDialogueQuotes,
                draftAiSmartFormat,
              )
            "
          />
        </div>
        <p class="settingsHint">
          将对话统一为 <code>“”</code> 或 <code>「」</code> 包裹。
        </p>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel settingsLabel--warning">修正乱码</span>
          <SwitchToggle
            :model-value="draftAiSmartFormat.restoreGarbledChars"
            aria-label="修正乱码"
            @update:model-value="
              updateSmart('restoreGarbledChars', $event, draftAiSmartFormat)
            "
          />
        </div>
        <p class="settingsHint">
          尝试将 <code>锟斤拷</code> <code>�</code> 等乱码还原为合理汉字；有一定误还原风险，请自行检查。
        </p>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel settingsLabel--warning">还原 * 屏蔽</span>
          <SwitchToggle
            :model-value="draftAiSmartFormat.restoreAsteriskMasks"
            aria-label="还原星号屏蔽"
            @update:model-value="
              updateSmart('restoreAsteriskMasks', $event, draftAiSmartFormat)
            "
          />
        </div>
        <p class="settingsHint">
          尝试根据上下文还原正文里的 <code>*</code> 和谐字；不处理整行分隔线（如
          <code>***********</code>）；可能误猜，请自行检查。
        </p>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel settingsLabel--warning">移除盗版水印</span>
          <SwitchToggle
            :model-value="draftAiSmartFormat.removePiracyWatermarks"
            aria-label="移除盗版水印"
            @update:model-value="
              updateSmart('removePiracyWatermarks', $event, draftAiSmartFormat)
            "
          />
        </div>
        <p class="settingsHint">
          删除句中插入的防盗版杂符（如 <code>月*漪〇/泣②sa/</code>）；有一定误删风险，请自行检查。
        </p>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel settingsLabel--warning">移除广告/引流信息</span>
          <SwitchToggle
            :model-value="draftAiSmartFormat.removePromotionalContent"
            aria-label="移除广告/引流信息"
            @update:model-value="
              updateSmart('removePromotionalContent', $event, draftAiSmartFormat)
            "
          />
        </div>
        <p class="settingsHint">
          删除 <code>发布于 www.xxx.com</code> <code>看小说，就来 xxx 网</code> 等站宣水印；有一定误删风险，请自行检查。
        </p>
      </div>

      <div class="settingsSubsectionDivider" role="separator">
        <span class="settingsSubsectionDividerLabel">后置处理</span>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel">压缩空行</span>
          <SwitchToggle
            :model-value="draftAiSmartFormat.autoCompressBlank"
            aria-label="压缩空行"
            @update:model-value="
              updateSmart('autoCompressBlank', $event, draftAiSmartFormat)
            "
          />
        </div>
        <p class="settingsHint">自动应用「格式化：压缩空行」。</p>
      </div>
      <div class="settingsRow">
        <div class="settingsRowMain">
          <span class="settingsLabel">行首缩进</span>
          <SwitchToggle
            :model-value="draftAiSmartFormat.autoLeadIndent"
            aria-label="行首缩进"
            @update:model-value="
              updateSmart('autoLeadIndent', $event, draftAiSmartFormat)
            "
          />
        </div>
        <p class="settingsHint">自动应用「格式化：行首缩进」。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settingsEditRoot {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settingsBody {
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

.settingsSubsectionDivider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0;
}

.settingsSubsectionDivider::before,
.settingsSubsectionDivider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--border);
}

.settingsSubsectionDividerLabel {
  flex: 0 0 auto;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
  white-space: nowrap;
}

.settingsSubsectionHint {
  margin-top: -12px;
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

.settingsSelect {
  flex: 0 1 140px;
  min-width: 108px;
  max-width: 160px;
}

.settingsLabel {
  font-size: 14px;
  color: var(--fg);
  flex: 1 1 60%;
  min-width: 60%;
}

.settingsLabel--warning {
  color: var(--warning);
}

.settingsHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.settingsIcon {
  display: inline-block;
  width: 16px;
  height: 16px;
  vertical-align: middle;
}
.settingsIcon :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;
}
.settingsIcon :deep(svg path) {
  fill: currentColor;
}
</style>
