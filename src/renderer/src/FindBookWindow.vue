<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import FindBookPanel from "./bookSource/components/FindBookPanel.vue";
import AppCaptchaHost from "./components/AppCaptchaHost.vue";
import AppDialogHost from "./components/AppDialogHost.vue";
import AppLoadingHost from "./components/AppLoadingHost.vue";
import AppToastHost from "./components/AppToastHost.vue";
import {
  applyAppShellTheme,
  listenPersistedSettingsSync,
  readPersistedAppShellTheme,
} from "./utils/appShellThemeSync";

let offWindowRequestClose: (() => void) | null = null;
let offThemeSync: (() => void) | null = null;

function syncThemeFromStorage() {
  applyAppShellTheme(readPersistedAppShellTheme());
}

function closeWindow() {
  window.colorTxt.proceedCloseWindow();
}

function onGoMain() {
  window.colorTxt.focusOrOpenMainWindow();
}

onMounted(() => {
  syncThemeFromStorage();
  offThemeSync = listenPersistedSettingsSync(syncThemeFromStorage);
  offWindowRequestClose = window.colorTxt.onWindowRequestClose(() => {
    closeWindow();
  });
});

onBeforeUnmount(() => {
  offThemeSync?.();
  offThemeSync = null;
  offWindowRequestClose?.();
  offWindowRequestClose = null;
});
</script>

<template>
  <div class="findBookWindowRoot">
    <FindBookPanel standalone @go-main="onGoMain" />
    <AppCaptchaHost />
    <AppDialogHost />
    <AppLoadingHost />
    <AppToastHost />
  </div>
</template>

<style scoped>
.findBookWindowRoot {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--panel);
  color: var(--fg);
}
</style>
