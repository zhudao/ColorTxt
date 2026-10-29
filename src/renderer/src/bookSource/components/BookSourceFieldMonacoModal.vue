<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from "vue";
import type * as Monaco from "monaco-editor";
import AppModal from "../../components/AppModal.vue";
import AppContextMenu from "../../components/AppContextMenu.vue";
import IconButton from "../../components/IconButton.vue";
import { icons } from "../../icons";
import { appConfirm } from "../../services/appDialog";
import { appToast } from "../../services/appToast";
import {
  formatBookSourceFieldText,
  type BookSourceMonacoLanguage,
} from "../formatBookSourceFieldText";
import { ensureMonacoWorkerFallback } from "../../monaco/ensureMonacoWorkerFallback";
import { READER_UNICODE_HIGHLIGHT_DISABLED } from "../../monaco/readerEditorOptions";
import { ensureBookSourceMonacoLibs } from "../monaco/ensureBookSourceMonacoLibs";
import {
  applyBookSourceCodeTheme,
  restoreReaderMonacoTheme,
} from "../monaco/bookSourceMonacoTheme";

const props = withDefaults(
  defineProps<{
    title?: string;
    language?: BookSourceMonacoLanguage;
    /** 打开时灌入编辑器的初始文本 */
    initialText?: string;
  }>(),
  {
    title: "编辑器",
    language: "javascript",
    initialText: "",
  },
);

const emit = defineEmits<{
  confirm: [text: string];
}>();

const open = defineModel<boolean>({ default: false });

const hostRef = ref<HTMLElement | null>(null);
const editor = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
const model = shallowRef<Monaco.editor.ITextModel | null>(null);
let monacoApi: typeof Monaco | null = null;
let baselineText = "";
let closeConfirmPending = false;
let creating = false;

const ctxOpen = ref(false);
const ctxX = ref(0);
const ctxY = ref(0);
const ctxHasSelection = ref(false);

const ctxItems = computed(() => [
  { id: "cut", label: "剪切", disabled: !ctxHasSelection.value },
  { id: "copy", label: "复制", disabled: !ctxHasSelection.value },
  { id: "paste", label: "粘贴" },
  { id: "sep-format", separator: true },
  { id: "format", label: "格式化" },
]);

function isDarkTheme(): boolean {
  return document.documentElement.classList.contains("dark");
}

function getEditorText(): string {
  return model.value?.getValue() ?? editor.value?.getValue() ?? "";
}

function isDirty(): boolean {
  return getEditorText() !== baselineText;
}

async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!isDirty()) return true;
  if (closeConfirmPending) return false;
  closeConfirmPending = true;
  try {
    return await appConfirm(
      "当前内容已修改但尚未保存，确定要放弃这些改动吗？",
      "修改未保存",
    );
  } finally {
    closeConfirmPending = false;
  }
}

async function requestClose() {
  if (!(await confirmDiscardIfDirty())) return;
  open.value = false;
}

function onConfirm() {
  emit("confirm", getEditorText());
  baselineText = getEditorText();
  open.value = false;
}

function monacoPositionAfterPaste(
  monaco: typeof Monaco,
  start: Monaco.Position,
  text: string,
): Monaco.Position {
  const lines = text.replace(/\r\n|\r/g, "\n").split("\n");
  if (lines.length === 1) {
    return new monaco.Position(
      start.lineNumber,
      start.column + (lines[0]?.length ?? 0),
    );
  }
  return new monaco.Position(
    start.lineNumber + lines.length - 1,
    (lines[lines.length - 1]?.length ?? 0) + 1,
  );
}

async function pasteClipboardIntoEditor(
  monaco: typeof Monaco,
  e: Monaco.editor.IStandaloneCodeEditor,
): Promise<void> {
  await nextTick();
  e.focus();
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return;
  }
  if (!text) return;
  const m = e.getModel();
  const sel = e.getSelection();
  if (!m || !sel) return;
  const anchor = sel.getStartPosition();
  e.pushUndoStop();
  const ok = e.executeEdits("book-source-monaco-paste", [
    { range: sel, text, forceMoveMarkers: true },
  ]);
  if (!ok) return;
  e.pushUndoStop();
  const end = monacoPositionAfterPaste(monaco, anchor, text);
  e.setSelection(monaco.Selection.fromPositions(end, end));
}

function applyFormat() {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return;
  const raw = m.getValue();
  const result = formatBookSourceFieldText(raw, props.language);
  if (!result.ok) {
    appToast(result.message, { kind: "warning" });
    return;
  }
  if (result.text === raw) {
    appToast("已是格式化结果", { kind: "info", duration: 1200 });
    return;
  }
  const full = m.getFullModelRange();
  e.pushUndoStop();
  e.executeEdits("book-source-monaco-format", [
    { range: full, text: result.text, forceMoveMarkers: true },
  ]);
  e.pushUndoStop();
}

function onCtxSelect(id: string) {
  ctxOpen.value = false;
  const e = editor.value;
  const monaco = monacoApi;
  if (!e || !monaco) return;
  if (id === "cut") {
    e.focus();
    e.trigger("keyboard", "editor.action.clipboardCutAction", null);
    return;
  }
  if (id === "copy") {
    e.focus();
    e.trigger("keyboard", "editor.action.clipboardCopyAction", null);
    return;
  }
  if (id === "paste") {
    void pasteClipboardIntoEditor(monaco, e);
    return;
  }
  if (id === "format") {
    applyFormat();
  }
}

function disposeEditor() {
  editor.value?.dispose();
  editor.value = null;
  model.value?.dispose();
  model.value = null;
}

function restoreThemeAfterClose() {
  const monaco = monacoApi;
  if (!monaco) return;
  restoreReaderMonacoTheme(monaco, isDarkTheme());
}

async function mountEditor() {
  if (creating || !open.value) return;
  creating = true;
  try {
    await nextTick();
    const host = hostRef.value;
    if (!host) return;

    disposeEditor();

    ensureMonacoWorkerFallback();
    const monaco = await import("monaco-editor");
    monacoApi = monaco;

    // 独立主题，勿 setTheme(vs) 以免冲掉阅读器 txtr-reader（背景/上色全局失效）
    applyBookSourceCodeTheme(monaco, isDarkTheme());

    // 书源 JS 含 java./result 等非标准写法；规则 DSL 更非 JS。关闭校验避免红波浪线误报。
    // monaco 0.55：API 在顶层 `typescript` 命名空间（languages.typescript 已弃用）
    const tsLang = (
      monaco as unknown as {
        typescript: {
          javascriptDefaults: {
            setDiagnosticsOptions: (o: Record<string, boolean>) => void;
          };
          typescriptDefaults: {
            setDiagnosticsOptions: (o: Record<string, boolean>) => void;
          };
        };
      }
    ).typescript;
    const diagOff = {
      noSemanticValidation: true,
      noSyntaxValidation: true,
      noSuggestionDiagnostics: true,
    };
    tsLang.javascriptDefaults.setDiagnosticsOptions(diagOff);
    tsLang.typescriptDefaults.setDiagnosticsOptions(diagOff);

    const isJs = props.language === "javascript";
    if (isJs) {
      ensureBookSourceMonacoLibs(monaco);
    }

    const m = monaco.editor.createModel(props.initialText ?? "", props.language);
    model.value = m;
    baselineText = m.getValue();

    const e = monaco.editor.create(host, {
      model: m,
      automaticLayout: true,
      wordWrap: "on",
      minimap: { enabled: false },
      fontSize: 14,
      lineHeight: 22,
      tabSize: 2,
      insertSpaces: true,
      contextmenu: false,
      scrollBeyondLastLine: false,
      renderLineHighlight: "line",
      folding: true,
      unicodeHighlight: { ...READER_UNICODE_HIGHLIGHT_DISABLED },
      // JS：开启 hover 以展示运行时 API 文档；诊断仍关
      hover: { enabled: isJs },
      suggest: { showWords: true },
      quickSuggestions: isJs,
      parameterHints: { enabled: isJs },
      find: {
        addExtraSpaceOnTop: false,
        autoFindInSelection: "never",
      },
    });
    editor.value = e;

    e.onContextMenu((ev) => {
      ev.event.preventDefault();
      ev.event.stopPropagation();
      const sel = e.getSelection();
      ctxHasSelection.value = Boolean(sel && !sel.isEmpty());
      const be = ev.event.browserEvent;
      ctxX.value = be.clientX;
      ctxY.value = be.clientY;
      ctxOpen.value = true;
    });

    e.focus();
  } finally {
    creating = false;
  }
}

watch(open, (isOpen) => {
  ctxOpen.value = false;
  if (isOpen) {
    void mountEditor();
  } else {
    disposeEditor();
    restoreThemeAfterClose();
    monacoApi = null;
  }
});

onBeforeUnmount(() => {
  disposeEditor();
  restoreThemeAfterClose();
  monacoApi = null;
});
</script>

<template>
  <AppModal
    v-model="open"
    :title="title"
    fullscreen
    panel-class="bookSourceFieldMonacoModal"
    :mask-closable="false"
    :esc-closable="false"
    :show-close-button="false"
    :body-scroll="false"
    :before-close="confirmDiscardIfDirty"
  >
    <template #headerPrefix>
      <IconButton
        :icon-html="icons.back"
        title="返回"
        aria-label="返回"
        @click="requestClose"
      />
    </template>
    <template #headerActions>
      <IconButton
        :icon-html="icons.ok"
        title="确定"
        aria-label="确定"
        @click="onConfirm"
      />
    </template>

    <div class="monacoShell">
      <div ref="hostRef" class="monacoHost" />
    </div>
  </AppModal>

  <AppContextMenu
    :open="ctxOpen"
    :x="ctxX"
    :y="ctxY"
    :items="ctxItems"
    :min-width="140"
    @close="ctxOpen = false"
    @select="onCtxSelect"
  />
</template>

<style>
.bookSourceFieldMonacoModal {
  overflow: hidden;
}
.bookSourceFieldMonacoModal .appModalBody {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 0;
}
/* 与全屏顶栏 padding:10px 对齐，避免「确定」贴右边缘 */
.bookSourceFieldMonacoModal .appModalHeaderEnd {
  right: 10px;
}
.bookSourceFieldMonacoModal .appModalHeaderActions {
  padding-right: 0;
}
</style>

<style scoped>
.monacoShell {
  display: flex;
  flex: 1;
  min-height: 0;
  width: 100%;
  background: var(--input-bg, var(--panel, #fff));
}
.monacoHost {
  /* 须为定位含块：查找栏 tip 经 ContextView 以 absolute 挂在此节点上，
     若冒泡到 AppModal 面板（含顶栏），会按视口坐标减去 host 顶边而整体偏上。 */
  position: relative;
  flex: 1;
  min-height: 0;
  width: 100%;
}
</style>
