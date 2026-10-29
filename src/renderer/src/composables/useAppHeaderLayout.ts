import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  HEADER_COMPACT_FONT_BREAKPOINT,
  HEADER_COMPACT_FORMAT_BREAKPOINT,
  type AppHeaderLayoutOptions,
} from "../constants/appHeaderLayout";

export type { AppHeaderLayoutOptions };

export function useAppHeaderLayout(options: AppHeaderLayoutOptions = {}) {
  const compactFontBreakpoint =
    options.compactFontBreakpoint ?? HEADER_COMPACT_FONT_BREAKPOINT;
  const compactFormatBreakpoint =
    options.compactFormatBreakpoint ?? HEADER_COMPACT_FORMAT_BREAKPOINT;

  const windowWidth = ref(
    typeof window !== "undefined" ? window.innerWidth : 1200,
  );

  const compactFontToolbar = computed(
    () => windowWidth.value < compactFontBreakpoint,
  );
  const compactFormatToolbar = computed(
    () => windowWidth.value < compactFormatBreakpoint,
  );

  function onResize() {
    windowWidth.value = window.innerWidth;
  }

  onMounted(() => {
    window.addEventListener("resize", onResize, { passive: true });
  });

  onBeforeUnmount(() => {
    window.removeEventListener("resize", onResize);
  });

  return {
    compactFontToolbar,
    compactFormatToolbar,
  };
}
