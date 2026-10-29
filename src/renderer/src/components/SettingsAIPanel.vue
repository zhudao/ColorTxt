<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  DEFAULT_AI_QUICK_QUESTIONS,
  DEFAULT_WORDCLOUD_MAX_WORDS,
  MAX_TOOL_ROUNDS_MAX,
  MAX_TOOL_ROUNDS_MIN,
  WORDCLOUD_MAX_WORDS_MAX,
  WORDCLOUD_MAX_WORDS_MIN,
  defaultAIConfig,
  type AIConfig,
} from "@shared/aiTypes";
import {
  CHAT_API_PROVIDER_CUSTOM_ID,
  CHAT_API_PROVIDER_PRESETS,
  findChatProviderPresetByBaseUrl,
  isChatApiProviderCustomId,
  resolveChatProviderPresetIdFromBaseUrl,
} from "@shared/apiEndpointPresets";
import { sortChatModelsForBaseUrl } from "@shared/chatModelPresets";
import AppCustomSelect, { type CustomSelectItem } from "./AppCustomSelect.vue";
import ApiEndpointInput from "./ApiEndpointInput.vue";
import AppConnectionTestButton from "./AppConnectionTestButton.vue";
import type { ConnectionTestResult } from "../composables/useConnectionTest";
import AppPullFlashButton, { type AppPullFlashDone } from "./AppPullFlashButton.vue";
import NumericInput from "./NumericInput.vue";
import RangeSlider from "./RangeSlider.vue";
import PathPickerInput from "./PathPickerInput.vue";
import SwitchToggle from "./SwitchToggle.vue";
import { icons } from "../icons";
import { resolveDefaultAiDataCacheDirSync } from "../utils/defaultCacheDirs";
import { useSecretStorageHint } from "../composables/useSecretStorageHint";
import {
  SORTABLE_ROW_HANDLE_CLASS,
  useSortableReorder,
} from "../composables/useSortableReorder";
import { MAX_AI_ENDPOINT_PROFILES } from "@shared/aiEndpointProfiles";
import {
  AI_SYSTEM_PROMPT_PRESET_CUSTOM_ID,
  AI_SYSTEM_PROMPT_PRESET_NONE_ID,
  AI_SYSTEM_PROMPT_PRESETS,
  isBuiltInSystemPromptPresetMode,
  systemPromptPresetDisplayLabel,
  type SystemPromptExtraMode,
} from "@shared/aiSystemPromptPresets";
import { useChatProfileDraft } from "../composables/useAiEndpointProfileDraft";
import AiConfigProfileToolbar from "./AiConfigProfileToolbar.vue";

const modelValue = defineModel<AIConfig>({ required: true });
const chatProfileDraft = useChatProfileDraft(modelValue);
const { secretStorageHint } = useSecretStorageHint();

/** 留空时实际使用的绝对路径，用作输入框 placeholder */
const aiDataCacheDirPlaceholder = computed(() => {
  const p = resolveDefaultAiDataCacheDirSync().trim();
  return p || "";
});

const selectListsEmpty: CustomSelectItem[] = [];

const showChatKey = ref(false);
const chatModelsLoading = ref(false);
const chatPullBtnRef = ref<InstanceType<typeof AppPullFlashButton> | null>(null);
const chatModelOptions = ref<string[]>([]);

const chatEndpointFingerprint = computed(() => {
  const c = modelValue.value.chat;
  return `${c.baseUrl.trim()}\0${c.apiKey}\0${c.model.trim()}`;
});

/** 用户显式选中「自定义」且尚未填写地址时，仍保持下拉显示 */
const chatProviderExplicitId = ref("");

const chatProviderSelectItems = computed((): CustomSelectItem[] =>
  CHAT_API_PROVIDER_PRESETS.map((p) => ({
    kind: "item",
    id: p.id,
    label: p.label,
    description: p.listDescription?.trim() || p.baseUrl,
  })),
);

const chatProviderPresetId = computed(() => {
  if (chatProviderExplicitId.value) return chatProviderExplicitId.value;
  return resolveChatProviderPresetIdFromBaseUrl(modelValue.value.chat.baseUrl);
});

const chatProviderDisplayLabel = computed(() => {
  const id = chatProviderPresetId.value;
  if (!id) return "";
  return CHAT_API_PROVIDER_PRESETS.find((p) => p.id === id)?.label ?? "";
});

function onChatProviderPresetSelect(id: string) {
  chatProviderExplicitId.value = id;
  chatModelOptions.value = [];
  modelValue.value.chat.model = "";

  if (isChatApiProviderCustomId(id)) {
    modelValue.value.chat.baseUrl = "";
    return;
  }
  const hit = CHAT_API_PROVIDER_PRESETS.find((p) => p.id === id && !p.custom);
  if (hit?.baseUrl.trim()) modelValue.value.chat.baseUrl = hit.baseUrl;
}

watch(
  () => modelValue.value.chat.baseUrl,
  (url) => {
    const hit = findChatProviderPresetByBaseUrl(url);
    if (hit) {
      chatProviderExplicitId.value = hit.id;
      return;
    }
    if (url.trim()) {
      chatProviderExplicitId.value = CHAT_API_PROVIDER_CUSTOM_ID;
      return;
    }
    // 地址被清空：若此前选过固定服务商，视为改为自定义（避免全选删除后下拉变回占位符）
    if (
      chatProviderExplicitId.value &&
      !isChatApiProviderCustomId(chatProviderExplicitId.value)
    ) {
      chatProviderExplicitId.value = CHAT_API_PROVIDER_CUSTOM_ID;
      return;
    }
    if (chatProviderExplicitId.value !== CHAT_API_PROVIDER_CUSTOM_ID) {
      chatProviderExplicitId.value = "";
    }
  },
  { immediate: true },
);

function chatModelsEndpointKey(): string {
  const c = modelValue.value.chat;
  return `${c.baseUrl.trim()}\0${c.apiKey}`;
}

/** 接口地址或密钥变化后丢弃旧建议，下次聚焦再拉，避免点到别的服务商的模型 */
watch(chatModelsEndpointKey, () => {
  chatModelOptions.value = [];
});

let chatModelsReqSeq = 0;

async function refreshChatModels(opts?: { pullDone?: AppPullFlashDone }) {
  const pullDone = opts?.pullDone;
  const seq = ++chatModelsReqSeq;
  const endpointKey = chatModelsEndpointKey();
  chatModelsLoading.value = true;
  let ok = false;
  let aborted = false;
  try {
    const r = await window.colorTxt.ai.modelsList({
      baseUrl: modelValue.value.chat.baseUrl,
      apiKey: modelValue.value.chat.apiKey,
    });
    if (seq !== chatModelsReqSeq || chatModelsEndpointKey() !== endpointKey) {
      aborted = true;
      return;
    }
    ok = r.ok;
    if (r.ok) {
      chatModelOptions.value = sortChatModelsForBaseUrl(
        modelValue.value.chat.baseUrl,
        r.models,
      );
      // 仅在未填写模型时填入首个拉取结果；已填模型不强制覆盖（部分服务商无模型查询接口，允许手输）
      if (
        chatModelOptions.value.length > 0 &&
        !modelValue.value.chat.model.trim()
      ) {
        modelValue.value.chat.model = chatModelOptions.value[0]!;
      }
    } else chatModelOptions.value = [];
  } finally {
    if (seq !== chatModelsReqSeq) {
      pullDone?.("abort");
    } else {
      chatModelsLoading.value = false;
      if (aborted) pullDone?.("abort");
      else if (pullDone) pullDone(ok);
      else chatPullBtnRef.value?.clearStaleFailOnSilentSuccess(ok);
    }
  }
}

/** 聚焦模型输入且尚无建议列表时静默拉取。按钮聚焦不触发，避免抢先把「拉取模型」点成静默请求。 */
function onChatModelFocusIn(ev: FocusEvent) {
  if (!(ev.target instanceof HTMLInputElement)) return;
  if (chatModelsLoading.value) return;
  if (chatModelOptions.value.length > 0) return;
  void refreshChatModels();
}

let quickQRowIdSeq = 0;

function newQuickQRowId(): string {
  quickQRowIdSeq += 1;
  return `qq-${Date.now()}-${quickQRowIdSeq}`;
}

/** 与 quickQuestions 下标对齐，供 Sortable 拖动后 Vue 正确复用行 */
const quickQuestionRowIds = ref<string[]>([]);

function resetQuickQuestionRowIds(count: number) {
  quickQuestionRowIds.value = Array.from({ length: count }, () => newQuickQRowId());
}

function ensureQuickQuestionRowIds() {
  const n = modelValue.value.quickQuestions.length;
  const ids = quickQuestionRowIds.value;
  if (ids.length === n) return;
  if (ids.length < n) {
    quickQuestionRowIds.value = [
      ...ids,
      ...Array.from({ length: n - ids.length }, () => newQuickQRowId()),
    ];
    return;
  }
  quickQuestionRowIds.value = ids.slice(0, n);
}

watch(
  () => modelValue.value.quickQuestions.length,
  () => ensureQuickQuestionRowIds(),
  { immediate: true },
);

function addQuickQuestion() {
  modelValue.value.quickQuestions.push("");
  quickQuestionRowIds.value.push(newQuickQRowId());
}

function restoreDefaultQuickQuestions() {
  modelValue.value.quickQuestions = [...DEFAULT_AI_QUICK_QUESTIONS];
  resetQuickQuestionRowIds(modelValue.value.quickQuestions.length);
}

/** 「重置当前页」：当前对话方案 + 本页全局项（Token、缓存目录、思维导图、词云、快速提问） */
function resetAiPageDraft() {
  chatProfileDraft.resetCurrentProfileChat();
  const def = defaultAIConfig;
  modelValue.value.showTokenUsage = def.showTokenUsage;
  modelValue.value.aiDataCacheDir = resolveDefaultAiDataCacheDirSync();
  modelValue.value.autoMindmapOnSummaryAndCharacters =
    def.autoMindmapOnSummaryAndCharacters;
  modelValue.value.wordcloudMaxWords = def.wordcloudMaxWords;
  restoreDefaultQuickQuestions();
}

function removeQuickQuestion(i: number) {
  const q = modelValue.value.quickQuestions;
  if (q.length <= 1) return;
  q.splice(i, 1);
  quickQuestionRowIds.value.splice(i, 1);
}

const quickQListRef = ref<HTMLElement | null>(null);
const quickQCount = computed(() => modelValue.value.quickQuestions.length);

const { remount: remountQuickQSortable } = useSortableReorder({
  containerRef: quickQListRef,
  draggable: ".quickQRow",
  itemCount: quickQCount,
  enabled: computed(() => modelValue.value.quickQuestions.length > 1),
  onReorder(from, to) {
    const q = modelValue.value.quickQuestions;
    const ids = quickQuestionRowIds.value;
    const [row] = q.splice(from, 1);
    const [id] = ids.splice(from, 1);
    if (!row || !id) return;
    q.splice(to, 0, row);
    ids.splice(to, 0, id);
    remountQuickQSortable();
  },
});

async function runChatConnectionTest(): Promise<ConnectionTestResult> {
  const r = await window.colorTxt.ai.testChat({
    baseUrl: modelValue.value.chat.baseUrl,
    apiKey: modelValue.value.chat.apiKey,
    model: modelValue.value.chat.model,
  });
  if (r.ok) return { ok: true };
  return { ok: false, error: r.error };
}

const systemPromptPresetSelectItems = computed((): CustomSelectItem[] =>
  AI_SYSTEM_PROMPT_PRESETS.map((p) => ({
    kind: "item",
    id: p.id,
    label: p.label,
    description: p.description,
  })),
);

const showSystemPromptExtraEditor = computed(
  () =>
    modelValue.value.chat.systemPromptExtraMode !==
    AI_SYSTEM_PROMPT_PRESET_NONE_ID,
);

let applyingSystemPromptPresetText = false;

function onSystemPromptModeSelect(id: string) {
  const mode = id as SystemPromptExtraMode;
  modelValue.value.chat.systemPromptExtraMode = mode;
  const hit = AI_SYSTEM_PROMPT_PRESETS.find((p) => p.id === mode);
  if (hit && isBuiltInSystemPromptPresetMode(mode)) {
    applyingSystemPromptPresetText = true;
    modelValue.value.chat.systemPromptExtra = hit.text;
    applyingSystemPromptPresetText = false;
  }
}

watch(
  () => modelValue.value.chat.systemPromptExtra,
  (text) => {
    if (applyingSystemPromptPresetText) return;
    const mode = modelValue.value.chat.systemPromptExtraMode;
    if (!isBuiltInSystemPromptPresetMode(mode)) return;
    const preset = AI_SYSTEM_PROMPT_PRESETS.find((p) => p.id === mode);
    if (preset && preset.text.trim() !== text.trim()) {
      modelValue.value.chat.systemPromptExtraMode =
        AI_SYSTEM_PROMPT_PRESET_CUSTOM_ID;
    }
  },
);

const chatProfileToolbarProfiles = computed(
  () => chatProfileDraft.profileSelectItems.value,
);
const chatProfileToolbarEditingId = computed(
  () => chatProfileDraft.editingId.value,
);
const chatProfileToolbarDisplayName = computed(
  () => chatProfileDraft.editingDisplayName.value,
);
const chatProfileToolbarPlaceholder = computed(
  () => chatProfileDraft.editingProviderLabel.value,
);

function onChatProfileEditingIdChange(id: string) {
  chatProfileDraft.selectEditingProfile(id);
}

function initChatProfiles() {
  chatProfileDraft.initFromConfig();
}

defineExpose({
  finalizeChatProfiles: chatProfileDraft.finalizeBeforeSave,
  initChatProfiles,
  resetCurrentChatProfile: chatProfileDraft.resetCurrentProfileChat,
  resetAiPageDraft,
});

</script>

<template>
  <div class="settingsBody">
    <section class="aiSection aiSection--compact">
      <div class="aiMasterToggleRow">
        <span class="settingsLabel aiMasterToggleLabel"
          >启用「AI 阅读助手」功能</span
        >
        <SwitchToggle
          v-model="modelValue.aiEnabled"
          aria-label="启用AI阅读助手功能"
        />
      </div>
      <p class="aiMasterHint">启用后，会在侧栏显示「AI 阅读助手」入口。</p>
    </section>
    <template v-if="modelValue.aiEnabled">
      <section class="aiSection aiSection--compact">
        <AiConfigProfileToolbar
          :profiles="chatProfileToolbarProfiles"
          :editing-id="chatProfileToolbarEditingId"
          :display-name="chatProfileToolbarDisplayName"
          :placeholder="chatProfileToolbarPlaceholder"
          :max-profiles="MAX_AI_ENDPOINT_PROFILES"
          @update:editing-id="onChatProfileEditingIdChange"
          @add="chatProfileDraft.addProfile()"
          @rename="void chatProfileDraft.renameProfile()"
          @delete="chatProfileDraft.deleteProfile()"
        />
      </section>

      <section class="aiSection">
        <h3 class="aiSectionTitle">对话模型</h3>
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">服务商</span>
            <AppCustomSelect
              class="aiChatProviderSelect"
              :model-value="chatProviderPresetId"
              :display-label="chatProviderDisplayLabel"
              placeholder="选择服务商…"
              :fixed-top-items="selectListsEmpty"
              :scroll-items="chatProviderSelectItems"
              :fixed-bottom-items="selectListsEmpty"
              :scroll-max-height="320"
              ariaLabel="对话模型服务商"
              @update:model-value="onChatProviderPresetSelect"
            />
          </div>
        </div>
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">接口地址</span>
            <ApiEndpointInput
              v-model="modelValue.chat.baseUrl"
              :suggestions="[]"
              input-class="aiRowStretchInput"
              aria-label="对话模型接口地址"
            />
          </div>
        </div>
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">API 密钥</span>
            <div class="aiRowField">
              <div class="settingsPasswordRow aiPasswordRow">
                <input
                  v-model="modelValue.chat.apiKey"
                  class="settingsStretchInput settingsPasswordRow__input"
                  :type="showChatKey ? 'text' : 'password'"
                  autocomplete="off"
                  spellcheck="false"
                />
                <button
                  type="button"
                  class="btn iconOnly"
                  :title="showChatKey ? '隐藏' : '显示'"
                  @click="showChatKey = !showChatKey"
                >
                  <span
                    class="iconSvg"
                    v-html="showChatKey ? icons.view : icons.viewOff"
                  />
                </button>
              </div>
            </div>
          </div>
          <p class="settingsHint">{{ secretStorageHint }}</p>
        </div>
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">模型</span>
            <div class="aiChatModelRow">
              <div
                class="aiModelToolbar aiChatModelToolbar"
                @focusin="onChatModelFocusIn"
              >
                <ApiEndpointInput
                  v-model="modelValue.chat.model"
                  :suggestions="chatModelOptions"
                  placeholder="输入模型 ID…"
                  input-class="aiRowStretchInput"
                  aria-label="对话模型"
                  :scroll-max-height="260"
                />
                <AppPullFlashButton
                  ref="chatPullBtnRef"
                  label="拉取模型"
                  :busy="chatModelsLoading"
                  @pull="(done) => void refreshChatModels({ pullDone: done })"
                />
                <AppConnectionTestButton
                  :fingerprint="chatEndpointFingerprint"
                  :on-test="runChatConnectionTest"
                />
              </div>
            </div>
          </div>
        </div>
        <div class="settingsRow">
          <div class="settingsRowMain">
            <span class="settingsLabel"
              >温度（{{ modelValue.chat.temperature }}）</span
            >
            <RangeSlider
              v-model="modelValue.chat.temperature"
              :min="0"
              :max="1"
              :step="0.1"
              :show-percent="false"
              class="temperatureSlider"
            />
          </div>
          <p class="settingsHint">
            控制回答的随机程度：越低越稳定、越贴近检索结果；越高越发散、更有变化。建议
            0.3～0.7。
          </p>
        </div>
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel"
              >最大 Token 数（{{ modelValue.chat.maxTokens }}）</span
            >
            <NumericInput
              v-model="modelValue.chat.maxTokens"
              :min="256"
              :max="128000"
              integer
            />
          </div>
          <p class="settingsHint">
            单次回复允许生成的最大 Token 数：过小可能会截断长回答，过大则更慢、更耗额度。<br />「智能排版」等长输出可适当调高。
          </p>
        </div>
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel"
              >上下文长度（{{ modelValue.chat.slidingWindowSize }} 轮）</span
            >
            <NumericInput
              v-model="modelValue.chat.slidingWindowSize"
              :min="1"
              :max="64"
              integer
            />
          </div>
          <p class="settingsHint">
            发给模型的历史对话保留轮数；数值越大，上下文越完整，但也会占用更多 Token。
          </p>
        </div>
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel"
              >工具调用轮数（{{ modelValue.chat.maxToolRounds }} 轮）</span
            >
            <NumericInput
              v-model="modelValue.chat.maxToolRounds"
              :min="MAX_TOOL_ROUNDS_MIN"
              :max="MAX_TOOL_ROUNDS_MAX"
              integer
            />
          </div>
          <p class="settingsHint">
            单次提问内，模型调用检索/读章等工具的最大往返次数；复杂问题可适当调高，过大可能更慢、更耗
            Token。
          </p>
        </div>
        <div class="settingsRow aiSystemPromptPresetRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">附加系统提示词</span>
            <AppCustomSelect
              class="aiChatProviderSelect"
              :model-value="modelValue.chat.systemPromptExtraMode"
              :display-label="
                systemPromptPresetDisplayLabel(
                  modelValue.chat.systemPromptExtraMode,
                )
              "
              placeholder="选择预设…"
              :fixed-top-items="selectListsEmpty"
              :scroll-items="systemPromptPresetSelectItems"
              :fixed-bottom-items="selectListsEmpty"
              :scroll-max-height="280"
              ariaLabel="附加系统提示词预设"
              @update:model-value="onSystemPromptModeSelect"
            />
          </div>
          <p class="settingsHint">
            分析敏感题材小说时，可一定程度上减少拒答（云端模型仍可能在服务端拒答，本地未审查模型通常更有效。）
          </p>
        </div>
        <div
          v-if="showSystemPromptExtraEditor"
          class="settingsRow aiSystemPromptTextareaRow"
        >
          <textarea
            id="ai-system-prompt-extra"
            v-model="modelValue.chat.systemPromptExtra"
            class="settingsStretchTextarea settingsStretchTextarea--multiline"
            rows="6"
            spellcheck="false"
            placeholder="可选择预设后再进行修改；留空表示不附加。"
          />
        </div>
      </section>

      <section class="aiSection aiSection--compact">
        <div class="aiMasterToggleRow">
          <span class="settingsLabel aiMasterToggleLabel"
            >显示 Token 消耗量</span
          >
          <SwitchToggle
            v-model="modelValue.showTokenUsage"
            aria-label="显示 Token 消耗量"
          />
        </div>
        <template v-if="modelValue.showTokenUsage">
          <h3 class="aiSectionTitle aiTokenPriceTitle">每百万 Token 价格</h3>
          <p class="settingsHint aiTokenPriceHint">
            如果设置了输入和输出价格，在显示 Token 消耗量时会自动计算并显示总花费；<br />只设置一个输入价格时，全部输入 Token 会按该价格计算。
          </p>
          <div class="settingsRow">
            <div class="settingsRowMain settingsRowMain--baseline">
              <span class="settingsLabel">输入（缓存命中）</span>
              <NumericInput
                v-model="modelValue.chat.tokenPricePerMillion.inputCacheHit"
                :min="0"
                :step="0.01"
                aria-label="输入缓存命中每百万 Token 价格"
              />
            </div>
          </div>
          <div class="settingsRow">
            <div class="settingsRowMain settingsRowMain--baseline">
              <span class="settingsLabel">输入（缓存未命中）</span>
              <NumericInput
                v-model="modelValue.chat.tokenPricePerMillion.inputCacheMiss"
                :min="0"
                :step="0.01"
                aria-label="输入缓存未命中每百万 Token 价格"
              />
            </div>
          </div>
          <div class="settingsRow">
            <div class="settingsRowMain settingsRowMain--baseline">
              <span class="settingsLabel">输出</span>
              <NumericInput
                v-model="modelValue.chat.tokenPricePerMillion.output"
                :min="0"
                :step="0.01"
                aria-label="输出每百万 Token 价格"
              />
            </div>
          </div>
        </template>
      </section>

      <section class="aiSection aiSection--compact">
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">数据缓存目录</span>
            <div class="aiDataCacheActions">
              <PathPickerInput
                v-model="modelValue.aiDataCacheDir"
                is-directory
                :placeholder="aiDataCacheDirPlaceholder"
                aria-label="AI 数据缓存目录"
                class="aiDataCachePicker"
              />
            </div>
          </div>
        </div>
        <p class="aiMasterHint">
          存放 AI 配置与向量库/对话记录。
        </p>
      </section>

      <section class="aiSection aiSection--compact">
        <div class="aiMasterToggleRow">
          <span class="settingsLabel aiMasterToggleLabel"
            >生成思维导图</span
          >
          <SwitchToggle
            v-model="modelValue.autoMindmapOnSummaryAndCharacters"
            aria-label="生成思维导图"
          />
        </div>
        <p class="aiMasterHint">
          开启后，当问题涉及「内容概括」或「人物关系」时，阅读助手会自动生成思维导图；<br />关闭后，也可以在问题中带上「思维导图」等关键字来让阅读助手生成思维导图。
        </p>
      </section>

      <section class="aiSection aiSection--compact">
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel"
              >词云图词项上限（{{ modelValue.wordcloudMaxWords }}）</span
            >
            <NumericInput
              v-model="modelValue.wordcloudMaxWords"
              :min="WORDCLOUD_MAX_WORDS_MIN"
              :max="WORDCLOUD_MAX_WORDS_MAX"
              integer
            />
          </div>
        </div>
        <p class="aiMasterHint">
          词云图最多展示的高频词数量；默认 {{ DEFAULT_WORDCLOUD_MAX_WORDS }}，范围
          {{ WORDCLOUD_MAX_WORDS_MIN }}～{{ WORDCLOUD_MAX_WORDS_MAX }}。
        </p>
      </section>

      <section class="aiSection quickQSection">
        <h3 class="aiSectionTitle">快速提问</h3>
        <div ref="quickQListRef" class="quickQList">
          <div
            v-for="(_q, i) in modelValue.quickQuestions"
            :key="quickQuestionRowIds[i]"
            class="quickQRow"
          >
            <input
              v-model="modelValue.quickQuestions[i]"
              type="text"
              class="settingsStretchInput quickQInput"
              autocomplete="off"
              spellcheck="false"
              placeholder="提问内容…"
            />
            <div class="quickQRowActions">
              <button
                type="button"
                class="btn iconOnly quickQReorder"
                :class="SORTABLE_ROW_HANDLE_CLASS"
                title="拖动排序"
                aria-label="拖动排序"
                :disabled="modelValue.quickQuestions.length <= 1"
              >
                <span class="iconSvg" v-html="icons.move" />
              </button>
              <button
                type="button"
                class="btn iconOnly quickQRemove"
                title="删除"
                :disabled="modelValue.quickQuestions.length <= 1"
                @click="removeQuickQuestion(i)"
              >
                <span class="iconSvg" v-html="icons.remove" />
              </button>
            </div>
          </div>
        </div>
        <div class="quickQActions">
          <button type="button" class="btn quickQAdd" @click="addQuickQuestion">
            <span class="iconSvg" v-html="icons.add" />
            添加一项
          </button>
          <button
            type="button"
            class="btn quickQRestore"
            @click="restoreDefaultQuickQuestions"
          >
            恢复默认
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.settingsBody {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.aiSection {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px;
  background-color: var(--bg);
  border-radius: 8px;
}

.aiSection--compact {
  gap: 12px;
}

.aiMasterToggleRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
}

.aiMasterToggleLabel {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
}

.aiMasterHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.aiSectionTitle {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
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

.settingsLabel {
  font-size: 14px;
  color: var(--fg);
  white-space: nowrap;
  flex: 1 1 60%;
}

.settingsLabel.short {
  flex: 1 1 30%;
  min-width: 30%;
}

.aiDataCacheActions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 1 1 65%;
  min-width: 0;
}


.aiChatProviderSelect {
  flex: 1 1 0;
  min-width: 0;
  max-width: 100%;
}

.aiRowStretchInput {
  flex: 1 1 0;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}

.aiRowField {
  flex: 1 1 0;
  min-width: 0;
  max-width: 100%;
}

.aiPasswordRow {
  width: 100%;
}

.aiChatModelRow {
  flex: 1 1 65%;
  min-width: 0;
  max-width: 100%;
}

.aiChatModelToolbar {
  flex-wrap: wrap;
  justify-content: flex-end;
  width: 100%;
}

.aiChatModelToolbar :deep(.apiEndpointInput) {
  flex: 1 1 160px;
  min-width: 0;
  max-width: 100%;
}

.aiDataCachePicker {
  flex: 1;
  min-width: 0;
  max-width: 100%;
}

.settingsStretchInput,
.settingsStretchTextarea {
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
}

.settingsStretchTextarea--multiline {
  font-family: inherit;
  line-height: 1.45;
}

.aiSystemPromptPresetRow {
  gap: 6px;
}

.aiSystemPromptTextareaRow {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  margin-top: -10px;
}

.settingsPasswordRow {
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
}

.settingsPasswordRow__input {
  flex: 1;
  min-width: 0;
}

.aiTokenPriceTitle {
  margin-top: 4px;
}

.aiTokenPriceHint {
  margin: 0;
}

.settingsHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}

.quickQSection {
  gap: 5px;
}

.quickQSection .aiSectionTitle {
  margin-bottom: 15px;
}

.quickQList {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.iconOnly {
  padding: 6px;
  flex-shrink: 0;
}

.iconSvg :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;

  path {
    fill: currentColor;
  }
}

.aiModelToolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.temperatureSlider {
  width: 150px;
}
.quickQRow {
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
}

.quickQInput {
  flex: 1;
  min-width: 0;
}

.quickQRowActions {
  display: flex;
  align-items: stretch;
  gap: 4px;
  flex-shrink: 0;
}

.quickQReorder,
.quickQRemove {
  flex-shrink: 0;
}

.quickQReorder.sortableRowHandle:not(:disabled) {
  cursor: grab;
}

.quickQReorder.sortableRowHandle:not(:disabled):active {
  cursor: grabbing;
}

:deep(.quickQRow.sortableRowGhost) {
  opacity: 0.45;
}

:deep(.quickQRow.sortableRowChosen) {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border-radius: 6px;
}

.quickQRemove:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}

.quickQAdd {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.quickQActions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.quickQAdd .iconSvg :deep(svg) {
  width: 16px;
  height: 16px;
}
</style>
