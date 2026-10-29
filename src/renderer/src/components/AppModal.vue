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
    /** 撑满整个窗口（无圆角、无外边距） */
    fullscreen?: boolean;
    /** 与窗口边缘留白（px 或带单位字符串），面板撑满剩余区域 */
    inset?: number | string;
    bodyScroll?: boolean;
    panelClass?: string;
    /** 为 true 时 title 按 HTML 渲染（仅传入可信内容） */
    dangerouslyUseHTMLString?: boolean;
    /**
     * 为全屏浮动顶栏 `mouseleave` 白名单标记蒙层（默认 true）。
     * 找书阅读器等「整窗即阅读器」的全屏 AppModal 应设为 false，否则移入正文无法收起顶栏。
     */
    fullscreenHeaderFloat?: boolean;
    /**
     * 关闭前钩子（× / Esc / 蒙层）。返回 false 则取消关闭。
     * 父级直接改 v-model 为 false 时不会调用（如保存成功后关闭）。
     */
    beforeClose?: () => boolean | Promise<boolean>;
  }>(),
  {
    title: "",
    maskClosable: true,
    escClosable: true,
    showCloseButton: true,
    maxWidth: "520px",
    fullscreen: false,
    bodyScroll: true,
    panelClass: "",
    dangerouslyUseHTMLString: false,
    fullscreenHeaderFloat: true,
  },
);

const emit = defineEmits<{
  /** 蒙层根节点捕获阶段的 keydown（焦点在弹框内或蒙层自身时触发） */
  keydown: [ev: KeyboardEvent];
}>();

const slots = useSlots();

const showCloseChrome = computed(
  () =>
    props.showCloseButton !== false &&
    (props.maskClosable || props.escClosable),
);

const hasTitle = computed(() => Boolean(props.title.trim()));

const showHeader = computed(
  () =>
    Boolean(
      hasTitle.value ||
        showCloseChrome.value ||
        slots.headerPrefix ||
        slots.headerSuffix ||
        slots.headerActions,
    ),
);

const insetCss = computed(() => {
  if (props.inset == null || props.inset === "") return undefined;
  return typeof props.inset === "number" ? `${props.inset}px` : props.inset;
});

const modelValue = defineModel<boolean>({ default: false });

const titleId = useId();
const backdropEl = ref<HTMLElement | null>(null);

const zIndex = ref(6000);

let unregister: (() => void) | null = null;
let bringToFrontFn: (() => void) | null = null;
let closeInFlight = false;

async function close() {
  if (closeInFlight) return;
  closeInFlight = true;
  try {
    if (props.beforeClose) {
      const ok = await props.beforeClose();
      if (!ok) return;
    }
    modelValue.value = false;
  } finally {
    closeInFlight = false;
  }
}

function bringToFront() {
  bringToFrontFn?.();
}

/** 将焦点收到蒙层根节点，便于弹框级快捷键在点击蒙层后仍可用 */
function focusBackdrop() {
  backdropEl.value?.focus({ preventScroll: true });
}

function onMaskClick() {
  if (props.maskClosable) {
    void close();
    return;
  }
  focusBackdrop();
}

function onBackdropKeydown(ev: KeyboardEvent) {
  emit("keydown", ev);
}

watch(
  modelValue,
  (open) => {
    if (open) {
      const reg = registerModal({
        close,
        getEscClosable: () => props.escClosable,
        setZIndex: (z) => {
          zIndex.value = z;
        },
      });
      zIndex.value = reg.zIndex;
      unregister = reg.unregister;
      bringToFrontFn = reg.bringToFront;
    } else {
      unregister?.();
      unregister = null;
      bringToFrontFn = null;
    }
  },
  { flush: "sync", immediate: true },
);

onBeforeUnmount(() => {
  unregister?.();
});

defineExpose({
  bringToFront,
  focusBackdrop,
});
</script>

<template>
  <Teleport to="body">
    <Transition name="appModal">
      <div
        v-if="modelValue"
        ref="backdropEl"
        class="appModalBackdrop"
        :class="{
          'appModalBackdrop--fullscreen': fullscreen,
          'appModalBackdrop--inset': insetCss,
        }"
        :data-fullscreen-header-float="fullscreenHeaderFloat || undefined"
        :style="{ zIndex, padding: insetCss }"
        tabindex="-1"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="hasTitle ? titleId : undefined"
        :aria-label="hasTitle ? undefined : '对话框'"
        @click.self="onMaskClick"
        @keydown.capture="onBackdropKeydown"
        @drop.stop.prevent
      >
        <div
          class="appModalPanel"
          :style="
            fullscreen || insetCss
              ? { maxWidth: insetCss ? '100%' : undefined }
              : { maxWidth }
          "
          :class="[
            panelClass,
            {
              'appModalPanel--fullscreen': fullscreen,
              'appModalPanel--inset': insetCss,
            },
          ]"
          @click.stop
        >
          <div
            v-if="showHeader"
            class="appModalPanelHeader"
            :class="{
              'appModalPanelHeader--noTitle': !hasTitle,
              'appModalPanelHeader--noClose': !showCloseChrome,
            }"
          >
            <div class="appModalTitleCluster">
              <slot name="headerPrefix" />
              <h2
                v-if="hasTitle"
                :id="titleId"
                class="appModalTitle"
                :class="{ 'appModalTitle--withSuffix': !!slots.headerSuffix }"
              >
                <span
                  v-if="dangerouslyUseHTMLString"
                  v-html="title"
                />
                <template v-else>{{ title }}</template>
              </h2>
              <slot name="headerSuffix" />
            </div>
            <div
              v-if="slots.headerActions || showCloseChrome"
              class="appModalHeaderEnd"
            >
              <div v-if="slots.headerActions" class="appModalHeaderActions">
                <slot name="headerActions" />
              </div>
              <button
                v-if="showCloseChrome"
                type="button"
                class="appModalClose"
                aria-label="关闭"
                title="关闭"
                @click="void close()"
              >
                <span
                  class="appModalCloseIcon"
                  aria-hidden="true"
                  v-html="icons.close"
                />
              </button>
            </div>
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
  outline: none;
}

.appModalBackdrop--fullscreen {
  padding: 0;
  align-items: stretch;
  justify-content: stretch;
  background: var(--panel, #fff);
}

.appModalBackdrop--inset {
  align-items: stretch;
  justify-content: stretch;
  box-sizing: border-box;
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

.appModalBackdrop--fullscreen.appModal-enter-from .appModalPanel,
.appModalBackdrop--fullscreen.appModal-leave-to .appModalPanel {
  transform: none;
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

.appModalPanel--fullscreen {
  max-width: none;
  max-height: none;
  height: 100%;
  border-radius: 0;
  border: none;
  box-shadow: none;
  padding: 0;
}

.appModalPanel--inset {
  width: 100%;
  height: 100%;
  max-height: none;
  display: flex;
  flex-direction: column;
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

.appModalPanelHeader:has(.appModalHeaderActions) {
  padding-right: 90px;
}

.appModalPanel--fullscreen .appModalPanelHeader {
  margin-bottom: 0;
  padding: 10px;
  border-bottom: 1px solid var(--border);
}

.appModalPanelHeader--noTitle {
  justify-content: flex-end;
  margin-bottom: 0;
}

.appModalPanelHeader--noClose {
  justify-content: flex-start;
}

.appModalTitleCluster {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 auto;
  min-width: 0;
}

.appModalTitle {
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--fg);
}

.appModalTitle--withSuffix {
  flex: 0 1 auto;
}

.appModalHeaderEnd {
  position: absolute;
  right: 0;
  top: 0;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  height: 48px;
}

.appModalHeaderActions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 2px;
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
  position: static;
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

.appModalCloseIcon :deep(svg path) {
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
