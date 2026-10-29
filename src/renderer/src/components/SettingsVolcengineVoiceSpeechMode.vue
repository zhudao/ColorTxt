<script setup lang="ts">
import { computed } from "vue";
import AppCustomSelect, { type CustomSelectItem } from "./AppCustomSelect.vue";
import {
  formatVolcengineDialectLabel,
  formatVolcengineLanguageLabel,
  volcengineDialectOptionsFromLabels,
  volcengineLanguageOptionsFromLabels,
} from "@shared/voiceReadVolcengineAudio";
import { findVolcengineTtsVoice } from "@shared/voiceReadVolcengineVoices";

const props = withDefaults(
  defineProps<{
    voiceId: string;
    language?: string;
    dialect?: string;
    slotLabel: string;
    layout?: "settings" | "drawer";
  }>(),
  {
    language: "",
    dialect: "",
    layout: "settings",
  },
);

const emit = defineEmits<{
  "update:language": [value: string];
  "update:dialect": [value: string];
}>();

const emptyItems: CustomSelectItem[] = [];

const voice = computed(() => findVolcengineTtsVoice(props.voiceId));

const languageItems = computed((): CustomSelectItem[] =>
  volcengineLanguageOptionsFromLabels(voice.value?.languages ?? []).map(
    (option) => ({
      kind: "item" as const,
      id: option.id,
      label: option.label,
    }),
  ),
);

const showLanguage = computed(() => languageItems.value.length > 1);

const languageValue = computed(() => {
  const raw = props.language;
  return languageItems.value.some(
    (item) => item.kind === "item" && item.id === raw,
  )
    ? raw
    : "";
});

const dialectItems = computed((): CustomSelectItem[] =>
  volcengineDialectOptionsFromLabels(voice.value?.dialects ?? []).map(
    (option) => ({
      kind: "item" as const,
      id: option.id,
      label: option.label,
    }),
  ),
);

const showDialect = computed(
  () => !languageValue.value && dialectItems.value.length > 1,
);

const dialectValue = computed(() => {
  const raw = props.dialect;
  return dialectItems.value.some(
    (item) => item.kind === "item" && item.id === raw,
  )
    ? raw
    : "";
});

const visible = computed(() => showLanguage.value || showDialect.value);
</script>

<template>
  <template v-if="visible">
    <div
      v-if="showLanguage"
      :class="
        layout === 'drawer'
          ? 'volcengineSpeechModeRow volcengineSpeechModeRow--drawer'
          : 'settingsRowMain settingsRowMain--baseline'
      "
    >
      <span
        :class="
          layout === 'drawer'
            ? 'volcengineSpeechModeLabel'
            : 'settingsLabel short settingsLabel--nested'
        "
        >语种</span
      >
      <AppCustomSelect
        :class="
          layout === 'drawer'
            ? 'volcengineSpeechModeSelect'
            : 'settingsRowControl'
        "
        :model-value="languageValue"
        :display-label="formatVolcengineLanguageLabel(languageValue)"
        :fixed-top-items="emptyItems"
        :scroll-items="languageItems"
        :fixed-bottom-items="emptyItems"
        :scroll-max-height="220"
        :ariaLabel="`${slotLabel}语种`"
        @update:model-value="emit('update:language', $event)"
      />
    </div>
    <div
      v-if="showDialect"
      :class="
        layout === 'drawer'
          ? 'volcengineSpeechModeRow volcengineSpeechModeRow--drawer'
          : 'settingsRowMain settingsRowMain--baseline'
      "
    >
      <span
        :class="
          layout === 'drawer'
            ? 'volcengineSpeechModeLabel'
            : 'settingsLabel short settingsLabel--nested'
        "
        >方言</span
      >
      <AppCustomSelect
        :class="
          layout === 'drawer'
            ? 'volcengineSpeechModeSelect'
            : 'settingsRowControl'
        "
        :model-value="dialectValue"
        :display-label="formatVolcengineDialectLabel(dialectValue)"
        :fixed-top-items="emptyItems"
        :scroll-items="dialectItems"
        :fixed-bottom-items="emptyItems"
        :scroll-max-height="220"
        :ariaLabel="`${slotLabel}方言`"
        @update:model-value="emit('update:dialect', $event)"
      />
    </div>
  </template>
</template>

<style scoped>
.volcengineSpeechModeRow--drawer {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.volcengineSpeechModeLabel {
  font-size: 12px;
  color: var(--fg);
}

.volcengineSpeechModeSelect {
  width: 100%;
  min-width: 0;
}
</style>
