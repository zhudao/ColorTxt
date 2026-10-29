<script setup lang="ts">
withDefaults(
  defineProps<{
    /** SVG 字符串，与 icons.xxx 一致；有默认插槽时可省略 */
    iconHtml?: string;
    title?: string;
    /** 图标按钮无文字时建议设置，便于读屏 */
    ariaLabel?: string;
    active?: boolean;
    /** 有值时设置 aria-pressed（切换型按钮） */
    pressed?: boolean;
    /** 多色 SVG，不强制 path 为 currentColor */
    multicolor?: boolean;
    disabled?: boolean;
    /** 表格操作列等：32×32、图标 18px */
    large?: boolean;
    /** 编辑态「格式化」类操作：图标使用主题色，与只读切换按钮区分 */
    primary?: boolean;
    /**
     * 危险操作（删除/移除等）：默认 muted，悬停 danger 色 + 浅红底。
     * 与 `primary` 互斥使用。
     */
    danger?: boolean;
    /** 临时态（如按住 Alt 切换阅读交互模式）：图标为 warning 色 */
    warning?: boolean;
  }>(),
  {
    active: false,
    multicolor: false,
    disabled: false,
    large: false,
    primary: false,
    danger: false,
    warning: false,
  },
);

defineEmits<{ click: [e: MouseEvent] }>();
</script>

<template>
  <button
    type="button"
    class="iconBtn"
    :class="{ active, large, primary, danger, warning }"
    :title="title"
    :aria-label="ariaLabel"
    :aria-pressed="pressed"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <span v-if="$slots.default" class="icon" :class="{ 'icon--multicolor': multicolor }">
      <slot />
    </span>
    <span
      v-else
      class="icon"
      :class="{ 'icon--multicolor': multicolor }"
      v-html="iconHtml"
    ></span>
  </button>
</template>

<style scoped>
.iconBtn {
  background: transparent;
  border: none;
  border-radius: 4px;
  width: 30px;
  height: 30px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.iconBtn:hover:not(:disabled) {
  background: var(--icon-btn-bg-hover);
}

.icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  color: var(--icon-btn-fg);
}

.icon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.icon:not(.icon--multicolor) :deep(svg path) {
  fill: currentColor;
}

.iconBtn:hover:not(:disabled) .icon:not(.icon--multicolor) {
  color: var(--icon-btn-fg);
}

.iconBtn:focus {
  outline: none;
}

.iconBtn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.iconBtn.active {
  background: var(--icon-btn-bg-active);
}

.iconBtn.active .icon:not(.icon--multicolor) {
  color: var(--icon-btn-fg);
}

.iconBtn.primary {
  background: var(--primary);
}
.iconBtn.primary:hover:not(:disabled) {
  background: var(--primary-hover);
}
.iconBtn.primary .icon:not(.icon--multicolor) {
  color: #ffffff;
}
.iconBtn.primary:hover:not(:disabled) .icon:not(.icon--multicolor) {
  color: #ffffff;
}

.iconBtn.large {
  width: 32px;
  height: 32px;
  border-radius: 6px;
}
.iconBtn.large .icon {
  width: 18px;
  height: 18px;
}
.iconBtn.large .icon :deep(svg) {
  width: 18px;
  height: 18px;
}

/** 删除/移除：默认 --icon-btn-fg，悬停 --danger（书架管理、阅读数据等） */
.iconBtn.danger {
  border-radius: 6px;
  color: var(--icon-btn-fg);
}
.iconBtn.danger .icon:not(.icon--multicolor) {
  color: var(--icon-btn-fg);
}
.iconBtn.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}
.iconBtn.danger:hover:not(:disabled) .icon:not(.icon--multicolor) {
  color: var(--danger);
}
.iconBtn.danger.active {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
.iconBtn.danger.active .icon:not(.icon--multicolor) {
  color: var(--danger);
}

.iconBtn.warning .icon:not(.icon--multicolor) {
  color: var(--warning);
}
.iconBtn.warning:hover:not(:disabled) .icon:not(.icon--multicolor) {
  color: var(--warning);
}
</style>
