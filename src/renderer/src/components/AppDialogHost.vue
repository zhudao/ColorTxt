<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from "vue";
import AppModal from "./AppModal.vue";
import {
  appDialogModel,
  appDialogPrimary,
  appDialogSecondary,
  appDialogUserDismiss,
} from "../services/appDialog";

const promptInputRef = useTemplateRef<HTMLInputElement>("promptInputRef");

const dialogOpen = computed({
  get: () => appDialogModel.open,
  set(v: boolean) {
    if (v) {
      appDialogModel.open = true;
    } else {
      appDialogUserDismiss();
    }
  },
});

const panelClass = computed(() =>
  appDialogModel.kind === "prompt"
    ? "appDialogModalPanel appDialogModalPanel--prompt"
    : "appDialogModalPanel",
);

watch(
  () => [appDialogModel.open, appDialogModel.kind] as const,
  ([open, kind]) => {
    if (open && kind === "prompt") {
      void nextTick(() => {
        const el = promptInputRef.value;
        el?.focus();
        el?.select?.();
      });
    }
  },
);

function onPrimary() {
  appDialogPrimary();
}

function onSecondary() {
  appDialogSecondary();
}

function onPromptKeydown(e: KeyboardEvent) {
  if (e.key !== "Enter" || e.shiftKey) return;
  e.preventDefault();
  onPrimary();
}
</script>

<template>
  <AppModal
    v-model="dialogOpen"
    :title="appDialogModel.title"
    max-width="440px"
    :mask-closable="true"
    :esc-closable="true"
    :show-close-button="true"
    :panel-class="panelClass"
    :body-scroll="true"
  >
    <div class="appDialogBody">
      <p v-if="appDialogModel.message.trim()" class="appDialogMsg">
        {{ appDialogModel.message }}
      </p>
      <input
        v-if="appDialogModel.kind === 'prompt'"
        ref="promptInputRef"
        v-model="appDialogModel.promptValue"
        type="text"
        class="appDialogPromptInput"
        :placeholder="appDialogModel.promptPlaceholder || undefined"
        autocomplete="off"
        @keydown="onPromptKeydown"
      />
    </div>
    <template #footer>
      <div
        class="appDialogModalFooter"
        :class="{
          'appDialogModalFooter--single': appDialogModel.kind === 'alert',
        }"
      >
        <template v-if="appDialogModel.kind === 'alert'">
          <button
            type="button"
            class="btn primary"
            size="large"
            @click="onPrimary"
          >
            确定
          </button>
        </template>
        <template v-else>
          <button type="button" class="btn" size="large" @click="onSecondary">
            取消
          </button>
          <button
            type="button"
            class="btn primary"
            size="large"
            @click="onPrimary"
          >
            确定
          </button>
        </template>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
:deep(.appDialogModalPanel) {
  max-height: min(90vh, 320px);
}

:deep(.appDialogModalPanel--prompt) {
  max-height: min(90vh, 420px);
}

.appDialogBody {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.appDialogMsg {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--fg);
  word-break: break-word;
}

.appDialogPromptInput {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font-size: 14px;
  line-height: 1.4;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--fg);
}

.appDialogPromptInput:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.appDialogModalFooter {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}

.appDialogModalFooter--single {
  justify-content: flex-end;
}
</style>
