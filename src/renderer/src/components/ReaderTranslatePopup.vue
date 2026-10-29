<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRaw, watch } from "vue";
import { icons } from "../icons";
import {
  mergeTranslationSettings,
  resolveTranslationAiProfileProviderLabel,
  selectTranslationAiProfile,
} from "../constants/translationSettings";
import AppCustomSelect, { type CustomSelectItem } from "./AppCustomSelect.vue";
import AiTokenUsageBanner from "./AiTokenUsageBanner.vue";
import LoadingDotsBounce from "./LoadingDotsBounce.vue";
import { isPointerOnAppModalAbove, registerModal } from "../utils/modalStack";
import type { AITokenUsageTotals } from "@shared/aiTokenUsage";
import { reapplySourceLineIndents } from "@shared/translationIndent";
import {
  TRANSLATION_PROVIDER_IDS,
  TRANSLATION_PROVIDER_LABELS,
  TRANSLATION_PROVIDER_DESCRIPTIONS,
  TRANSLATION_TARGET_LANGS,
  type TranslationProviderId,
  type TranslationSettings,
} from "@shared/translationTypes";

function plainSettingsForIpc(settings: TranslationSettings): TranslationSettings {
  return JSON.parse(JSON.stringify(toRaw(settings))) as TranslationSettings;
}

const props = defineProps<{
  open: boolean;
  text: string;
  settings: TranslationSettings;
  floatCenterX: number;
  floatRootTop: number;
  openDownward: boolean;
  maxHeight: number;
}>();

const emit = defineEmits<{
  close: [];
  openTranslateManage: [];
  "update:settings": [v: TranslationSettings];
}>();

const panelZIndex = ref(6000);
const popupPanelRef = ref<HTMLElement | null>(null);
let modalUnregister: (() => void) | null = null;
let removeOutsideListener: (() => void) | null = null;

const localSettings = ref(mergeTranslationSettings(props.settings));
const sourceText = ref("");
const translated = ref("");
const loading = ref(false);
const errorMessage = ref("");
const tokenUsage = ref<AITokenUsageTotals | null>(null);
const tokenUsageAvailable = ref(false);
let translateSeq = 0;

watch(
  () => props.settings,
  (s) => {
    localSettings.value = mergeTranslationSettings(s);
  },
  { deep: true },
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
    TRANSLATION_PROVIDER_LABELS[localSettings.value.provider] ??
    localSettings.value.provider,
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
    (l) => l.code === localSettings.value.targetLang,
  );
  return hit?.label ?? localSettings.value.targetLang;
});

const isAiProvider = computed(() => localSettings.value.provider === "ai");

const aiProfileItems = computed<CustomSelectItem[]>(() => {
  const s = localSettings.value;
  return s.aiProfiles.map((p) => {
    const ep =
      p.id === s.activeAiProfileId
        ? {
            baseUrl: s.aiBaseUrl,
            apiKey: s.aiApiKey,
            model: s.aiModel,
            maxTokens: s.aiMaxTokens,
            tokenPricePerMillion: s.aiTokenPricePerMillion,
          }
        : p.endpoint;
    const providerLabel = resolveTranslationAiProfileProviderLabel(ep);
    return {
      kind: "item" as const,
      id: p.id,
      label: p.name.trim() || providerLabel || "未命名方案",
    };
  });
});

const aiProfileDisplayName = computed(() => {
  const s = localSettings.value;
  const hit = s.aiProfiles.find((p) => p.id === s.activeAiProfileId);
  return hit?.name.trim() ?? "";
});

const aiProfilePlaceholder = computed(() =>
  resolveTranslationAiProfileProviderLabel({
    baseUrl: localSettings.value.aiBaseUrl,
    apiKey: localSettings.value.aiApiKey,
    model: localSettings.value.aiModel,
    maxTokens: localSettings.value.aiMaxTokens,
    tokenPricePerMillion: localSettings.value.aiTokenPricePerMillion,
  }),
);

const showOriginal = computed(() => localSettings.value.showOriginal);

function patchSettings(partial: Partial<TranslationSettings>) {
  localSettings.value = mergeTranslationSettings({
    ...localSettings.value,
    ...partial,
  });
  emit("update:settings", localSettings.value);
}

async function runTranslate() {
  const text = sourceText.value;
  if (!text.trim()) {
    errorMessage.value = "没有可翻译的文本";
    translated.value = "";
    return;
  }
  const seq = ++translateSeq;
  loading.value = true;
  errorMessage.value = "";
  translated.value = "";
  tokenUsage.value = null;
  tokenUsageAvailable.value = false;
  try {
    const settings = plainSettingsForIpc(localSettings.value);
    const res = await window.colorTxt.translate({
      text,
      settings,
    });
    if (seq !== translateSeq) return;
    if (!res.ok) {
      errorMessage.value = res.message || "翻译失败";
      return;
    }
    translated.value = reapplySourceLineIndents(text, res.translated);
    if (localSettings.value.provider === "ai") {
      tokenUsage.value = res.tokenUsage ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };
      tokenUsageAvailable.value = res.tokenUsageAvailable === true;
    }
  } catch (e) {
    if (seq !== translateSeq) return;
    errorMessage.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (seq === translateSeq) loading.value = false;
  }
}

function onProvider(id: string) {
  if ((TRANSLATION_PROVIDER_IDS as readonly string[]).includes(id)) {
    patchSettings({ provider: id as TranslationProviderId });
    void runTranslate();
  }
}

function onTargetLang(id: string) {
  patchSettings({ targetLang: id });
  void runTranslate();
}

function onAiProfile(id: string) {
  if (!id || id === localSettings.value.activeAiProfileId) return;
  localSettings.value = selectTranslationAiProfile(localSettings.value, id);
  emit("update:settings", localSettings.value);
  void runTranslate();
}

function bindOutsideClose() {
  removeOutsideListener?.();
  const onPointerDown = (ev: PointerEvent) => {
    const t = ev.target as Node | null;
    if (!t) return;
    if (popupPanelRef.value?.contains(t)) return;
    // 下拉 Teleport 到 body，点选项不关翻译浮层
    if (t instanceof Element && t.closest(".customSelectPanel")) return;
    // 仅忽略叠在翻译浮层之上的 AppModal（如翻译设置）；找书阅读器等下层不阻拦关闭
    if (isPointerOnAppModalAbove(t, panelZIndex.value)) return;
    emit("close");
  };
  window.addEventListener("pointerdown", onPointerDown, true);
  removeOutsideListener = () => {
    window.removeEventListener("pointerdown", onPointerDown, true);
    removeOutsideListener = null;
  };
}

watch(
  () => props.open,
  async (o) => {
    modalUnregister?.();
    modalUnregister = null;
    removeOutsideListener?.();
    if (!o) {
      translateSeq += 1;
      loading.value = false;
      return;
    }
    const reg = registerModal({
      close: () => emit("close"),
      getEscClosable: () => true,
      setZIndex: (z) => {
        panelZIndex.value = z;
      },
    });
    panelZIndex.value = reg.zIndex;
    modalUnregister = reg.unregister;
    sourceText.value = props.text;
    localSettings.value = mergeTranslationSettings(props.settings);
    translated.value = "";
    errorMessage.value = "";
    tokenUsage.value = null;
    tokenUsageAvailable.value = false;
    await nextTick();
    bindOutsideClose();
    void runTranslate();
  },
);

watch(
  () => props.text,
  (t) => {
    if (!props.open) return;
    sourceText.value = t;
    void runTranslate();
  },
);

onBeforeUnmount(() => {
  modalUnregister?.();
  removeOutsideListener?.();
});
</script>

<template>
  <div
    v-show="open"
    class="trPopupRoot"
    :class="{ trPopupRootDown: openDownward }"
    :style="{
      left: `${floatCenterX}px`,
      top: `${floatRootTop}px`,
      zIndex: panelZIndex,
      '--tr-max-h': `${maxHeight}px`,
    }"
  >
    <div
      ref="popupPanelRef"
      class="trPopup"
      :class="{ 'trPopup--ai': isAiProvider }"
      role="dialog"
      aria-label="翻译"
    >
      <header class="trPopupHeader">
        <AppCustomSelect
          class="trPopupSelect trPopupSelectTargetLang"
          :model-value="localSettings.targetLang"
          :display-label="langLabel"
          :fixed-top-items="[]"
          :scroll-items="langItems"
          :fixed-bottom-items="[]"
          :scroll-max-height="280"
          :min-panel-width="160"
          ariaLabel="目标语言"
          @update:model-value="onTargetLang"
        />
        <AppCustomSelect
          class="trPopupSelect trPopupSelectProvider"
          :model-value="localSettings.provider"
          :display-label="providerLabel"
          :fixed-top-items="[]"
          :scroll-items="providerItems"
          :fixed-bottom-items="[]"
          :scroll-max-height="280"
          :min-panel-width="250"
          ariaLabel="翻译服务"
          @update:model-value="onProvider"
        />
        <AppCustomSelect
          v-if="isAiProvider"
          class="trPopupSelect trPopupSelectAiProfile"
          :model-value="localSettings.activeAiProfileId"
          :display-label="aiProfileDisplayName"
          :placeholder="aiProfilePlaceholder || '配置方案'"
          :fixed-top-items="[]"
          :scroll-items="aiProfileItems"
          :fixed-bottom-items="[]"
          :scroll-max-height="280"
          :min-panel-width="160"
          ariaLabel="配置方案"
          @update:model-value="onAiProfile"
        />
        <button
          type="button"
          class="trPopupIconBtn"
          aria-label="翻译设置"
          title="翻译设置"
          @click="emit('openTranslateManage')"
        >
          <span aria-hidden="true" v-html="icons.setting"></span>
        </button>
      </header>
      <div class="trPopupBody">
        <section v-if="showOriginal" class="trBlock">
          <div class="trBlockTitle">原文</div>
          <div class="trBlockText">{{ sourceText }}</div>
        </section>
        <section class="trBlock">
          <div class="trBlockTitle">译文</div>
          <div v-if="loading" class="trLoading">
            <LoadingDotsBounce />
          </div>
          <div v-else-if="errorMessage" class="trError">{{ errorMessage }}</div>
          <div v-else class="trBlockText">{{ translated }}</div>
        </section>
        <AiTokenUsageBanner
          v-if="
            isAiProvider &&
            localSettings.aiShowTokenUsage &&
            !loading &&
            !errorMessage &&
            translated &&
            tokenUsage
          "
          class="trTokenUsage"
          :usage="tokenUsage"
          :available="tokenUsageAvailable"
          :token-price-per-million="localSettings.aiTokenPricePerMillion"
          label="本次翻译消耗 Token"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.trPopupRoot {
  position: fixed;
  transform: translate(-50%, -100%);
  pointer-events: none;
}
.trPopupRootDown {
  transform: translate(-50%, 0);
}
.trPopup {
  pointer-events: auto;
  width: min(380px, calc(100vw - 24px));
  max-height: var(--tr-max-h, 420px);
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 28px color-mix(in srgb, #000 18%, transparent);
  overflow: hidden;
}
/* .trPopup--ai {
  width: min(460px, calc(100vw - 24px));
} */
.trPopupHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.trPopupSelect {
  flex: 1 1 0;
  min-width: 0;
}
.trPopupSelectTargetLang {
  flex: 0 0 auto;
  width: 100px;
}
.trPopup--ai .trPopupSelectProvider {
  flex: 0 0 auto;
  width: 100px;
}
.trPopupIconBtn {
  flex-shrink: 0;
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  padding: 0;
}
.trPopupIconBtn:hover {
  background: var(--icon-btn-bg-hover);
}
.trPopupIconBtn :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}
.trPopupIconBtn :deep(svg path) {
  fill: currentColor;
}
.trPopupBody {
  padding: 10px 12px 12px;
  overflow: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.trBlockTitle {
  font-size: 12px;
  color: var(--muted-fg, color-mix(in srgb, var(--fg) 62%, transparent));
  margin-bottom: 4px;
}
.trBlockText {
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.trTokenUsage {
  flex-shrink: 0;
}
.trLoading {
  display: flex;
  justify-content: center;
  padding: 0 0 10px 0;
}
.trError {
  font-size: 13px;
  color: var(--danger, #c62828);
  line-height: 1.45;
}
</style>
