<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { OPENAI_COMPAT_API_ENDPOINT_PRESETS } from "@shared/apiEndpointPresets";

export type ApiEndpointSuggestionItem = {
  id: string;
  /** 列表主文案；缺省为 id */
  label?: string;
  description?: string;
};

const props = withDefaults(
  defineProps<{
    modelValue: string;
    placeholder?: string;
    suggestions?: readonly string[];
    suggestionItems?: readonly ApiEndpointSuggestionItem[];
    /** 追加到内部 input，用于 settings 行内 flex 宽度 */
    inputClass?: string;
    disabled?: boolean;
    ariaLabel?: string;
    /** 建议列表最大高度（px），与 AppCustomSelect 默认一致 */
    scrollMaxHeight?: number;
    /**
     * 选中建议时：`replace` 覆盖原值（默认）；
     * `append` 在末尾追加（已有内容加 `，` 分隔；已包含该建议则跳过）。
     */
    suggestionPickMode?: "replace" | "append";
  }>(),
  {
    modelValue: "",
    placeholder: "",
    suggestions: () => OPENAI_COMPAT_API_ENDPOINT_PRESETS,
    inputClass: "",
    disabled: false,
    ariaLabel: "接口地址",
    scrollMaxHeight: 220,
    suggestionPickMode: "replace",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const focused = ref(false);
const inputRef = useTemplateRef<HTMLInputElement>("inputRef");
const panelRef = useTemplateRef<HTMLElement>("panelRef");
const posLeft = ref(0);
const posTop = ref(0);
const panelWidth = ref(160);

const visibleSuggestions = computed(() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of props.suggestions) {
    const s = raw.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
});

const visibleSuggestionItems = computed((): ApiEndpointSuggestionItem[] => {
  if (props.suggestionItems?.length) {
    const seen = new Set<string>();
    const out: ApiEndpointSuggestionItem[] = [];
    for (const raw of props.suggestionItems) {
      const id = raw.id.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        label: raw.label?.trim() || undefined,
        description: raw.description?.trim() || undefined,
      });
    }
    return out;
  }
  return visibleSuggestions.value.map((id) => ({ id }));
});

const listOpen = computed(
  () =>
    focused.value &&
    !props.disabled &&
    visibleSuggestionItems.value.length > 0,
);

/** 与 AppCustomSelect.applyPanelPosition 一致 */
function applyPanelPosition(margin = 8, gap = 4) {
  const trig = inputRef.value;
  const panel = panelRef.value;
  if (!trig || !panel) return;
  const r = trig.getBoundingClientRect();
  const h = panel.offsetHeight;
  const w = panel.offsetWidth;
  if (h < 1 || w < 1) return;

  const spaceBelow = window.innerHeight - margin - r.bottom - gap;
  const spaceAbove = r.top - margin - gap;

  let top: number;
  if (h <= spaceBelow) {
    top = r.bottom + gap;
  } else if (h <= spaceAbove) {
    top = r.top - h - gap;
  } else if (spaceAbove >= spaceBelow) {
    top = Math.max(margin, r.top - h - gap);
  } else {
    top = Math.min(r.bottom + gap, window.innerHeight - margin - h);
  }

  posTop.value = Math.min(
    Math.max(margin, top),
    Math.max(margin, window.innerHeight - h - margin),
  );

  const maxX = Math.max(margin, window.innerWidth - w - margin);
  posLeft.value = Math.min(Math.max(margin, r.left), maxX);
}

async function positionPanel() {
  const trig = inputRef.value;
  if (!trig) return;
  const r = trig.getBoundingClientRect();
  panelWidth.value = Math.max(r.width, 140);
  posLeft.value = r.left;
  posTop.value = r.bottom + 4;
  await nextTick();
  await nextTick();
  applyPanelPosition();
  requestAnimationFrame(() => {
    applyPanelPosition();
  });
}

function onFocus() {
  focused.value = true;
}

function onBlur() {
  window.setTimeout(() => {
    focused.value = false;
  }, 120);
}

function onInput(ev: Event) {
  emit("update:modelValue", (ev.target as HTMLInputElement).value);
}

function pick(url: string) {
  const picked = url.trim();
  if (!picked) {
    focused.value = false;
    return;
  }
  if (props.suggestionPickMode === "append") {
    const cur = props.modelValue;
    if (cur.includes(picked)) {
      focused.value = false;
      return;
    }
    const head = cur.trimEnd();
    emit(
      "update:modelValue",
      head ? `${head.replace(/[，,]\s*$/, "")}，${picked}` : picked,
    );
  } else {
    emit("update:modelValue", url);
  }
  focused.value = false;
}

function onKeydown(ev: KeyboardEvent) {
  if (ev.key === "Escape") {
    focused.value = false;
    (ev.target as HTMLInputElement).blur();
  }
}

function onWindowResize() {
  if (listOpen.value) focused.value = false;
}

watch(listOpen, async (open) => {
  if (!open) return;
  await nextTick();
  await positionPanel();
  requestAnimationFrame(() => {
    applyPanelPosition();
  });
});

onMounted(() => {
  window.addEventListener("resize", onWindowResize);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", onWindowResize);
});
</script>

<template>
  <div class="apiEndpointInput">
    <input
      ref="inputRef"
      :value="modelValue"
      type="text"
      autocomplete="off"
      spellcheck="false"
      class="apiEndpointInput__field"
      :class="inputClass"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-expanded="listOpen"
      aria-autocomplete="list"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
    />
    <Teleport to="body">
      <div
        v-if="listOpen"
        ref="panelRef"
        data-fullscreen-sidebar-float
        class="apiEndpointInputPanel customSelectPanel appShellMenuPanel"
        role="listbox"
        :style="{
          left: `${posLeft}px`,
          top: `${posTop}px`,
          width: `${panelWidth}px`,
        }"
        @mousedown.prevent
      >
        <div class="customSelectScroll" :style="{ maxHeight: `${scrollMaxHeight}px` }">
          <button
            v-for="item in visibleSuggestionItems"
            :key="item.id"
            type="button"
            role="option"
            class="appShellMenuItem"
            :class="{
              'is-active': item.id === modelValue,
              'appShellMenuItem--stacked':
                item.description || (item.label?.trim() && item.label.trim() !== item.id),
            }"
            @click="pick(item.id)"
          >
            <span class="appShellMenuItemRowBody">
              <span class="appShellMenuItemLabelWithCount">
                <span
                  class="appShellMenuItemLabelBlock"
                  :class="{
                    'appShellMenuItemLabelBlock--stacked': item.description,
                  }"
                >
                  <span
                    class="appShellMenuItemLabelText apiEndpointInputMenuLabel"
                    >{{ item.label?.trim() || item.id }}</span
                  >
                  <span
                    v-if="item.description"
                    class="appShellMenuItemDescription"
                    >{{ item.description }}</span
                  >
                </span>
              </span>
            </span>
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.apiEndpointInput {
  position: relative;
  flex: 1 1 65%;
  min-width: 0;
  max-width: 100%;
}

.apiEndpointInput__field {
  width: 100%;
  box-sizing: border-box;
}

/* 与 AppCustomSelect.customSelectPanel 一致 */
.apiEndpointInputPanel {
  position: fixed;
  z-index: 7200;
  box-sizing: border-box;
  min-width: 140px;
}

.apiEndpointInputPanel :deep(.appShellMenuItem + .appShellMenuItem) {
  margin-top: 4px;
}

.apiEndpointInputPanel :deep(.appShellMenuItem) {
  min-height: 36px;
  box-sizing: border-box;
  line-height: 1.2;
}

.apiEndpointInputPanel :deep(.appShellMenuItemLabelText.apiEndpointInputMenuLabel) {
  white-space: normal;
  word-break: break-all;
}

.apiEndpointInputPanel .customSelectScroll {
  overflow-y: auto;
  min-height: 0;
  box-sizing: border-box;
}
</style>
