<script setup lang="ts">
import type { ColorTxtOpenDialogOptions } from "@shared/colorTxtOpenSaveDialog";
import { computed, ref } from "vue";
import { icons } from "../icons";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    /** true：目录；false：文件 */
    isDirectory?: boolean;
    placeholder?: string;
    /** 与设置里「仅展示路径」一致时可设为 true */
    inputReadonly?: boolean;
    disabled?: boolean;
    /** 无障碍名称；缺省用 placeholder 或「文件/目录路径」 */
    ariaLabel?: string;
    /** 文件选择对话框扩展名过滤（仅 `isDirectory=false` 时生效） */
    filters?: ColorTxtOpenDialogOptions["filters"];
  }>(),
  {
    modelValue: "",
    isDirectory: false,
    inputReadonly: false,
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [v: string];
}>();

function setPath(v: string) {
  emit("update:modelValue", v);
}

const inputAria = computed(() => {
  if (props.ariaLabel?.trim()) return props.ariaLabel.trim();
  if (props.placeholder?.trim()) return props.placeholder.trim();
  return props.isDirectory ? "目录路径" : "文件路径";
});

/** 拖入文件/目录时高亮输入框（非 Files 类型不亮） */
const isDragOver = ref(false);

function onDragEnter(ev: DragEvent) {
  if (props.disabled) return;
  if (!ev.dataTransfer?.types?.includes("Files")) return;
  ev.preventDefault();
  isDragOver.value = true;
}

function onDragLeave(ev: DragEvent) {
  const root = ev.currentTarget;
  if (!(root instanceof HTMLElement)) return;
  const related = ev.relatedTarget;
  if (related instanceof Node && root.contains(related)) return;
  isDragOver.value = false;
}

function onDragOver(ev: DragEvent) {
  ev.preventDefault();
  if (props.disabled) return;
  try {
    ev.dataTransfer!.dropEffect = "copy";
  } catch {
    // ignore
  }
}

async function onDrop(ev: DragEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  isDragOver.value = false;
  if (props.disabled) return;
  const api = window.colorTxt;
  if (!api?.getPathForFile || !api.stat) return;
  const files = ev.dataTransfer?.files;
  if (!files?.length) return;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    let fsPath: string;
    try {
      fsPath = api.getPathForFile(file);
    } catch {
      continue;
    }
    try {
      const st = await api.stat(fsPath);
      if (props.isDirectory) {
        if (st.isDirectory) {
          setPath(fsPath);
          return;
        }
      } else if (st.isFile) {
        setPath(fsPath);
        return;
      }
    } catch {
      continue;
    }
  }
}

async function onBrowse() {
  if (props.disabled) return;
  const api = window.colorTxt;
  if (!api?.showOpenDialog) return;
  const options: ColorTxtOpenDialogOptions = props.isDirectory
    ? { properties: ["openDirectory"] }
    : { properties: ["openFile"] };
  if (!props.isDirectory && props.filters?.length) {
    options.filters = props.filters;
  }
  const r = await api.showOpenDialog(options);
  const p =
    r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
  if (p) setPath(p);
}

function onInput(ev: Event) {
  if (props.inputReadonly || props.disabled) return;
  const t = ev.target as HTMLInputElement | null;
  setPath(t?.value ?? "");
}
</script>

<template>
  <div
    class="pathPicker"
    :class="{ 'pathPicker--disabled': disabled }"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <input
      class="pathPicker__input"
      :class="{ 'pathPicker__input--dragOver': isDragOver }"
      type="text"
      :value="modelValue"
      :readonly="inputReadonly"
      :disabled="disabled"
      :placeholder="placeholder"
      :aria-label="inputAria"
      @input="onInput"
    />
    <button
      type="button"
      class="btn primary pathPicker__btn"
      :disabled="disabled"
      :aria-label="isDirectory ? '选择目录' : '选择文件'"
      :title="isDirectory ? '选择目录' : '选择文件'"
      @click="onBrowse"
    >
      <span
        class="pathPicker__icon"
        aria-hidden="true"
        v-html="icons.folderOpen"
      />
    </button>
  </div>
</template>

<style scoped>
.pathPicker {
  display: flex;
  align-items: stretch;
  flex: 1 1 160px;
  min-width: 0;
}

.pathPicker--disabled {
  opacity: 0.65;
  pointer-events: none;
}

.pathPicker__input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px 0 0 4px;
  font-size: 12px;
  background: var(--input-bg);
  color: var(--fg);
  transition:
    background 0.12s ease,
    border-color 0.12s ease;
}

.pathPicker__input--dragOver {
  background: var(--primary-bg);
  border-color: var(--accent);
}

.pathPicker__btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  min-width: 36px;
  padding: 0;
  box-sizing: border-box;
  border-radius: 0 4px 4px 0;
}

.pathPicker__icon {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.pathPicker__icon :deep(svg) {
  width: 20px;
  height: 20px;
  display: block;
}

.pathPicker__icon :deep(svg path) {
  fill: currentColor;
}
</style>
