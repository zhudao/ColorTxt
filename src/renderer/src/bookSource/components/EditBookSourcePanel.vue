<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import AppModal from "../../components/AppModal.vue";
import AppTabBar from "../../components/AppTabBar.vue";
import AppShellMenuTeleport from "../../components/AppShellMenuTeleport.vue";
import AutoResizeTextarea from "../../components/AutoResizeTextarea.vue";
import HighlightedCodeTextarea from "../../components/HighlightedCodeTextarea.vue";
import IconButton from "../../components/IconButton.vue";
import SwitchToggle from "../../components/SwitchToggle.vue";
import { useAnchoredAppShellMenu } from "../../composables/useAnchoredAppShellMenu";
import { icons } from "../../icons";
import { appConfirm, appPrompt } from "../../services/appDialog";
import { appToast } from "../../services/appToast";
import { useBookSourceApi } from "../composables/useBookSource";
import type { BookSourceRecord } from "@shared/bookSource/types";
import { parseBookSourceJson } from "@shared/bookSource/types";
import {
  BOOK_SOURCE_BASIC_FIELDS,
  BOOK_SOURCE_CONTENT_FIELDS,
  BOOK_SOURCE_DETAIL_FIELDS,
  BOOK_SOURCE_EXPLORE_FIELDS,
  BOOK_SOURCE_SEARCH_FIELDS,
  BOOK_SOURCE_TABS,
  BOOK_SOURCE_TOC_FIELDS,
  EDIT_BOOK_SOURCE_TEXTAREA_MAX_HEIGHT_PX,
  type BookSourceEditTab,
  type BookSourceFieldDef,
} from "../editBookSourceFields";
import { bookSourceFieldUsesHighlight } from "../highlightBookSourceCode";
import {
  bookSourceFieldMonacoLanguage,
  type BookSourceMonacoLanguage,
} from "../formatBookSourceFieldText";
import { newEmptyBookSource } from "../composables/useBookSource";
import BookSourceLoginPanel from "./BookSourceLoginPanel.vue";
import BookSourceFieldMonacoModal from "./BookSourceFieldMonacoModal.vue";

const props = withDefaults(
  defineProps<{
    sourceUrl?: string | null;
    draftSource?: BookSourceRecord;
    initialTab?: BookSourceEditTab;
    /** 为 true 时仅回传草稿，不写入书源库（导入预览编辑） */
    draftOnly?: boolean;
  }>(),
  { draftOnly: false },
);

const emit = defineEmits<{
  done: [source: BookSourceRecord];
  /** 限定该书源搜索（书源 URL + 显示名） */
  searchSource: [
    item: { bookSourceUrl: string; bookSourceName: string },
  ];
}>();

const modelValue = defineModel<boolean>({ default: false });
const { getSource, saveSource } = useBookSourceApi();

const isCreate = computed(
  () => !props.sourceUrl && !props.draftSource?.bookSourceUrl,
);
const panelTitle = computed(() => (isCreate.value ? "新建书源" : "编辑书源"));

const activeTab = ref<BookSourceEditTab>("basic");
const editFieldsRef = ref<HTMLElement | null>(null);
const draft = ref<BookSourceRecord>(newEmptyBookSource());
/** 打开/加载完成后的快照，用于判断是否有未保存改动 */
const baselineJson = ref("");
const saving = ref(false);
const showLogin = ref(false);
const loginSource = ref<BookSourceRecord | null>(null);
/** 关闭确认进行中，避免 Esc/×/取消 连点重复弹框 */
let closeConfirmPending = false;

const monacoOpen = ref(false);
const monacoTitle = ref("编辑器");
const monacoLanguage = ref<BookSourceMonacoLanguage>("javascript");
const monacoInitialText = ref("");
const monacoField = ref<BookSourceFieldDef | null>(null);

const moreBtnRef = ref<HTMLElement | null>(null);
const moreMenu = useAnchoredAppShellMenu({
  anchor: moreBtnRef,
  placement: "below-end",
  widthPx: 160,
});
const {
  open: moreOpen,
  left: moreLeft,
  top: moreTop,
  toggleMenu: toggleMoreMenu,
  closeMenu: closeMoreMenu,
  panelRef: morePanelRef,
} = moreMenu;

function bindMorePanel(el: HTMLElement | null) {
  morePanelRef.value = el;
}

const effectiveSourceUrl = computed(
  () =>
    draft.value.bookSourceUrl?.trim() ||
    props.sourceUrl?.trim() ||
    props.draftSource?.bookSourceUrl?.trim() ||
    "",
);

/** 对齐书源列表 hasLoginUrl：有 loginUrl 才显示「登录」 */
const showLoginMenuItem = computed(() =>
  Boolean(draft.value.loginUrl?.trim()),
);

const fieldsForTab = computed((): BookSourceFieldDef[] => {
  switch (activeTab.value) {
    case "basic":
      return BOOK_SOURCE_BASIC_FIELDS;
    case "search":
      return BOOK_SOURCE_SEARCH_FIELDS;
    case "explore":
      return BOOK_SOURCE_EXPLORE_FIELDS;
    case "detail":
      return BOOK_SOURCE_DETAIL_FIELDS;
    case "toc":
      return BOOK_SOURCE_TOC_FIELDS;
    case "content":
      return BOOK_SOURCE_CONTENT_FIELDS;
    default:
      return [];
  }
});

async function loadDraft() {
  if (props.draftSource) {
    draft.value = JSON.parse(JSON.stringify(props.draftSource));
  } else if (props.sourceUrl) {
    const s = await getSource(props.sourceUrl);
    draft.value = s ? JSON.parse(JSON.stringify(s)) : newEmptyBookSource();
  } else {
    draft.value = newEmptyBookSource();
  }
  baselineJson.value = JSON.stringify(draft.value);
}

function isDraftDirty(): boolean {
  return JSON.stringify(draft.value) !== baselineJson.value;
}

async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!isDraftDirty()) return true;
  if (closeConfirmPending) return false;
  closeConfirmPending = true;
  try {
    return await appConfirm(
      "当前书源已修改但尚未保存，确定要放弃这些改动吗？",
      "修改未保存",
    );
  } finally {
    closeConfirmPending = false;
  }
}

async function requestClose() {
  if (!(await confirmDiscardIfDirty())) return;
  modelValue.value = false;
}

watch(modelValue, (open) => {
  if (open) {
    activeTab.value = props.initialTab ?? "basic";
    void loadDraft();
  } else {
    closeMoreMenu();
    showLogin.value = false;
    loginSource.value = null;
  }
});

watch(activeTab, () => {
  nextTick(() => {
    editFieldsRef.value?.scrollTo({ top: 0 });
  });
});

function getFieldValue(field: BookSourceFieldDef): string {
  if (field.key === "searchUrl") {
    return draft.value.searchUrl ?? "";
  }
  if (!field.rulePath) {
    const v = (draft.value as Record<string, unknown>)[field.key];
    return typeof v === "string" ? v : v == null ? "" : String(v);
  }
  const block = (draft.value as unknown as Record<string, Record<string, string> | undefined>)[
    field.rulePath
  ];
  return block?.[field.key] ?? "";
}

function setFieldValue(field: BookSourceFieldDef, value: string) {
  if (field.key === "searchUrl") {
    draft.value.searchUrl = value;
    return;
  }
  if (!field.rulePath) {
    (draft.value as Record<string, unknown>)[field.key] = value;
    return;
  }
  const path = field.rulePath as keyof BookSourceRecord;
  const block = {
    ...((draft.value[path] as Record<string, string> | undefined) ?? {}),
  };
  block[field.key] = value;
  (draft.value as Record<string, unknown>)[field.rulePath] = block;
}

function openFieldMonaco(field: BookSourceFieldDef) {
  monacoField.value = field;
  monacoLanguage.value = bookSourceFieldMonacoLanguage(field.key);
  monacoInitialText.value = getFieldValue(field);
  const keyPart =
    field.label !== field.key ? `（${field.key}）` : "";
  monacoTitle.value = `${field.label}${keyPart}`;
  monacoOpen.value = true;
}

function onMonacoConfirm(text: string) {
  const field = monacoField.value;
  if (field) setFieldValue(field, text);
  monacoField.value = null;
}

async function onSave() {
  saving.value = true;
  try {
    draft.value.lastUpdateTime = Date.now();
    draft.value.bookSourceType = 0;
    const saved = JSON.parse(JSON.stringify(draft.value)) as BookSourceRecord;
    if (!props.draftOnly) {
      await saveSource(saved);
    }
    baselineJson.value = JSON.stringify(saved);
    modelValue.value = false;
    emit("done", saved);
  } finally {
    saving.value = false;
  }
}

function formatVariableComment(
  sourceComment: string | undefined,
  fallback: string,
): string {
  const c = sourceComment?.trim();
  return c ? `${c}\n${fallback}` : fallback;
}

async function onLogin() {
  closeMoreMenu();
  const url = effectiveSourceUrl.value;
  if (!url) {
    appToast("请先填写书源 URL", { kind: "warning" });
    return;
  }
  if (!draft.value.loginUrl?.trim()) {
    appToast("此书源未配置登录", { kind: "warning" });
    return;
  }
  // 用当前草稿（含未保存的 loginUrl / loginUi），对齐 Legado SourceLoginActivity
  const source: BookSourceRecord = {
    ...draft.value,
    bookSourceUrl: url,
  };
  if (!source.loginUi?.trim()) {
    const r = await window.colorTxt.bookSourceBrowserLogin(
      source.bookSourceUrl,
      `登录 · ${source.bookSourceName}`,
    );
    if (r.ok) appToast("Cookie 已保存", { kind: "info" });
    else if (!r.cancelled && r.message) appToast(r.message, { kind: "warning" });
    return;
  }
  loginSource.value = source;
  showLogin.value = true;
}

async function onSearchSource() {
  closeMoreMenu();
  if (props.draftOnly) {
    appToast("请先导入书源后再搜索", { kind: "warning" });
    return;
  }
  const url = draft.value.bookSourceUrl?.trim();
  if (!url) {
    appToast("请先填写书源 URL", { kind: "warning" });
    return;
  }
  if (!draft.value.bookSourceName?.trim()) {
    appToast("请先填写书源名称", { kind: "warning" });
    return;
  }
  // 搜索前先落盘当前草稿，避免未保存的规则改动未生效
  saving.value = true;
  try {
    draft.value.lastUpdateTime = Date.now();
    draft.value.bookSourceType = 0;
    draft.value.bookSourceUrl = url;
    const saved = JSON.parse(JSON.stringify(draft.value)) as BookSourceRecord;
    const r = await saveSource(saved);
    if (r && typeof r === "object" && "ok" in r && !r.ok) {
      appToast(
        (r as { message?: string }).message || "保存书源失败",
        { kind: "warning" },
      );
      return;
    }
    baselineJson.value = JSON.stringify(saved);
    modelValue.value = false;
    emit("done", saved);
    emit("searchSource", {
      bookSourceUrl: saved.bookSourceUrl,
      bookSourceName: saved.bookSourceName || url,
    });
  } catch (e) {
    appToast(e instanceof Error ? e.message : "保存书源失败", {
      kind: "warning",
    });
  } finally {
    saving.value = false;
  }
}

async function onClearCookie() {
  closeMoreMenu();
  const url = effectiveSourceUrl.value;
  if (!url) {
    appToast("请先填写书源 URL", { kind: "warning" });
    return;
  }
  const r = await window.colorTxt.bookSourceClearCookie(url);
  if (!r.ok) {
    appToast(r.message || "清除 Cookie 失败", { kind: "warning" });
    return;
  }
  appToast("已清除 Cookie", { kind: "success", duration: 1200 });
}

/** 对齐 Legado「拷贝源」：当前草稿 JSON 写入剪贴板 */
async function onCopySource() {
  closeMoreMenu();
  try {
    await navigator.clipboard.writeText(JSON.stringify(draft.value, null, 2));
    appToast("已复制书源", { kind: "success", duration: 1200 });
  } catch {
    appToast("复制书源失败", { kind: "warning" });
  }
}

/** 对齐 Legado「粘贴源」：从剪贴板解析书源填入表单（须点确定才保存） */
async function onPasteSource() {
  closeMoreMenu();
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {
    appToast("读取剪贴板失败", { kind: "warning" });
    return;
  }
  const sources = parseBookSourceJson(text);
  if (!sources.length) {
    appToast("剪贴板中没有有效书源（需含 bookSourceUrl / bookSourceName）", {
      kind: "warning",
    });
    return;
  }
  draft.value = JSON.parse(JSON.stringify(sources[0]!)) as BookSourceRecord;
  appToast("已粘贴书源", { kind: "success", duration: 1200 });
}

async function onSetSourceVariable() {
  closeMoreMenu();
  const url = effectiveSourceUrl.value;
  if (!url) {
    appToast("请先填写书源 URL", { kind: "warning" });
    return;
  }
  const current = await window.colorTxt.bookSourceGetSourceVariable(url);
  const comment = formatVariableComment(
    draft.value.variableComment,
    "源变量可在 js 中通过 <code>source.getVariable()</code> 获取",
  );
  const next = await appPrompt(comment, {
    title: "设置源变量",
    defaultValue: current,
    multiline: true,
    dangerouslyUseHTMLString: true,
  });
  if (next == null) return;
  await window.colorTxt.bookSourceSetSourceVariable(url, next);
  appToast("源变量已保存", { kind: "success", duration: 1200 });
}
</script>

<template>
  <AppModal
    v-model="modelValue"
    :title="panelTitle"
    inset="20"
    panel-class="editBookSourcePanel"
    :mask-closable="false"
    :esc-closable="true"
    :body-scroll="false"
    :before-close="confirmDiscardIfDirty"
  >
    <div class="editShell">
      <div class="editTabRow">
        <AppTabBar
          v-model:active-tab="activeTab"
          class="editTabBar"
          :tabs="BOOK_SOURCE_TABS"
          aria-label="书源规则分类"
        />
        <div ref="moreBtnRef" class="editMoreWrap">
          <IconButton
            :icon-html="icons.more"
            :active="moreOpen"
            :pressed="moreOpen"
            title="更多"
            aria-label="更多"
            aria-haspopup="menu"
            :aria-expanded="moreOpen"
            @click="toggleMoreMenu"
          />
        </div>
      </div>

      <AppShellMenuTeleport
        v-model:open="moreOpen"
        :left="moreLeft"
        :top="moreTop"
        :on-panel-mount="bindMorePanel"
      >
        <button
          v-if="showLoginMenuItem"
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          :disabled="!effectiveSourceUrl"
          @click="onLogin"
        >
          <span class="appShellMenuLabel">登录</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          :disabled="!effectiveSourceUrl"
          @click="onSearchSource"
        >
          <span class="appShellMenuLabel">搜索</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem appShellMenuItem--warning"
          role="menuitem"
          :disabled="!effectiveSourceUrl"
          @click="onClearCookie"
        >
          <span class="appShellMenuLabel">清除 Cookie</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onCopySource"
        >
          <span class="appShellMenuLabel">复制源</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="onPasteSource"
        >
          <span class="appShellMenuLabel">粘贴源</span>
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          :disabled="!effectiveSourceUrl"
          @click="onSetSourceVariable"
        >
          <span class="appShellMenuLabel">设置源变量</span>
        </button>
      </AppShellMenuTeleport>

      <BookSourceLoginPanel v-model="showLogin" :source="loginSource" />

      <BookSourceFieldMonacoModal
        v-model="monacoOpen"
        :title="monacoTitle"
        :language="monacoLanguage"
        :initial-text="monacoInitialText"
        @confirm="onMonacoConfirm"
      />

      <div ref="editFieldsRef" class="editFields">
        <div
          v-for="field in fieldsForTab"
          :key="`${field.rulePath ?? ''}-${field.key}`"
          class="editField"
        >
          <div class="editFieldLabel">
            <span class="editFieldLabelTitle">{{ field.label }}</span>
            <span v-if="field.label !== field.key" class="editFieldLabelKey"
              >（{{ field.key }}）</span
            >
            <IconButton
              v-if="bookSourceFieldUsesHighlight(field.key)"
              class="editFieldMonacoBtn"
              :icon-html="icons.sourceCode"
              title="编辑器"
              aria-label="编辑器"
              @click.stop="openFieldMonaco(field)"
            />
          </div>
          <HighlightedCodeTextarea
            v-if="bookSourceFieldUsesHighlight(field.key)"
            class="editFieldInput"
            :max-height="EDIT_BOOK_SOURCE_TEXTAREA_MAX_HEIGHT_PX"
            :model-value="getFieldValue(field)"
            @update:model-value="setFieldValue(field, $event)"
          />
          <AutoResizeTextarea
            v-else
            class="editFieldInput"
            :max-height="EDIT_BOOK_SOURCE_TEXTAREA_MAX_HEIGHT_PX"
            :model-value="getFieldValue(field)"
            @update:model-value="setFieldValue(field, $event)"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="editFooter">
        <div class="editFooterToggles">
          <label class="editFooterCheck">
            启用
            <SwitchToggle v-model="draft.enabled" aria-label="启用" />
          </label>
          <label class="editFooterCheck">
            发现
            <SwitchToggle v-model="draft.enabledExplore" aria-label="发现" />
          </label>
          <label class="editFooterCheck">
            CookieJar
            <SwitchToggle v-model="draft.enabledCookieJar" aria-label="CookieJar" />
          </label>
        </div>
        <div class="editFooterActions">
          <button type="button" class="btn" size="large" @click="requestClose">取消</button>
          <button type="button" class="btn primary" size="large" :disabled="saving" @click="onSave">
            确定
          </button>
        </div>
      </div>
    </template>
  </AppModal>
</template>

<style>
.editBookSourcePanel {
  overflow: hidden;
}
.editBookSourcePanel .appModalBody {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>

<style scoped>
.editShell {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.editTabRow {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  min-width: 0;
}
.editTabBar {
  flex: 1;
  min-width: 0;
}
.editTabRow :deep(.appTabBar) {
  border-bottom: none;
  margin-bottom: 0;
}
.editMoreWrap {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 4px 0 2px;
}
.editFields {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px 10px;
}
.editField {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.editFieldLabel {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 12px;
  line-height: 1.4;
  width: 100%;
}
.editFieldLabelTitle {
  font-weight: 600;
  color: var(--fg);
}
.editFieldLabelKey {
  font-weight: 400;
  color: var(--muted);
}
.editFieldMonacoBtn {
  flex-shrink: 0;
  margin-left: auto;
}
.editFieldInput {
  width: 100%;
}
.editFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-width: 0;
}
.editFooterToggles {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.editFooterCheck {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  white-space: nowrap;
}
.editFooterActions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}
</style>
