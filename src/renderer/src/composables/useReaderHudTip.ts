import { onBeforeUnmount, ref } from "vue";

const HUD_VISIBLE_MS = 1000;
const HUD_FADE_MS = 250;

/**
 * 阅读区中央胶囊提示（与全屏 `fullscreenTip` 同外观，位置在阅读器正中）。
 * 连按或按住快捷键时重置计时，只显示最后一次文案。
 */
export function useReaderHudTip() {
  const readerHudTipVisible = ref(false);
  const readerHudTipFading = ref(false);
  const readerHudTipText = ref("");
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function clearReaderHudTipTimers() {
    if (fadeTimer) clearTimeout(fadeTimer);
    if (hideTimer) clearTimeout(hideTimer);
    fadeTimer = null;
    hideTimer = null;
  }

  function showReaderHudTip(text: string) {
    const next = text.trim();
    if (!next) return;
    readerHudTipText.value = next;
    readerHudTipVisible.value = true;
    readerHudTipFading.value = false;
    clearReaderHudTipTimers();
    fadeTimer = setTimeout(() => {
      readerHudTipFading.value = true;
    }, HUD_VISIBLE_MS);
    hideTimer = setTimeout(() => {
      readerHudTipVisible.value = false;
      readerHudTipFading.value = false;
    }, HUD_VISIBLE_MS + HUD_FADE_MS);
  }

  onBeforeUnmount(clearReaderHudTipTimers);

  return {
    readerHudTipVisible,
    readerHudTipFading,
    readerHudTipText,
    showReaderHudTip,
  };
}
