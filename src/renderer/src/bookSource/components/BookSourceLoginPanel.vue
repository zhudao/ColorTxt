<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppModal from "../../components/AppModal.vue";
import IconButton from "../../components/IconButton.vue";
import AppShellMenuTeleport from "../../components/AppShellMenuTeleport.vue";
import { useAnchoredAppShellMenu } from "../../composables/useAnchoredAppShellMenu";
import { icons } from "../../icons";
import type { BookSourceRecord } from "@shared/bookSource/types";
import {
  collectLoginFormData,
  loginUiNeedsEval,
  parseLoginUi,
  type LoginUiRow,
} from "@shared/bookSource/loginUi";
import { appAlert, appConfirm, appLog } from "../../services/appDialog";
import { appToast } from "../../services/appToast";
import LoadingDotsBounce from "../../components/LoadingDotsBounce.vue";

const props = defineProps<{
  source: BookSourceRecord | null;
}>();

const modelValue = defineModel<boolean>({ default: false });

const form = ref<Record<string, string>>({});
const loading = ref(false);
const rowsLoading = ref(false);
const lastLogs = ref<string[]>([]);
const evaluatedRows = ref<LoginUiRow[]>([]);

const menuBtnRef = ref<HTMLElement | null>(null);
const menu = useAnchoredAppShellMenu({
  anchor: menuBtnRef,
  placement: "below-end",
  widthPx: 200,
});
const {
  open: menuOpen,
  left: menuLeft,
  top: menuTop,
  toggleMenu: toggleMenu,
  closeMenu: closeMenu,
  panelRef: menuPanelRef,
} = menu;

function bindMenuPanel(el: HTMLElement | null) {
  menuPanelRef.value = el;
}

// @js:/<js> 的 loginUi 需主进程求值（见 evaluatedRows）；纯 JSON 直接静态解析
const rows = computed((): LoginUiRow[] =>
  loginUiNeedsEval(props.source?.loginUi)
    ? evaluatedRows.value
    : parseLoginUi(props.source?.loginUi),
);
const hasLoginUi = computed(() => Boolean(props.source?.loginUi?.trim()));
const hasLoginUrl = computed(() => Boolean(props.source?.loginUrl?.trim()));

const formData = computed(() => collectLoginFormData(rows.value, form.value));

watch(
  () => [modelValue.value, props.source?.bookSourceUrl] as const,
  async ([open]) => {
    if (!open || !props.source) return;
    const source = props.source;
    form.value = await window.colorTxt.bookSourceGetLoginInfo(
      source.bookSourceUrl,
    );
    lastLogs.value = [];
    evaluatedRows.value = [];
    closeMenu();
    if (loginUiNeedsEval(source.loginUi)) {
      rowsLoading.value = true;
      try {
        const r = await window.colorTxt.bookSourceGetLoginUi(
          source.bookSourceUrl,
        );
        // 组件可能已切换书源/关闭，避免覆盖新状态
        if (props.source?.bookSourceUrl !== source.bookSourceUrl) return;
        evaluatedRows.value = r.rows ?? [];
        if (r.logs?.length) lastLogs.value = r.logs;
        if (r.message) appToast(r.message, { kind: "danger" });
      } finally {
        rowsLoading.value = false;
      }
    }
    // toggle/select 默认值填入 form，供显示与提交
    for (const row of rows.value) {
      if (
        (row.type === "toggle" || row.type === "select") &&
        form.value[row.name] == null
      ) {
        form.value[row.name] =
          row.default ?? row.chars?.[0] ?? "";
      }
    }
  },
);

/** toggle：点击循环到下一候选值并执行 action（对齐 Legado SourceLoginDialog toggle） */
function onToggle(row: LoginUiRow) {
  const chars = row.chars ?? [];
  if (chars.length === 0) return;
  const cur = form.value[row.name] ?? row.default ?? chars[0]!;
  const nextIdx = (chars.indexOf(cur) + 1) % chars.length;
  form.value[row.name] = chars[nextIdx]!;
  if (row.action?.trim()) void runLogin({ buttonAction: row.action });
}

function toggleLabel(row: LoginUiRow): string {
  const cur = form.value[row.name] ?? row.default ?? row.chars?.[0] ?? "";
  const left = row.style?.layout_justifySelf !== "right";
  const name = row.name.trim();
  return left ? `${cur}${name}` : `${name}${cur}`;
}

function feedbackFromLogs(logs: string[], options?: { silentErrors?: boolean }) {
  lastLogs.value = logs;
  // java.toast 已由 AppToastHost 经 IPC 弹出；此处仅补错误类日志提示。
  // loginUi 按钮对齐 Legado handleButtonClick：JS 错误只记日志（「更多 → 日志」可查），不弹错
  if (options?.silentErrors) return;
  const errLine = [...logs]
    .reverse()
    .find((l) => l.startsWith("JS 错误:") || l.startsWith("loginCheckJs 错误:"));
  if (errLine) appToast(errLine, { kind: "danger" });
}

async function runLogin(options?: { buttonAction?: string }) {
  const source = props.source;
  if (!source) return;
  loading.value = true;
  try {
    const r = await window.colorTxt.bookSourceLogin(
      source.bookSourceUrl,
      { ...formData.value },
      options,
    );
    if (r.logs?.length) {
      feedbackFromLogs(r.logs, { silentErrors: Boolean(options?.buttonAction) });
    }
    if (r.ok) {
      if (!options?.buttonAction) {
        appToast("已保存登录信息", { kind: "success" });
        modelValue.value = false;
      }
    } else {
      appToast(r.message ?? "操作失败", { kind: "danger" });
    }
  } finally {
    loading.value = false;
  }
}

function onSubmit() {
  void runLogin();
}

function onButton(row: LoginUiRow) {
  if (!row.action?.trim()) return;
  void runLogin({ buttonAction: row.action });
}

async function onShowLoginHeader() {
  const source = props.source;
  if (!source) return;
  closeMenu();
  const header = await window.colorTxt.bookSourceGetLoginHeader(
    source.bookSourceUrl,
  );
  await appAlert(header.trim() || "（无登录头）");
}

async function onRemoveLoginHeader() {
  const source = props.source;
  if (!source) return;
  closeMenu();
  const ok = await appConfirm("删除此书源的登录头？");
  if (!ok) return;
  await window.colorTxt.bookSourceRemoveLoginHeader(source.bookSourceUrl);
  appToast("已删除登录头", { kind: "info" });
}

async function onShowLogs() {
  closeMenu();
  const text = lastLogs.value.length
    ? lastLogs.value.join("\n\n")
    : "（暂无日志）";
  await appLog(text);
}
</script>

<template>
  <AppModal
    v-model="modelValue"
    title=""
    :show-close-button="false"
    max-width="1000px"
    :mask-closable="true"
    :esc-closable="true"
    panel-class="bsLoginModal"
  >
    <template v-if="source" #headerPrefix>
      <div class="bsLoginHeaderRow">
        <div class="bsLoginHeaderTitles">
          <span class="bsLoginModalTitle">登录</span>
          <span class="bsLoginSourceName">{{ source.bookSourceName }}</span>
        </div>
        <div class="bsLoginToolbar">
          <IconButton
            v-if="hasLoginUrl || hasLoginUi"
            :icon-html="icons.ok"
            title="保存"
            aria-label="保存"
            :disabled="loading"
            @click="onSubmit"
          />
          <div ref="menuBtnRef" class="bsLoginMenuAnchor">
            <IconButton
              :icon-html="icons.more"
              title="更多"
              aria-label="更多"
              @click="toggleMenu"
            />
          </div>
        </div>
      </div>
    </template>

    <div v-if="source" class="bsLoginBody">
      <p v-if="!hasLoginUrl && !hasLoginUi" class="bsLoginHint">
        此书源未配置登录规则。
      </p>

      <p v-else-if="rowsLoading && rows.length === 0" class="bsLoginHint bsLoginLoading">
        正在加载登录选项<LoadingDotsBounce />
      </p>

      <template v-else>
        <div class="bsLoginFlex">
          <template v-for="(row, idx) in rows" :key="`${row.name}-${idx}`">
            <label
              v-if="row.type === 'text' || row.type === 'password'"
              class="bsLoginField bsLoginFlexFull"
            >
              <input
                v-model="form[row.name]"
                class="bsLoginInput"
                :type="row.type === 'password' ? 'password' : 'text'"
                :placeholder="row.name"
              />
            </label>
            <button
              v-else-if="row.type === 'button'"
              type="button"
              class="bsLoginChipBtn"
              :disabled="loading"
              @click="onButton(row)"
            >
              {{ row.name.trim() }}
            </button>
            <button
              v-else-if="row.type === 'toggle' || row.type === 'select'"
              type="button"
              class="bsLoginChipBtn"
              :disabled="loading"
              @click="onToggle(row)"
            >
              {{ toggleLabel(row) }}
            </button>
          </template>
        </div>
      </template>
    </div>

    <AppShellMenuTeleport
      v-model:open="menuOpen"
      :left="menuLeft"
      :top="menuTop"
      :width="200"
      aria-label="登录菜单"
      :on-panel-mount="bindMenuPanel"
    >
      <button type="button" class="appShellMenuItem" @click="onShowLoginHeader">
        显示登录头
      </button>
      <button type="button" class="appShellMenuItem" @click="onRemoveLoginHeader">
        删除登录头
      </button>
      <button type="button" class="appShellMenuItem" @click="onShowLogs">
        日志
      </button>
    </AppShellMenuTeleport>
  </AppModal>
</template>

<style>
.appModalPanel.bsLoginModal {
  width: auto;
}
.appModalPanel.bsLoginModal .appModalTitleCluster {
  flex: 1;
  min-width: 0;
}
.bsLoginHeaderRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: 1;
  min-width: 0;
  width: 100%;
}
.bsLoginHeaderTitles {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.bsLoginModalTitle {
  flex-shrink: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--fg);
}
.bsLoginSourceName {
  font-size: 18px;
  font-weight: 600;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bsLoginBody {
  display: flex;
  flex-direction: column;
  min-width: 320px;
  gap: 5px;
  margin-top: 8px;
}
.bsLoginToolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.bsLoginMenuAnchor {
  display: inline-flex;
}
.bsLoginFlex {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 6px;
  align-items: stretch;
}
.bsLoginFlexFull {
  flex: 1 1 100%;
  min-width: 0;
}
.bsLoginField {
  display: flex;
  flex-direction: column;
}
.bsLoginInput {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.12));
  background: var(--input-bg);
  color: var(--fg);
  font-size: 14px;
}
.bsLoginInput::placeholder {
  color: var(--text-muted, #888);
}
.bsLoginChipBtn {
  padding: 6px 18px;
  border-radius: 999px;
  border: none;
  background: color-mix(in srgb, var(--accent, #7c6cf0) 18%, transparent);
  color: var(--fg);
  font-size: 13px;
  cursor: pointer;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bsLoginChipBtn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent, #7c6cf0) 28%, transparent);
}
.bsLoginChipBtn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.bsLoginHint {
  font-size: 12px;
  color: var(--text-muted, #888);
  margin: 0;
  line-height: 1.5;
}
.bsLoginLoading {
  display: inline-flex;
  align-items: center;
  gap: 0.15em;
}
</style>
