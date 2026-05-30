<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, useSlots, watch } from "vue";
import { icons } from "../icons";
import { registerModal } from "../utils/modalStack";

const props = withDefaults(
  defineProps<{
    /** 标题；为空则不渲染标题行 */
    title?: string;
    maskClosable?: boolean;
    escClosable?: boolean;
    /**
     * 右上角关闭：默认同 `(maskClosable || escClosable)`（不可蒙层且不可 Esc 的弹框不显示）。
     * 设为 `false` 可强制隐藏。
     */
    showCloseButton?: boolean;
    /** 内容区面板最大宽度，如 520px、800px */
    maxWidth?: string;
    bodyScroll?: boolean;
    panelClass?: string;
  }>(),
  {
    title: "",
    maskClosable: true,
    escClosable: true,
    showCloseButton: true,
    maxWidth: "520px",
    bodyScroll: true,
    panelClass: "",
  },
);

const showCloseChrome = computed(
  () =>
    props.showCloseButton !== false &&
    (props.maskClosable || props.escClosable),
);

const modelValue = defineModel<boolean>({ default: false });

const slots = useSlots();
const titleId = useId();

const zIndex = ref(6000);

let unregister: (() => void) | null = null;

function close() {
  modelValue.value = false;
}

function onMaskClick() {
  if (props.maskClosable) close();
}

watch(
  modelValue,
  (open) => {
    if (open) {
      const reg = registerModal({
        close,
        getEscClosable: () => props.escClosable,
      });
      zIndex.value = reg.zIndex;
      unregister = reg.unregister;
    } else {
      unregister?.();
      unregister = null;
    }
  },
  { flush: "sync" },
);

onBeforeUnmount(() => {
  unregister?.();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="appModal">
      <div
        v-if="modelValue"
        class="appModalBackdrop"
        data-fullscreen-header-float
        :style="{ zIndex }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title ? titleId : undefined"
        :aria-label="title ? undefined : '对话框'"
        @click.self="onMaskClick"
        @drop.stop.prevent
      >
        <div
          class="appModalPanel"
          :style="{ maxWidth }"
          :class="panelClass"
          @click.stop
        >
          <div
            v-if="title || showCloseChrome"
            class="appModalPanelHeader"
            :class="{
              'appModalPanelHeader--noTitle': !title,
              'appModalPanelHeader--noClose': !showCloseChrome,
            }"
          >
            <h2 v-if="title" :id="titleId" class="appModalTitle">
              {{ title }}
            </h2>
            <button
              v-if="showCloseChrome"
              type="button"
              class="appModalClose"
              aria-label="关闭"
              title="关闭"
              @click="close"
            >
              <span
                class="appModalCloseIcon"
                aria-hidden="true"
                v-html="icons.close"
              />
            </button>
          </div>
          <div
            class="appModalBody"
            :class="{ 'appModalBody--noScroll': !bodyScroll }"
          >
            <slot />
          </div>
          <div v-if="slots.footer" class="appModalFooter">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.appModalBackdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}

.appModal-enter-active,
.appModal-leave-active {
  transition: opacity 0.22s ease;
}

.appModal-enter-from,
.appModal-leave-to {
  opacity: 0;
}

.appModal-enter-active .appModalPanel,
.appModal-leave-active .appModalPanel {
  transform-origin: center center;
  transition:
    transform 0.22s ease-out,
    opacity 0.2s ease-out;
}

.appModal-enter-from .appModalPanel {
  transform: scale(0.9);
  opacity: 0;
}

.appModal-leave-to .appModalPanel {
  transform: scale(0.96);
  opacity: 0;
}

.appModalPanel {
  width: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
  max-height: min(90vh, 720px);
  padding: 20px 22px;
  border-radius: 10px;
  background: var(--panel);
  border: 1px solid var(--border);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
  user-select: none;
}

.appModalPanelHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  margin-bottom: 8px;
  min-width: 0;
}

.appModalPanelHeader--noTitle {
  justify-content: flex-end;
  margin-bottom: 0;
}

.appModalPanelHeader--noClose {
  justify-content: flex-start;
}

.appModalTitle {
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--fg);
}

.appModalClose {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  cursor: pointer;
  color: var(--icon-btn-fg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  right: 0;
  top: 0;
}

.appModalClose:hover {
  color: var(--accent);
}

.appModalCloseIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.appModalCloseIcon :deep(svg) {
  display: block;
  /* close.svg 图形留白较多，比工具栏同 px 更显小，弹框内略放大 */
  width: 16px;
  height: 16px;
}

.appModalCloseIcon :deep(path) {
  fill: currentColor;
}

.appModalBody {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.appModalBody--noScroll {
  overflow: hidden;
}

.appModalFooter {
  flex-shrink: 0;
  margin-top: 16px;
  width: 100%;
  min-width: 0;
}
</style>
