<script setup lang="ts">
import IconButton from "./IconButton.vue";
import { icons } from "../icons";
import type { ShortcutBindingMap } from "../services/shortcutRegistry";
import { titleWithShortcut } from "../services/shortcutUtils";
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    minimalist?: boolean;
    disabled?: boolean;
    shortcutBindings?: ShortcutBindingMap;
  }>(),
  {
    minimalist: false,
    disabled: false,
  },
);

const emit = defineEmits<{
  toggleMinimalist: [];
}>();

const isMacPlatform = /mac|iphone|ipad|ipod/i.test(navigator.platform || "");

const buttonTitle = computed(() => {
  const base = props.minimalist ? "退出极简视图" : "极简视图";
  if (props.disabled) return `${base}（全屏时不可用）`;
  const accel = props.shortcutBindings?.toggleMinimalistView;
  return accel ? titleWithShortcut(base, accel, isMacPlatform) : base;
});
</script>

<template>
  <IconButton
    :icon-html="
      minimalist ? icons.leaveMinimalistView : icons.enterMinimalistView
    "
    :active="minimalist"
    :pressed="minimalist"
    :disabled="disabled"
    :title="buttonTitle"
    :aria-label="buttonTitle"
    @click="emit('toggleMinimalist')"
  />
</template>
