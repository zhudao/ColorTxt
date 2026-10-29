<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import AppModal from "./AppModal.vue";
import AppCustomSelect, { type CustomSelectItem } from "./AppCustomSelect.vue";
import AiConfigProfileToolbar from "./AiConfigProfileToolbar.vue";
import ApiEndpointInput from "./ApiEndpointInput.vue";
import AppPullFlashButton, {
  type AppPullFlashDone,
} from "./AppPullFlashButton.vue";
import SwitchToggle from "./SwitchToggle.vue";
import { icons } from "../icons";
import {
  MAX_TRANSLATION_AI_PROFILES,
  DEFAULT_TRANSLATION_AI_MAX_TOKENS,
  TRANSLATION_AI_MAX_TOKENS_MIN,
  TRANSLATION_AI_MAX_TOKENS_MAX,
  applyActiveAiProfileToFlat,
  createTranslationAiProfile,
  mergeTranslationSettings,
  resolveTranslationAiProfileProviderLabel,
  selectTranslationAiProfile,
  syncFlatAiIntoActiveProfile,
} from "../constants/translationSettings";
import { EMPTY_TOKEN_PRICE_PER_MILLION } from "@shared/aiTypes";
import type { AITokenPricePerMillion } from "@shared/aiTypes";
import { useSecretStorageHint } from "../composables/useSecretStorageHint";
import { appPrompt } from "../services/appDialog";
import NumericInput from "./NumericInput.vue";
import {
  CHAT_API_PROVIDER_CUSTOM_ID,
  CHAT_API_PROVIDER_PRESETS,
  findChatProviderPresetByBaseUrl,
  isChatApiProviderCustomId,
  resolveChatProviderPresetIdFromBaseUrl,
} from "@shared/apiEndpointPresets";
import { sortChatModelsForBaseUrl } from "@shared/chatModelPresets";
import {
  TRANSLATION_PROVIDER_IDS,
  TRANSLATION_PROVIDER_LABELS,
  TRANSLATION_PROVIDER_DESCRIPTIONS,
  TRANSLATION_TARGET_LANGS,
  type TranslationProviderId,
  type TranslationSettings,
} from "@shared/translationTypes";

const open = defineModel<boolean>({ default: false });

const props = defineProps<{
  settings: TranslationSettings;
}>();

const emit = defineEmits<{
  "update:settings": [v: TranslationSettings];
}>();

const { secretStorageHint } = useSecretStorageHint();

const showSecret = reactive<Record<string, boolean>>({});
const selectListsEmpty: CustomSelectItem[] = [];

/** 用户显式选中「自定义」且尚未填写地址时，仍保持下拉显示 */
const aiProviderExplicitId = ref("");
const aiModelOptions = ref<string[]>([]);
const aiModelsLoading = ref(false);
const aiPullBtnRef = ref<InstanceType<typeof AppPullFlashButton> | null>(null);

const aiProfileToolbarProfiles = computed(() =>
  props.settings.aiProfiles.map((p) => {
    const ep =
      p.id === props.settings.activeAiProfileId
        ? {
            baseUrl: props.settings.aiBaseUrl,
            apiKey: props.settings.aiApiKey,
            model: props.settings.aiModel,
            maxTokens: props.settings.aiMaxTokens,
            tokenPricePerMillion: props.settings.aiTokenPricePerMillion,
          }
        : p.endpoint;
    const providerLabel = resolveTranslationAiProfileProviderLabel(ep);
    return {
      id: p.id,
      listLabel: p.name.trim() || providerLabel || "未命名方案",
    };
  }),
);

const aiProfileDisplayName = computed(() => {
  const hit = props.settings.aiProfiles.find(
    (p) => p.id === props.settings.activeAiProfileId,
  );
  return hit?.name.trim() ?? "";
});

const aiProfilePlaceholder = computed(() =>
  resolveTranslationAiProfileProviderLabel({
    baseUrl: props.settings.aiBaseUrl,
    apiKey: props.settings.aiApiKey,
    model: props.settings.aiModel,
    maxTokens: props.settings.aiMaxTokens,
    tokenPricePerMillion: props.settings.aiTokenPricePerMillion,
  }),
);

const providerItems = computed<CustomSelectItem[]>(() =>
  TRANSLATION_PROVIDER_IDS.map((id) => ({
    kind: "item" as const,
    id,
    label: TRANSLATION_PROVIDER_LABELS[id],
    description: TRANSLATION_PROVIDER_DESCRIPTIONS[id],
  })),
);

const providerLabel = computed(
  () =>
    TRANSLATION_PROVIDER_LABELS[props.settings.provider] ??
    props.settings.provider,
);

const langItems = computed<CustomSelectItem[]>(() =>
  TRANSLATION_TARGET_LANGS.map((l) => ({
    kind: "item" as const,
    id: l.code,
    label: l.label,
  })),
);

const langLabel = computed(() => {
  const hit = TRANSLATION_TARGET_LANGS.find(
    (l) => l.code === props.settings.targetLang,
  );
  return hit?.label ?? props.settings.targetLang;
});

const aiProviderSelectItems = computed<CustomSelectItem[]>(() =>
  CHAT_API_PROVIDER_PRESETS.map((p) => ({
    kind: "item" as const,
    id: p.id,
    label: p.label,
    description: p.listDescription?.trim() || p.baseUrl,
  })),
);

const aiProviderPresetId = computed(() => {
  if (aiProviderExplicitId.value) return aiProviderExplicitId.value;
  return resolveChatProviderPresetIdFromBaseUrl(props.settings.aiBaseUrl);
});

const aiProviderDisplayLabel = computed(() => {
  const id = aiProviderPresetId.value;
  if (!id) return "";
  return CHAT_API_PROVIDER_PRESETS.find((p) => p.id === id)?.label ?? "";
});

const aiModelScrollItems = computed<CustomSelectItem[]>(() =>
  aiModelOptions.value.map((m) => ({
    kind: "item" as const,
    id: m,
    label: m,
  })),
);

const aiModelDisplayLabel = computed(() => props.settings.aiModel.trim());

watch(
  () => props.settings.aiBaseUrl,
  (url) => {
    const hit = findChatProviderPresetByBaseUrl(url);
    if (hit) {
      aiProviderExplicitId.value = hit.id;
      return;
    }
    if (url.trim()) {
      aiProviderExplicitId.value = CHAT_API_PROVIDER_CUSTOM_ID;
      return;
    }
    if (
      aiProviderExplicitId.value &&
      !isChatApiProviderCustomId(aiProviderExplicitId.value)
    ) {
      aiProviderExplicitId.value = CHAT_API_PROVIDER_CUSTOM_ID;
      return;
    }
    if (aiProviderExplicitId.value !== CHAT_API_PROVIDER_CUSTOM_ID) {
      aiProviderExplicitId.value = "";
    }
  },
  { immediate: true },
);

watch(
  () => props.settings.provider,
  (p) => {
    if (p !== "ai") {
      aiModelOptions.value = [];
    }
  },
);

function emitSettings(next: TranslationSettings) {
  emit("update:settings", mergeTranslationSettings(next));
}

function patch(partial: Partial<TranslationSettings>) {
  emitSettings({
    ...props.settings,
    ...partial,
  });
}

/** 编辑扁平 AI 字段时同步写回当前方案 */
function patchAiFlat(partial: {
  aiBaseUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
  aiMaxTokens?: number;
  aiTokenPricePerMillion?: AITokenPricePerMillion;
}) {
  emitSettings(
    syncFlatAiIntoActiveProfile(
      mergeTranslationSettings({
        ...props.settings,
        ...partial,
      }),
    ),
  );
}

function onProvider(id: string) {
  if ((TRANSLATION_PROVIDER_IDS as readonly string[]).includes(id)) {
    patch({ provider: id as TranslationProviderId });
  }
}

function onAiProfileSelect(id: string) {
  if (!id || id === props.settings.activeAiProfileId) return;
  aiModelOptions.value = [];
  aiProviderExplicitId.value = "";
  emitSettings(selectTranslationAiProfile(props.settings, id));
}

function addAiProfile() {
  if (props.settings.aiProfiles.length >= MAX_TRANSLATION_AI_PROFILES) return;
  const synced = syncFlatAiIntoActiveProfile(
    mergeTranslationSettings(props.settings),
  );
  const p = createTranslationAiProfile({ name: "" });
  aiModelOptions.value = [];
  aiProviderExplicitId.value = "";
  emitSettings({
    ...synced,
    aiProfiles: [p, ...synced.aiProfiles],
    activeAiProfileId: p.id,
    aiBaseUrl: "",
    aiApiKey: "",
    aiModel: "",
    aiMaxTokens: DEFAULT_TRANSLATION_AI_MAX_TOKENS,
    aiTokenPricePerMillion: { ...EMPTY_TOKEN_PRICE_PER_MILLION },
  });
}

async function renameAiProfile() {
  const id = props.settings.activeAiProfileId;
  const hit = props.settings.aiProfiles.find((p) => p.id === id);
  if (!hit) return;
  const next = await appPrompt("", {
    title: "重命名方案",
    defaultValue: hit.name.trim(),
    placeholder: "方案名称",
  });
  if (next === null) return;
  const name = next.trim().slice(0, 80);
  emitSettings({
    ...props.settings,
    aiProfiles: props.settings.aiProfiles.map((p) =>
      p.id === id ? { ...p, name, updatedAt: Date.now() } : p,
    ),
  });
}

function deleteAiProfile() {
  const list = props.settings.aiProfiles;
  if (list.length <= 1) return;
  const id = props.settings.activeAiProfileId;
  // 不必把当前表单写回即将删除的方案；直接切到剩余方案
  const nextProfiles = list.filter((p) => p.id !== id);
  const nextId = nextProfiles[0]?.id ?? "";
  aiModelOptions.value = [];
  aiProviderExplicitId.value = "";
  emitSettings(
    applyActiveAiProfileToFlat({
      ...props.settings,
      aiProfiles: nextProfiles,
      activeAiProfileId: nextId,
    }),
  );
}

function onAiProviderPresetSelect(id: string) {
  aiProviderExplicitId.value = id;
  aiModelOptions.value = [];
  if (isChatApiProviderCustomId(id)) {
    patchAiFlat({ aiBaseUrl: "", aiModel: "" });
    return;
  }
  const hit = CHAT_API_PROVIDER_PRESETS.find((p) => p.id === id && !p.custom);
  if (hit?.baseUrl.trim()) {
    patchAiFlat({ aiBaseUrl: hit.baseUrl, aiModel: "" });
  }
}

async function refreshAiModels(opts?: { pullDone?: AppPullFlashDone }) {
  const pullDone = opts?.pullDone;
  aiModelsLoading.value = true;
  let ok = false;
  try {
    const r = await window.colorTxt.ai.modelsList({
      baseUrl: props.settings.aiBaseUrl,
      apiKey: props.settings.aiApiKey,
    });
    ok = r.ok;
    if (r.ok) {
      aiModelOptions.value = sortChatModelsForBaseUrl(
        props.settings.aiBaseUrl,
        r.models,
      );
      if (aiModelOptions.value.length > 0) {
        const cur = props.settings.aiModel.trim();
        if (!cur || !aiModelOptions.value.includes(cur)) {
          patchAiFlat({ aiModel: aiModelOptions.value[0]! });
        }
      }
    } else {
      aiModelOptions.value = [];
    }
  } finally {
    aiModelsLoading.value = false;
    if (pullDone) pullDone(ok);
    else aiPullBtnRef.value?.clearStaleFailOnSilentSuccess(ok);
  }
}

function onAiModelPanelOpenChange(isOpen: boolean) {
  if (!isOpen || aiModelsLoading.value) return;
  if (aiModelOptions.value.length > 0) return;
  void refreshAiModels();
}

function toggleSecret(key: string) {
  showSecret[key] = !showSecret[key];
}
</script>

<template>
  <AppModal
    v-model="open"
    title="翻译设置"
    max-width="520px"
    panel-class="trManageModal"
    :mask-closable="true"
    :esc-closable="true"
  >
    <div class="settingsBody">
      <section class="aiSection">
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">翻译服务</span>
            <div class="aiRowField">
              <AppCustomSelect
                class="settingsSelect"
                :model-value="settings.provider"
                :display-label="providerLabel"
                :fixed-top-items="[]"
                :scroll-items="providerItems"
                :fixed-bottom-items="[]"
                :scroll-max-height="260"
                ariaLabel="翻译服务"
                @update:model-value="onProvider"
              />
            </div>
          </div>
        </div>

      <template v-if="settings.provider === 'deepl'">
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">API Key</span>
            <div class="aiRowField">
              <div class="settingsPasswordRow aiPasswordRow">
                <input
                  class="settingsStretchInput settingsPasswordRow__input"
                  :type="showSecret.deepl ? 'text' : 'password'"
                  :value="settings.deeplApiKey"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="DeepL Auth Key"
                  aria-label="DeepL API Key"
                  @input="
                    patch({
                      deeplApiKey: ($event.target as HTMLInputElement).value,
                    })
                  "
                />
                <button
                  type="button"
                  class="btn iconOnly"
                  :aria-label="showSecret.deepl ? '隐藏密钥' : '显示密钥'"
                  :aria-pressed="!!showSecret.deepl"
                  @click="toggleSecret('deepl')"
                >
                  <span
                    class="iconSvg"
                    v-html="showSecret.deepl ? icons.view : icons.viewOff"
                  />
                </button>
              </div>
            </div>
          </div>
          <p class="settingsHint">{{ secretStorageHint }}</p>
        </div>
      </template>

      <template v-else-if="settings.provider === 'ai'">
        <div class="settingsRow">
          <AiConfigProfileToolbar
            :profiles="aiProfileToolbarProfiles"
            :editing-id="settings.activeAiProfileId"
            :display-name="aiProfileDisplayName"
            :placeholder="aiProfilePlaceholder"
            :max-profiles="MAX_TRANSLATION_AI_PROFILES"
            @update:editing-id="onAiProfileSelect"
            @add="addAiProfile"
            @rename="void renameAiProfile()"
            @delete="deleteAiProfile"
          />
        </div>
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">服务商</span>
            <div class="aiRowField">
              <AppCustomSelect
                class="settingsSelect"
                :model-value="aiProviderPresetId"
                :display-label="aiProviderDisplayLabel"
                placeholder="选择服务商…"
                :fixed-top-items="selectListsEmpty"
                :scroll-items="aiProviderSelectItems"
                :fixed-bottom-items="selectListsEmpty"
                :scroll-max-height="320"
                ariaLabel="AI 翻译服务商"
                @update:model-value="onAiProviderPresetSelect"
              />
            </div>
          </div>
        </div>
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">接口地址</span>
            <div class="aiRowField">
              <ApiEndpointInput
                :model-value="settings.aiBaseUrl"
                :suggestions="[]"
                input-class="settingsStretchInput"
                aria-label="AI 翻译接口地址"
                @update:model-value="patchAiFlat({ aiBaseUrl: $event })"
              />
            </div>
          </div>
        </div>
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">API 密钥</span>
            <div class="aiRowField">
              <div class="settingsPasswordRow aiPasswordRow">
                <input
                  class="settingsStretchInput settingsPasswordRow__input"
                  :type="showSecret.ai ? 'text' : 'password'"
                  :value="settings.aiApiKey"
                  autocomplete="off"
                  spellcheck="false"
                  aria-label="AI 翻译 API 密钥"
                  @input="
                    patchAiFlat({
                      aiApiKey: ($event.target as HTMLInputElement).value,
                    })
                  "
                />
                <button
                  type="button"
                  class="btn iconOnly"
                  :aria-label="showSecret.ai ? '隐藏密钥' : '显示密钥'"
                  :aria-pressed="!!showSecret.ai"
                  @click="toggleSecret('ai')"
                >
                  <span
                    class="iconSvg"
                    v-html="showSecret.ai ? icons.view : icons.viewOff"
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
              <div class="aiRowField aiModelToolbar">
                <AppCustomSelect
                  class="settingsSelect aiModelSelect"
                  :model-value="settings.aiModel"
                  :display-label="aiModelDisplayLabel"
                  placeholder="选择模型…"
                  :fixed-top-items="selectListsEmpty"
                  :scroll-items="aiModelScrollItems"
                  :fixed-bottom-items="selectListsEmpty"
                  :scroll-max-height="260"
                  ariaLabel="AI 翻译模型"
                  @panel-open-change="onAiModelPanelOpenChange"
                  @update:model-value="patchAiFlat({ aiModel: $event })"
                />
                <AppPullFlashButton
                  ref="aiPullBtnRef"
                  label="拉取模型"
                  :busy="aiModelsLoading"
                  @pull="(done) => void refreshAiModels({ pullDone: done })"
                />
              </div>
            </div>
          </div>
          <div class="settingsRow">
            <div class="settingsRowMain settingsRowMain--baseline">
              <span class="settingsLabel"
                >最大 Token 数（{{ settings.aiMaxTokens }}）</span
              >
              <NumericInput
                :model-value="settings.aiMaxTokens"
                :min="TRANSLATION_AI_MAX_TOKENS_MIN"
                :max="TRANSLATION_AI_MAX_TOKENS_MAX"
                integer
                @update:model-value="patchAiFlat({ aiMaxTokens: $event })"
              />
            </div>
            <p class="settingsHint">
              单次翻译请求允许生成的最大 Token 数；超过时会自动分段请求。
            </p>
          </div>
        </template>

        <template v-else-if="settings.provider === 'baidu'">
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">APP ID</span>
            <input
              class="settingsTextInput settingsStretchInput"
              type="text"
              :value="settings.baiduAppId"
              autocomplete="off"
              spellcheck="false"
              @input="
                patch({
                  baiduAppId: ($event.target as HTMLInputElement).value,
                })
              "
            />
          </div>
        </div>
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">密钥</span>
            <div class="aiRowField">
              <div class="settingsPasswordRow aiPasswordRow">
                <input
                  class="settingsStretchInput settingsPasswordRow__input"
                  :type="showSecret.baidu ? 'text' : 'password'"
                  :value="settings.baiduSecret"
                  autocomplete="off"
                  spellcheck="false"
                  aria-label="百度翻译密钥"
                  @input="
                    patch({
                      baiduSecret: ($event.target as HTMLInputElement).value,
                    })
                  "
                />
                <button
                  type="button"
                  class="btn iconOnly"
                  :aria-label="showSecret.baidu ? '隐藏密钥' : '显示密钥'"
                  :aria-pressed="!!showSecret.baidu"
                  @click="toggleSecret('baidu')"
                >
                  <span
                    class="iconSvg"
                    v-html="showSecret.baidu ? icons.view : icons.viewOff"
                  />
                </button>
              </div>
            </div>
          </div>
          <p class="settingsHint">{{ secretStorageHint }}</p>
        </div>
      </template>

      <template v-else-if="settings.provider === 'youdao'">
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">应用 ID</span>
            <input
              class="settingsTextInput settingsStretchInput"
              type="text"
              :value="settings.youdaoAppKey"
              autocomplete="off"
              spellcheck="false"
              @input="
                patch({
                  youdaoAppKey: ($event.target as HTMLInputElement).value,
                })
              "
            />
          </div>
        </div>
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">应用密钥</span>
            <div class="aiRowField">
              <div class="settingsPasswordRow aiPasswordRow">
                <input
                  class="settingsStretchInput settingsPasswordRow__input"
                  :type="showSecret.youdao ? 'text' : 'password'"
                  :value="settings.youdaoAppSecret"
                  autocomplete="off"
                  spellcheck="false"
                  aria-label="有道应用密钥"
                  @input="
                    patch({
                      youdaoAppSecret: ($event.target as HTMLInputElement)
                        .value,
                    })
                  "
                />
                <button
                  type="button"
                  class="btn iconOnly"
                  :aria-label="showSecret.youdao ? '隐藏密钥' : '显示密钥'"
                  :aria-pressed="!!showSecret.youdao"
                  @click="toggleSecret('youdao')"
                >
                  <span
                    class="iconSvg"
                    v-html="showSecret.youdao ? icons.view : icons.viewOff"
                  />
                </button>
              </div>
            </div>
          </div>
          <p class="settingsHint">{{ secretStorageHint }}</p>
        </div>
      </template>

      <template v-else-if="settings.provider === 'tencent'">
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">SecretId</span>
            <input
              class="settingsTextInput settingsStretchInput"
              type="text"
              :value="settings.tencentSecretId"
              autocomplete="off"
              spellcheck="false"
              @input="
                patch({
                  tencentSecretId: ($event.target as HTMLInputElement).value,
                })
              "
            />
          </div>
        </div>
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">SecretKey</span>
            <div class="aiRowField">
              <div class="settingsPasswordRow aiPasswordRow">
                <input
                  class="settingsStretchInput settingsPasswordRow__input"
                  :type="showSecret.tencent ? 'text' : 'password'"
                  :value="settings.tencentSecretKey"
                  autocomplete="off"
                  spellcheck="false"
                  aria-label="腾讯云 SecretKey"
                  @input="
                    patch({
                      tencentSecretKey: ($event.target as HTMLInputElement)
                        .value,
                    })
                  "
                />
                <button
                  type="button"
                  class="btn iconOnly"
                  :aria-label="showSecret.tencent ? '隐藏密钥' : '显示密钥'"
                  :aria-pressed="!!showSecret.tencent"
                  @click="toggleSecret('tencent')"
                >
                  <span
                    class="iconSvg"
                    v-html="showSecret.tencent ? icons.view : icons.viewOff"
                  />
                </button>
              </div>
            </div>
          </div>
          <p class="settingsHint">{{ secretStorageHint }}</p>
        </div>
      </template>

      <template v-else-if="settings.provider === 'volcengine'">
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">Access Key ID</span>
            <input
              class="settingsTextInput settingsStretchInput"
              type="text"
              :value="settings.volcAccessKeyId"
              autocomplete="off"
              spellcheck="false"
              @input="
                patch({
                  volcAccessKeyId: ($event.target as HTMLInputElement).value,
                })
              "
            />
          </div>
        </div>
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">Secret Access Key</span>
            <div class="aiRowField">
              <div class="settingsPasswordRow aiPasswordRow">
                <input
                  class="settingsStretchInput settingsPasswordRow__input"
                  :type="showSecret.volc ? 'text' : 'password'"
                  :value="settings.volcSecretKey"
                  autocomplete="off"
                  spellcheck="false"
                  aria-label="火山引擎 Secret Key"
                  @input="
                    patch({
                      volcSecretKey: ($event.target as HTMLInputElement).value,
                    })
                  "
                />
                <button
                  type="button"
                  class="btn iconOnly"
                  :aria-label="showSecret.volc ? '隐藏密钥' : '显示密钥'"
                  :aria-pressed="!!showSecret.volc"
                  @click="toggleSecret('volc')"
                >
                  <span
                    class="iconSvg"
                    v-html="showSecret.volc ? icons.view : icons.viewOff"
                  />
                </button>
              </div>
            </div>
          </div>
          <p class="settingsHint">{{ secretStorageHint }}</p>
        </div>
      </template>

      <template v-else-if="settings.provider === 'aliyun'">
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">AccessKey ID</span>
            <input
              class="settingsTextInput settingsStretchInput"
              type="text"
              :value="settings.aliyunAccessKeyId"
              autocomplete="off"
              spellcheck="false"
              @input="
                patch({
                  aliyunAccessKeyId: ($event.target as HTMLInputElement).value,
                })
              "
            />
          </div>
        </div>
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">AccessKey Secret</span>
            <div class="aiRowField">
              <div class="settingsPasswordRow aiPasswordRow">
                <input
                  class="settingsStretchInput settingsPasswordRow__input"
                  :type="showSecret.aliyun ? 'text' : 'password'"
                  :value="settings.aliyunAccessKeySecret"
                  autocomplete="off"
                  spellcheck="false"
                  aria-label="阿里云 AccessKey Secret"
                  @input="
                    patch({
                      aliyunAccessKeySecret: (
                        $event.target as HTMLInputElement
                      ).value,
                    })
                  "
                />
                <button
                  type="button"
                  class="btn iconOnly"
                  :aria-label="showSecret.aliyun ? '隐藏密钥' : '显示密钥'"
                  :aria-pressed="!!showSecret.aliyun"
                  @click="toggleSecret('aliyun')"
                >
                  <span
                    class="iconSvg"
                    v-html="showSecret.aliyun ? icons.view : icons.viewOff"
                  />
                </button>
              </div>
            </div>
          </div>
          <p class="settingsHint">{{ secretStorageHint }}</p>
        </div>
      </template>
      </section>

      <section
        v-if="settings.provider === 'ai'"
        class="aiSection aiSection--compact"
      >
        <div class="settingsRowMain">
          <span class="settingsLabel">显示 Token 消耗量</span>
          <SwitchToggle
            :model-value="settings.aiShowTokenUsage"
            aria-label="显示 Token 消耗量"
            @update:model-value="patch({ aiShowTokenUsage: $event })"
          />
        </div>
        <template v-if="settings.aiShowTokenUsage">
          <h3 class="aiSectionTitle">每百万 Token 价格</h3>
          <p class="settingsHint">
            如果设置了输入和输出价格，在显示 Token
            消耗量时会自动计算并显示总花费；<br />只设置一个输入价格时，全部输入
            Token 会按该价格计算。
          </p>
          <div class="settingsRow">
            <div class="settingsRowMain settingsRowMain--baseline">
              <span class="settingsLabel">输入（缓存命中）</span>
              <NumericInput
                :model-value="settings.aiTokenPricePerMillion.inputCacheHit"
                :min="0"
                :step="0.01"
                aria-label="输入缓存命中每百万 Token 价格"
                @update:model-value="
                  patchAiFlat({
                    aiTokenPricePerMillion: {
                      ...settings.aiTokenPricePerMillion,
                      inputCacheHit: $event,
                    },
                  })
                "
              />
            </div>
          </div>
          <div class="settingsRow">
            <div class="settingsRowMain settingsRowMain--baseline">
              <span class="settingsLabel">输入（缓存未命中）</span>
              <NumericInput
                :model-value="settings.aiTokenPricePerMillion.inputCacheMiss"
                :min="0"
                :step="0.01"
                aria-label="输入缓存未命中每百万 Token 价格"
                @update:model-value="
                  patchAiFlat({
                    aiTokenPricePerMillion: {
                      ...settings.aiTokenPricePerMillion,
                      inputCacheMiss: $event,
                    },
                  })
                "
              />
            </div>
          </div>
          <div class="settingsRow">
            <div class="settingsRowMain settingsRowMain--baseline">
              <span class="settingsLabel">输出</span>
              <NumericInput
                :model-value="settings.aiTokenPricePerMillion.output"
                :min="0"
                :step="0.01"
                aria-label="输出每百万 Token 价格"
                @update:model-value="
                  patchAiFlat({
                    aiTokenPricePerMillion: {
                      ...settings.aiTokenPricePerMillion,
                      output: $event,
                    },
                  })
                "
              />
            </div>
          </div>
        </template>
      </section>

      <section class="aiSection">
        <div class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">目标语言</span>
            <div class="aiRowField">
              <AppCustomSelect
                class="settingsSelect"
                :model-value="settings.targetLang"
                :display-label="langLabel"
                :fixed-top-items="[]"
                :scroll-items="langItems"
                :fixed-bottom-items="[]"
                :scroll-max-height="260"
                ariaLabel="目标语言"
                @update:model-value="patch({ targetLang: $event })"
              />
            </div>
          </div>
        </div>

        <div class="settingsRow">
          <div class="settingsRowMain">
            <span class="settingsLabel">显示原文</span>
            <SwitchToggle
              :model-value="settings.showOriginal"
              aria-label="翻译结果中显示原文"
              @update:model-value="patch({ showOriginal: $event })"
            />
          </div>
        </div>
      </section>
    </div>
  </AppModal>
</template>

<style scoped>
:deep(.trManageModal) {
  width: min(520px, calc(100vw - 32px));
}

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
  flex: 1 1 60%;
  min-width: 60%;
  white-space: nowrap;
}

.settingsLabel.short {
  flex: 1 1 30%;
  min-width: 30%;
}

.settingsSelect {
  flex: 1 1 0;
  min-width: 0;
  width: 100%;
  max-width: none;
}

.settingsTextInput,
.settingsStretchInput {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  max-width: none;
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

.aiModelToolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.aiModelSelect {
  flex: 1 1 160px;
  min-width: 0;
}

.settingsPasswordRow {
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
  width: 100%;
}

.settingsPasswordRow__input {
  flex: 1;
  min-width: 0;
}

.settingsHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
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
</style>
