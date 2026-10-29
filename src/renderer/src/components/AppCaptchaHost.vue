<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, useTemplateRef, watch } from "vue";
import AppModal from "./AppModal.vue";
import {
  appCaptchaModel,
  dismissAppCaptcha,
  isAppCaptchaClosingAfterSubmit,
  openAppCaptcha,
  submitAppCaptcha,
} from "../services/appCaptcha";

const codeInputRef = useTemplateRef<HTMLInputElement>("codeInputRef");

const captchaOpen = computed({
  get: () => appCaptchaModel.open,
  set(v: boolean) {
    if (v) {
      appCaptchaModel.open = true;
      return;
    }
    if (isAppCaptchaClosingAfterSubmit()) {
      appCaptchaModel.open = false;
      return;
    }
    void submitAppCaptcha(false);
  },
});

watch(
  () => appCaptchaModel.open,
  (open) => {
    if (!open) return;
    void nextTick(() => {
      codeInputRef.value?.focus();
      codeInputRef.value?.select?.();
    });
  },
);

function onPrimary() {
  const input = codeInputRef.value;
  if (input) appCaptchaModel.code = input.value;
  void submitAppCaptcha(true);
}

function onSecondary() {
  void submitAppCaptcha(false);
}

function onCodeKeydown(e: KeyboardEvent) {
  if (e.key !== "Enter" || e.shiftKey) return;
  e.preventDefault();
  onPrimary();
}

let offRequest: (() => void) | undefined;
let offDismiss: (() => void) | undefined;

onMounted(() => {
  offRequest = window.colorTxt.onBookSourceCaptchaRequest((payload) => {
    openAppCaptcha(payload);
  });
  offDismiss = window.colorTxt.onBookSourceCaptchaDismiss(({ requestId }) => {
    dismissAppCaptcha(requestId);
  });
});

onUnmounted(() => {
  offRequest?.();
  offDismiss?.();
});
</script>

<template>
  <AppModal
    v-model="captchaOpen"
    title="输入验证码"
    max-width="400px"
    :mask-closable="true"
    :esc-closable="true"
    :show-close-button="true"
    panel-class="appCaptchaModalPanel"
    :body-scroll="false"
  >
    <div class="appCaptchaBody">
      <p v-if="appCaptchaModel.sourceName.trim()" class="appCaptchaSource">
        {{ appCaptchaModel.sourceName }}
      </p>
      <div class="appCaptchaImgWrap">
        <img
          v-if="appCaptchaModel.imageDataUrl"
          :src="appCaptchaModel.imageDataUrl"
          alt="验证码"
          class="appCaptchaImg"
        />
      </div>
      <label class="appCaptchaLabel" for="book-source-captcha-input">验证码</label>
      <input
        id="book-source-captcha-input"
        ref="codeInputRef"
        v-model="appCaptchaModel.code"
        type="text"
        class="appCaptchaInput"
        autocomplete="off"
        spellcheck="false"
        @keydown="onCodeKeydown"
      />
    </div>
    <template #footer>
      <div class="appCaptchaFooter">
        <button type="button" class="btn" size="large" @click="onSecondary">
          取消
        </button>
        <button type="button" class="btn primary" size="large" @click="onPrimary">
          确定
        </button>
      </div>
    </template>
  </AppModal>
</template>

<style scoped>
:deep(.appCaptchaModalPanel) {
  max-height: min(90vh, 420px);
}

.appCaptchaBody {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.appCaptchaSource {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: var(--muted, #666);
}

.appCaptchaImgWrap {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 102px;
}

.appCaptchaImg {
  max-width: 100%;
  max-height: 160px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: color-mix(in srgb, var(--panel) 70%, #888 30%);
}

.appCaptchaLabel {
  font-size: 13px;
}

.appCaptchaInput {
  width: 100%;
  box-sizing: border-box;
}

.appCaptchaFooter {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}
</style>
