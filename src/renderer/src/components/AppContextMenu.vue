<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toRef,
  watch,
} from "vue";
import { syncDismissibleOverlay } from "../utils/dismissibleOverlayStack";

defineOptions({ inheritAttrs: false });

export type ContextMenuItem = {
  id: string;
  label?: string;
  type?: "primary" | "success" | "warning" | "danger";
  separator?: boolean;
  disabled?: boolean;
  /** 与 `icons.*` 一致，渲染在标签左侧 */
  iconHtml?: string;
  /** 子菜单项；有 children 时父项不触发 select */
  children?: readonly ContextMenuItem[];
};

const props = withDefaults(
  defineProps<{
    open: boolean;
    x: number;
    y: number;
    items: readonly ContextMenuItem[];
    minWidth?: number;
    /** 点击落点在此元素内时不视为“外部点击”，不自动关闭（用于锚点按钮触发的菜单） */
    excludeCloseWithin?: HTMLElement | null;
    /**
     * `point`：以 (x,y) 为左上角（经视口夹取）。
     * `aboveFooterMouseX`：菜单在底栏上方弹出（底边不盖住底栏），水平以 `pointerXPx` 居中对齐后再夹到视口内。
     */
    placement?: "point" | "aboveFooterMouseX";
    /** `placement === 'aboveFooterMouseX'` 时：底栏 `getBoundingClientRect().top` */
    footerTopPx?: number | null;
    /** `placement === 'aboveFooterMouseX'` 时：打开菜单时的指针 `clientX` */
    pointerXPx?: number | null;
    /** 叠放层级；默认高于嵌套 AppModal */
    zIndex?: number;
  }>(),
  {
    placement: "point",
    footerTopPx: null,
    pointerXPx: null,
    excludeCloseWithin: undefined,
    zIndex: undefined,
  },
);

const emit = defineEmits<{
  close: [];
  select: [id: string];
}>();

syncDismissibleOverlay(toRef(props, "open"));

const menuRef = ref<HTMLElement | null>(null);
const posX = ref(0);
const posY = ref(0);
const openSubId = ref<string | null>(null);
const flyoutSide = ref<"right" | "left">("right");
const flyoutElById = new Map<string, HTMLElement>();

const zIndexStyle = computed(() => props.zIndex ?? 12000);

function itemClass(item: ContextMenuItem) {
  const c = ["appShellMenuItem"];
  if (item.type) c.push(`appShellMenuItem--${item.type}`);
  return c.join(" ");
}

function hasChildren(item: ContextMenuItem): boolean {
  return Array.isArray(item.children);
}

function onLeafClick(item: ContextMenuItem) {
  if (item.disabled) return;
  emit("select", item.id);
}

function openSubmenu(item: ContextMenuItem) {
  if (item.disabled || !hasChildren(item)) return;
  openSubId.value = item.id;
  void nextTick(() => layoutFlyout(item.id));
}

function closeSubmenu() {
  openSubId.value = null;
}

function setFlyoutEl(id: string, el: unknown) {
  if (el instanceof HTMLElement) {
    flyoutElById.set(id, el);
  } else {
    flyoutElById.delete(id);
  }
}

function layoutFlyout(id: string) {
  const flyout = flyoutElById.get(id);
  const menu = menuRef.value;
  if (!flyout || !menu) return;
  const menuRect = menu.getBoundingClientRect();
  const margin = 8;
  const preferRight = menuRect.right + 8 + flyout.offsetWidth <= window.innerWidth - margin;
  flyoutSide.value = preferRight ? "right" : "left";
  flyout.style.transform = "";
  void nextTick(() => {
    const r = flyout.getBoundingClientRect();
    let dy = 0;
    if (r.bottom > window.innerHeight - margin) {
      dy = window.innerHeight - margin - r.bottom;
    }
    if (r.top + dy < margin) {
      dy = margin - r.top;
    }
    if (dy !== 0) {
      flyout.style.transform = `translateY(${dy}px)`;
    }
  });
}

function clampPosition() {
  const menu = menuRef.value;
  if (!menu) return;
  const margin = 8;
  const gapAboveAnchor = 4;
  const maxX = Math.max(margin, window.innerWidth - menu.offsetWidth - margin);
  const maxY = Math.max(
    margin,
    window.innerHeight - menu.offsetHeight - margin,
  );

  if (
    props.placement === "aboveFooterMouseX" &&
    props.footerTopPx != null &&
    props.pointerXPx != null
  ) {
    const footerTop = props.footerTopPx;
    const xIdeal = props.pointerXPx - menu.offsetWidth / 2;
    posX.value = Math.min(Math.max(margin, xIdeal), maxX);
    const ymaxFoot = footerTop - gapAboveAnchor - menu.offsetHeight;
    posY.value = Math.min(
      Math.max(margin, ymaxFoot),
      Math.min(maxY, ymaxFoot),
    );
    return;
  }

  posX.value = Math.min(Math.max(margin, props.x), maxX);
  posY.value = Math.min(Math.max(margin, props.y), maxY);
}

watch(
  () =>
    [
      props.open,
      props.x,
      props.y,
      props.placement,
      props.footerTopPx,
      props.pointerXPx,
    ] as const,
  async ([open]) => {
    if (!open) {
      closeSubmenu();
      return;
    }
    closeSubmenu();
    if (props.placement === "point") {
      posX.value = props.x;
      posY.value = props.y;
    }
    await nextTick();
    clampPosition();
  },
);

function onDocPointerDown(ev: PointerEvent) {
  if (!props.open) return;
  const t = ev.target as Node | null;
  if (t && menuRef.value?.contains(t)) return;
  if (
    t &&
    props.excludeCloseWithin &&
    props.excludeCloseWithin.contains(t as Node)
  ) {
    return;
  }
  emit("close");
}

function onWindowInvalidate() {
  if (!props.open) return;
  emit("close");
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown, true);
  window.addEventListener("resize", onWindowInvalidate);
  window.addEventListener("blur", onWindowInvalidate);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  window.removeEventListener("resize", onWindowInvalidate);
  window.removeEventListener("blur", onWindowInvalidate);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menuRef"
      v-bind="$attrs"
      class="contextMenu appShellMenuPanel"
      role="menu"
      :style="{
        left: `${posX}px`,
        top: `${posY}px`,
        minWidth: `${minWidth ?? 140}px`,
        zIndex: zIndexStyle,
      }"
      @click.stop
      @contextmenu.prevent
      @pointerdown.stop
    >
      <template v-for="item in items" :key="item.id">
        <div v-if="item.separator" class="appShellMenuDivider" role="separator" />
        <div
          v-else-if="hasChildren(item)"
          class="appShellMenuSubWrap"
          @mouseenter="openSubmenu(item)"
          @mouseleave="closeSubmenu"
        >
          <button
            type="button"
            :class="itemClass(item)"
            role="menuitem"
            aria-haspopup="menu"
            :aria-expanded="openSubId === item.id"
            :disabled="item.disabled"
            @click="openSubmenu(item)"
          >
            <span
              v-if="item.iconHtml"
              class="appShellMenuItemPrefix"
              aria-hidden="true"
              v-html="item.iconHtml"
            />
            {{ item.label }}
            <span class="appShellMenuSubChevron" aria-hidden="true">›</span>
          </button>
          <div
            v-show="openSubId === item.id && !item.disabled"
            :ref="(el) => setFlyoutEl(item.id, el)"
            class="appShellMenuFlyout"
            :class="
              flyoutSide === 'left'
                ? 'appShellMenuFlyout--left'
                : 'appShellMenuFlyout--right'
            "
            role="menu"
            @click.stop
          >
            <div class="appShellMenuFlyoutList">
              <template v-for="child in item.children" :key="child.id">
                <div
                  v-if="child.separator"
                  class="appShellMenuFlyoutDivider"
                  role="separator"
                />
                <button
                  v-else
                  type="button"
                  class="appShellMenuFlyoutItem"
                  role="menuitem"
                  :disabled="child.disabled"
                  @click="onLeafClick(child)"
                >
                  <span class="appShellMenuFlyoutLabel">{{ child.label }}</span>
                </button>
              </template>
            </div>
          </div>
        </div>
        <button
          v-else
          type="button"
          :class="itemClass(item)"
          role="menuitem"
          :disabled="item.disabled"
          @click="onLeafClick(item)"
        >
          <span
            v-if="item.iconHtml"
            class="appShellMenuItemPrefix"
            aria-hidden="true"
            v-html="item.iconHtml"
          />
          {{ item.label }}
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.contextMenu {
  position: fixed;
  /* 默认高于嵌套 AppModal（6000+）；全屏编辑等场景可经 zIndex 再抬高 */
  z-index: 12000;
}

.contextMenu :deep(.appShellMenuItemPrefix svg path) {
  fill: currentColor;
}
</style>
