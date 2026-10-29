<script setup lang="ts">
export type RadioGroupOption = {
  id: string;
  label: string;
};

const modelValue = defineModel<string>({ required: true });

withDefaults(
  defineProps<{
    options: readonly RadioGroupOption[];
    /** 供屏幕阅读器使用；无可见标签时请传入 */
    ariaLabel?: string;
    disabled?: boolean;
    /** `md` 默认；`sm` 用于侧栏等紧凑区域 */
    size?: "md" | "sm";
  }>(),
  { ariaLabel: "", disabled: false, size: "md" },
);

function select(id: string, disabled: boolean) {
  if (disabled || modelValue.value === id) return;
  modelValue.value = id;
}
</script>

<template>
  <div
    class="radioGroup"
    :class="{
      'radioGroup--sm': size === 'sm',
      'radioGroup--disabled': disabled,
    }"
    role="radiogroup"
    :aria-label="ariaLabel || undefined"
  >
    <button
      v-for="opt in options"
      :key="opt.id"
      type="button"
      class="radioGroupOption"
      role="radio"
      :aria-checked="modelValue === opt.id"
      :disabled="disabled"
      :class="{ active: modelValue === opt.id }"
      @click="select(opt.id, disabled)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.radioGroup {
  display: inline-flex;
  flex-shrink: 0;
  vertical-align: middle;
}

.radioGroup--disabled {
  opacity: 0.55;
  pointer-events: none;
}

.radioGroupOption {
  position: relative;
  min-width: 0;
  margin-left: -1px;
  padding: 8px 15px;
  border: 1px solid var(--border);
  background: var(--control-bg);
  color: var(--fg);
  font-size: 14px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease,
    border-color 0.15s ease;
}

.radioGroupOption:first-child {
  margin-left: 0;
  border-radius: 4px 0 0 4px;
}

.radioGroupOption:last-child {
  border-radius: 0 4px 4px 0;
}

.radioGroupOption:only-child {
  border-radius: 4px;
}

.radioGroupOption:hover:not(:disabled):not(.active) {
  color: var(--accent);
}

.radioGroupOption.active {
  z-index: 1;
  background: var(--accent);
  color: #ffffff;
}

.radioGroupOption:focus {
  outline: none;
}

.radioGroupOption:focus-visible {
  z-index: 2;
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.radioGroup--sm .radioGroupOption {
  padding: 5px 12px;
  font-size: 12px;
}
</style>
