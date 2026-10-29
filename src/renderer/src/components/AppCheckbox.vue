<script setup lang="ts">
import { ref, watchEffect } from "vue";

const modelValue = defineModel<boolean>({ default: false });

const props = withDefaults(
  defineProps<{
    label?: string;
    disabled?: boolean;
    /** 为 true 时不响应指针事件（如文件列表行点击选中） */
    passive?: boolean;
    ariaLabel?: string;
    indeterminate?: boolean;
  }>(),
  {
    label: "",
    disabled: false,
    passive: false,
    ariaLabel: "",
    indeterminate: false,
  },
);

const inputRef = ref<HTMLInputElement | null>(null);

watchEffect(() => {
  if (inputRef.value) {
    inputRef.value.indeterminate = props.indeterminate;
  }
});
</script>

<template>
  <label
    class="checkbox appCheckbox"
    :class="{
      'appCheckbox--disabled': disabled,
      'appCheckbox--passive': passive,
    }"
  >
    <input
      ref="inputRef"
      v-model="modelValue"
      type="checkbox"
      :disabled="disabled"
      :aria-label="ariaLabel || label || undefined"
      :tabindex="passive ? -1 : undefined"
    />
    <span v-if="label || $slots.label" class="appCheckbox__label">
      <slot name="label">{{ label }}</slot>
    </span>
  </label>
</template>

<style scoped>
.appCheckbox {
  color: var(--fg);
  font-size: 14px;
}

.appCheckbox--passive {
  pointer-events: none;
}

.appCheckbox--disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.appCheckbox__label {
  display: inline-flex;
  line-height: 1.4;
}
</style>
