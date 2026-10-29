<script setup lang="ts">
import { computed } from "vue";

defineOptions({ inheritAttrs: false });

const open = defineModel<boolean>("open", { required: true });

export type AppShellMenuCaret = false | "end" | "start" | "center";

const props = withDefaults(
  defineProps<{
    left: number;
    top: number;
    zIndex?: number;
    width?: number | string;
    minWidth?: number | string;
    maxHeight?: number | string;
    ariaLabel?: string;
    panelClass?: string;
    fullscreenFloat?: boolean;
    /** 全屏浮动顶栏 `mouseleave` 白名单（如顶栏「更多」菜单 Teleport） */
    fullscreenHeaderFloat?: boolean;
    /**
     * 面板上方小三角（对齐 MoreMenu）：`end`/`start`/`center` 相对面板水平位置。
     * 开启时 `overflow: visible`，避免裁切三角。
     */
    caret?: AppShellMenuCaret;
    /** 由 useAnchoredAppShellMenu 传入，用于测量与夹取定位（避免模板对 Ref prop 自动解包） */
    onPanelMount?: (el: HTMLElement | null) => void;
  }>(),
  {
    zIndex: 7200,
    fullscreenFloat: true,
    caret: false,
  },
);

const bodyMaxHeight = computed(() => {
  if (props.maxHeight == null) return undefined;
  return typeof props.maxHeight === "number"
    ? `${props.maxHeight}px`
    : props.maxHeight;
});

const panelClassList = computed(() => {
  const list: Array<string | undefined> = [props.panelClass];
  if (props.caret) {
    list.push("appShellMenuTeleport--withCaret");
    list.push(`appShellMenuTeleport--caret-${props.caret}`);
  }
  return list;
});

function setPanelEl(el: Element | null | { $el?: unknown }) {
  const node =
    el instanceof HTMLElement
      ? el
      : el && typeof el === "object" && "$el" in el && el.$el instanceof HTMLElement
        ? el.$el
        : null;
  props.onPanelMount?.(node);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      v-bind="$attrs"
      :ref="setPanelEl"
      class="appShellMenuTeleport appShellMenuPanel"
      :class="panelClassList"
      :data-fullscreen-sidebar-float="fullscreenFloat || undefined"
      :data-fullscreen-header-float="fullscreenHeaderFloat || undefined"
      role="menu"
      :aria-label="ariaLabel"
      :style="{
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        zIndex,
        width: width != null ? (typeof width === 'number' ? `${width}px` : width) : undefined,
        minWidth:
          minWidth != null
            ? typeof minWidth === 'number'
              ? `${minWidth}px`
              : minWidth
            : undefined,
      }"
      @click.stop
    >
      <div
        class="appShellMenuTeleportBody"
        :class="{ 'appShellMenuTeleportBody--scroll': !!bodyMaxHeight }"
        :style="{ maxHeight: bodyMaxHeight }"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.appShellMenuTeleport {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: max-content;
  min-width: max-content;
  max-width: min(100vw - 16px, max-content);
  overflow: hidden;
}

.appShellMenuTeleport--withCaret {
  overflow: visible;
}

.appShellMenuTeleportBody {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.appShellMenuTeleportBody--scroll {
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.appShellMenuTeleport--withCaret::before,
.appShellMenuTeleport--withCaret::after {
  content: "";
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
}

.appShellMenuTeleport--caret-end::before {
  top: -8px;
  right: 6px;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-bottom: 8px solid var(--border);
}

.appShellMenuTeleport--caret-end::after {
  top: -7px;
  right: 7px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-bottom: 7px solid var(--bg);
}

.appShellMenuTeleport--caret-start::before {
  top: -8px;
  left: 6px;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-bottom: 8px solid var(--border);
}

.appShellMenuTeleport--caret-start::after {
  top: -7px;
  left: 7px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-bottom: 7px solid var(--bg);
}

.appShellMenuTeleport--caret-center::before,
.appShellMenuTeleport--caret-center::after {
  left: 50%;
  transform: translateX(-50%);
}

.appShellMenuTeleport--caret-center::before {
  top: -8px;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-bottom: 8px solid var(--border);
}

.appShellMenuTeleport--caret-center::after {
  top: -7px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-bottom: 7px solid var(--bg);
}
</style>
