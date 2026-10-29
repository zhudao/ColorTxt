<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from "vue";
import AppModal from "./AppModal.vue";
import AppCheckbox from "./AppCheckbox.vue";
import AutoResizeTextarea from "./AutoResizeTextarea.vue";
import { useAppDialogLogSelectAll } from "../composables/useAppDialogLogSelectAll";
import {
  appDialogModel,
  appDialogNeutral,
  appDialogPrimary,
  appDialogSecondary,
  appDialogSetPromptRevealPassword,
  appDialogSetPromptSkipOnFail,
  appDialogUserDismiss,
} from "../services/appDialog";

useAppDialogLogSelectAll();

const promptInputRef = useTemplateRef<HTMLInputElement>("promptInputRef");
const promptTextareaRef = useTemplateRef<InstanceType<typeof AutoResizeTextarea>>(
  "promptTextareaRef",
);

const promptTextareaMaxHeight = computed(() =>
  Math.min(Math.floor(window.innerHeight * 0.4), 280),
);

const promptInputEffectiveType = computed(() => {
  if (
    appDialogModel.promptInputType === "password" &&
    appDialogModel.promptRevealPassword
  ) {
    return "text";
  }
  return appDialogModel.promptInputType;
});

const footerHasLeading = computed(
  () =>
    Boolean(appDialogModel.promptNeutralLabel) ||
    appDialogModel.promptShowPasswordToggle ||
    appDialogModel.promptShowSkipOnFailToggle,
);

const promptRevealPassword = computed({
  get: () => appDialogModel.promptRevealPassword,
  set(v: boolean) {
    appDialogSetPromptRevealPassword(v);
  },
});

const promptSkipOnFail = computed({
  get: () => appDialogModel.promptSkipOnFail,
  set(v: boolean) {
    appDialogSetPromptSkipOnFail(v);
  },
});

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

const panelClass = computed(() => {
  if (appDialogModel.kind === "prompt") {
    return "appDialogModalPanel appDialogModalPanel--prompt";
  }
  if (appDialogModel.kind === "log") {
    return "appDialogModalPanel appDialogModalPanel--log";
  }
  return "appDialogModalPanel";
});

const dialogMaxWidth = computed(() =>
  appDialogModel.kind === "log" ? "640px" : "440px",
);

watch(
  () => [appDialogModel.open, appDialogModel.kind] as const,
  ([open, kind]) => {
    if (open && kind === "prompt") {
      void nextTick(() => {
        if (appDialogModel.promptMultiline) {
          promptTextareaRef.value?.resize();
          promptTextareaRef.value?.focus();
          const el = promptTextareaRef.value?.textareaRef;
          if (el) {
            el.setSelectionRange(el.value.length, el.value.length);
          }
          return;
        }
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

function onNeutral() {
  appDialogNeutral();
}

function onPromptKeydown(e: KeyboardEvent) {
  if (e.key !== "Enter" || e.shiftKey) return;
  if (appDialogModel.promptMultiline) return;
  e.preventDefault();
  onPrimary();
}

function onLogPointerDown(e: MouseEvent) {
  const el = e.currentTarget;
  if (el instanceof HTMLElement) {
    el.focus({ preventScroll: true });
  }
}
</script>

<template>
  <AppModal
    v-model="dialogOpen"
    :title="appDialogModel.title"
    :dangerously-use-h-t-m-l-string="appDialogModel.dangerouslyUseHTMLString"
    :max-width="dialogMaxWidth"
    :mask-closable="true"
    :esc-closable="true"
    :show-close-button="true"
    :panel-class="panelClass"
    :body-scroll="true"
  >
    <div class="appDialogBody">
      <pre
        v-if="
          appDialogModel.kind === 'log' &&
          appDialogModel.message.trim() &&
          !appDialogModel.dangerouslyUseHTMLString
        "
        class="appDialogLog"
        tabindex="0"
        @mousedown="onLogPointerDown"
      >{{ appDialogModel.message }}</pre>
      <div
        v-else-if="
          appDialogModel.kind === 'log' &&
          appDialogModel.message.trim() &&
          appDialogModel.dangerouslyUseHTMLString
        "
        class="appDialogLog appDialogLog--html"
        tabindex="0"
        @mousedown="onLogPointerDown"
        v-html="appDialogModel.message"
      />
      <p
        v-else-if="appDialogModel.message.trim() && appDialogModel.dangerouslyUseHTMLString"
        class="appDialogMsg"
        v-html="appDialogModel.message"
      />
      <p v-else-if="appDialogModel.message.trim()" class="appDialogMsg">
        {{ appDialogModel.message }}
      </p>
      <input
        v-if="appDialogModel.kind === 'prompt' && !appDialogModel.promptMultiline"
        ref="promptInputRef"
        v-model="appDialogModel.promptValue"
        :type="promptInputEffectiveType"
        class="appDialogPromptInput"
        :placeholder="appDialogModel.promptPlaceholder || undefined"
        :min="appDialogModel.promptInputType === 'number' ? 1 : undefined"
        :step="appDialogModel.promptInputType === 'number' ? 1 : undefined"
        autocomplete="off"
        @keydown="onPromptKeydown"
      />
      <AutoResizeTextarea
        v-else-if="appDialogModel.kind === 'prompt' && appDialogModel.promptMultiline"
        ref="promptTextareaRef"
        v-model="appDialogModel.promptValue"
        class="appDialogPromptTextarea"
        :max-height="promptTextareaMaxHeight"
        :placeholder="appDialogModel.promptPlaceholder || undefined"
        spellcheck="false"
      />
    </div>
    <template #footer>
      <div
        class="appDialogModalFooter"
        :class="{
          'appDialogModalFooter--single':
            appDialogModel.kind === 'alert' || appDialogModel.kind === 'log',
          'appDialogModalFooter--withNeutral':
            appDialogModel.kind === 'prompt' && footerHasLeading,
        }"
      >
        <template v-if="appDialogModel.kind === 'alert' || appDialogModel.kind === 'log'">
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
          <div
            v-if="
              appDialogModel.promptShowPasswordToggle ||
              appDialogModel.promptShowSkipOnFailToggle
            "
            class="appDialogFooterLeading"
          >
            <AppCheckbox
              v-if="appDialogModel.promptShowPasswordToggle"
              v-model="promptRevealPassword"
              class="appDialogShowPassword"
              label="显示密码"
            />
            <AppCheckbox
              v-if="appDialogModel.promptShowSkipOnFailToggle"
              v-model="promptSkipOnFail"
              class="appDialogSkipOnFail"
              label="解密失败时跳过"
            />
          </div>
          <button
            v-else-if="appDialogModel.promptNeutralLabel"
            type="button"
            class="btn appDialogNeutralBtn"
            size="large"
            @click="onNeutral"
          >
            {{ appDialogModel.promptNeutralLabel }}
          </button>
          <div class="appDialogModalFooterActions">
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
          </div>
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

:deep(.appDialogModalPanel--log) {
  max-height: min(90vh, 560px);
}

.appDialogBody {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.appDialogLog {
  margin: 0;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  color: var(--fg);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  max-height: min(60vh, 480px);
  overflow: auto;
  outline: none;
}

.appDialogLog:focus-visible {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.appDialogMsg {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--fg);
  word-break: break-word;
}

.appDialogMsg :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.92em;
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background: color-mix(in srgb, var(--fg) 8%, transparent);
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

.appDialogPromptTextarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
}

.appDialogPromptTextarea:focus {
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

.appDialogModalFooter--withNeutral {
  justify-content: space-between;
  align-items: center;
}

.appDialogModalFooterActions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}

.appDialogNeutralBtn {
  flex-shrink: 0;
}

.appDialogShowPassword {
  flex-shrink: 0;
  font-size: 13px;
}

.appDialogFooterLeading {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  min-width: 0;
}

.appDialogSkipOnFail {
  flex-shrink: 0;
  font-size: 13px;
}
</style>
