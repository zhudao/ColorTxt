<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import AppModal from "./AppModal.vue";
import AppCheckbox from "./AppCheckbox.vue";
import AppCustomSelect, { type CustomSelectItem } from "./AppCustomSelect.vue";
import IconButton from "./IconButton.vue";
import LoadingDotsBounce from "./LoadingDotsBounce.vue";
import VirtualList from "./VirtualList.vue";
import { icons } from "../icons";
import { appToast } from "../services/appToast";
import { usePathListSelection } from "../composables/usePathListSelection";
import {
  buildWebDavAuth,
  type WebDavSettingsSlice,
} from "../utils/webDavAuth";
import {
  downloadMainConfig,
  uploadMainConfig,
} from "../utils/webDavMainSync";
import type { WebDavListEntry } from "@shared/webDavIpc";
import "../bookSource/bookSourceToolbar.css";

export type WebDavPackSortMode =
  | "uploadedAtAsc"
  | "uploadedAtDesc"
  | "nameAsc"
  | "nameDesc"
  | "sizeAsc"
  | "sizeDesc";

type PackRow = {
  /** 与 usePathListSelection 对齐：远端文件名 */
  path: string;
  name: string;
  size: number | null;
  lastModified: string | null;
  uploadedAtMs: number;
};

type RowDlState = "downloading" | "done";

const DEFAULT_SORT: WebDavPackSortMode = "uploadedAtDesc";
/** 对齐书源行高（min-height 50 + 底部分隔线） */
const ROW_STRIDE = 51;

const SORT_LABELS: Record<WebDavPackSortMode, string> = {
  uploadedAtAsc: "上传时间",
  uploadedAtDesc: "上传时间",
  nameAsc: "文件名",
  nameDesc: "文件名",
  sizeAsc: "文件大小",
  sizeDesc: "文件大小",
};

const SORT_MODES: WebDavPackSortMode[] = [
  "uploadedAtAsc",
  "uploadedAtDesc",
  "nameAsc",
  "nameDesc",
  "sizeAsc",
  "sizeDesc",
];

const modelValue = defineModel<boolean>({ default: false });

type WebDavImportPackOpts = {
  /** 不弹汇总 toast，且不显示「解包中」蒙层（密码/覆盖确认仍会弹出） */
  silent?: boolean;
  /** 跨多次调用延续的密码本 */
  passwordBook?: string[];
  skipOnDecryptFail?: boolean;
};

type WebDavImportPackResult = {
  imported: Array<{ packPath: string; openPath: string }>;
  okCount: number;
  skipCount: number;
  failCount: number;
  passwordBook: string[];
  skipOnDecryptFail: boolean;
};

const props = defineProps<{
  webDav: WebDavSettingsSlice;
  /** 导入本地书包路径；silent 时不弹 toast / 不解包蒙层，由调用方汇总后再提示 */
  importPackPaths: (
    paths: string[],
    opts?: WebDavImportPackOpts,
  ) => Promise<WebDavImportPackResult>;
}>();

const emit = defineEmits<{
  /** 配置已从远端写回 localStorage，请热重载设置 */
  configDownloaded: [];
  /** 打开已导入的书籍 */
  openFile: [path: string];
}>();

const loading = ref(false);
const configBusy = ref(false);
const entries = ref<WebDavListEntry[]>([]);
const listError = ref("");
const filterQuery = ref("");
const sortMode = ref<WebDavPackSortMode>(DEFAULT_SORT);
/** 列表项临时下载状态（刷新会清空） */
const dlStateByName = ref<Record<string, RowDlState>>({});
/** 下载中百分比 0–100 */
const dlPercentByName = ref<Record<string, number>>({});
/** 下载完成可打开的本地路径 */
const doneOpenPathByName = ref<Record<string, string>>({});
/** name → requestId */
const activeRequestByName = new Map<string, string>();
/** requestId → name */
const nameByRequestId = new Map<string, string>();
let progressUnsub: (() => void) | null = null;
let abortGeneration = 0;
const listFocusEl = ref<HTMLElement | null>(null);
const modalRef = ref<InstanceType<typeof AppModal> | null>(null);

function parseUploadedAtMs(raw: string | null): number {
  if (!raw?.trim()) return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function formatUploadedAt(raw: string | null): string {
  const ms = parseUploadedAtMs(raw);
  if (!ms) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function formatSize(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const packRows = computed((): PackRow[] => {
  const out: PackRow[] = [];
  for (const e of entries.value) {
    if (e.isDirectory) continue;
    const lower = e.name.toLowerCase();
    if (!lower.endsWith(".ctz") && !lower.endsWith(".ctzx")) continue;
    out.push({
      path: e.name,
      name: e.name,
      size: e.size,
      lastModified: e.lastModified,
      uploadedAtMs: parseUploadedAtMs(e.lastModified),
    });
  }
  return out;
});

const filteredSortedItems = computed(() => {
  const q = filterQuery.value.trim().toLowerCase();
  let list = packRows.value.slice();
  if (q) {
    list = list.filter((it) => it.name.toLowerCase().includes(q));
  }
  const mode = sortMode.value;
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const sizeOf = (it: PackRow) =>
    typeof it.size === "number" && Number.isFinite(it.size) ? it.size : -1;

  list.sort((a, b) => {
    switch (mode) {
      case "nameAsc":
        return collator.compare(a.name, b.name);
      case "nameDesc":
        return collator.compare(b.name, a.name);
      case "sizeAsc":
        return sizeOf(a) - sizeOf(b);
      case "sizeDesc":
        return sizeOf(b) - sizeOf(a);
      case "uploadedAtAsc":
        return a.uploadedAtMs - b.uploadedAtMs;
      case "uploadedAtDesc":
      default:
        return b.uploadedAtMs - a.uploadedAtMs;
    }
  });
  return list;
});

const {
  selectedPaths,
  onItemClick,
  onListKeydown,
  clearSelection,
} = usePathListSelection({ items: filteredSortedItems });

const hasAnyItems = computed(() => packRows.value.length > 0);
const visibleCount = computed(() => filteredSortedItems.value.length);
const showSelCount = computed(() => visibleCount.value > 0);
const hasSelection = computed(() => selectedPaths.value.length > 0);
/** 批量「下载选中」进行中（含串行导入）；用于停止按钮、锁面板、禁用「打开」 */
const batchDownloading = ref(false);
const anyDownloading = computed(() =>
  Object.values(dlStateByName.value).some((s) => s === "downloading"),
);

const sortScrollItems = computed((): CustomSelectItem[] =>
  SORT_MODES.map((m) => ({
    kind: "item" as const,
    id: m,
    label: SORT_LABELS[m],
    prefixHtml: /Asc$/.test(m) ? icons.asc : icons.desc,
  })),
);

const sortDisplayLabel = computed(
  () => SORT_LABELS[sortMode.value] ?? "上传时间",
);

const sortTriggerPrefixHtml = computed(() =>
  /Asc$/.test(sortMode.value) ? icons.asc : icons.desc,
);

function onSortSelect(id: string) {
  if (id === sortMode.value) return;
  if ((SORT_MODES as string[]).includes(id)) {
    sortMode.value = id as WebDavPackSortMode;
  }
}

function auth() {
  return buildWebDavAuth(props.webDav);
}

function newRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function setDlState(name: string, state: RowDlState | null) {
  const next = { ...dlStateByName.value };
  if (state == null) delete next[name];
  else next[name] = state;
  dlStateByName.value = next;
  if (state == null) {
    const pct = { ...dlPercentByName.value };
    delete pct[name];
    dlPercentByName.value = pct;
    const opens = { ...doneOpenPathByName.value };
    delete opens[name];
    doneOpenPathByName.value = opens;
  } else if (state === "downloading") {
    const opens = { ...doneOpenPathByName.value };
    delete opens[name];
    doneOpenPathByName.value = opens;
    if (dlPercentByName.value[name] == null) {
      dlPercentByName.value = { ...dlPercentByName.value, [name]: 0 };
    }
  } else if (state === "done") {
    const pct = { ...dlPercentByName.value };
    delete pct[name];
    dlPercentByName.value = pct;
  }
}

function setDoneOpenPath(name: string, openPath: string) {
  doneOpenPathByName.value = {
    ...doneOpenPathByName.value,
    [name]: openPath,
  };
}

function setDlPercent(name: string, percent: number) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  if (dlPercentByName.value[name] === p) return;
  dlPercentByName.value = { ...dlPercentByName.value, [name]: p };
}

function clearAllDlState() {
  dlStateByName.value = {};
  dlPercentByName.value = {};
  doneOpenPathByName.value = {};
  for (const id of activeRequestByName.values()) {
    nameByRequestId.delete(id);
  }
  activeRequestByName.clear();
}

function ensureProgressListener() {
  if (progressUnsub || !window.colorTxt?.webdav?.onTransferProgress) return;
  progressUnsub = window.colorTxt.webdav.onTransferProgress((p) => {
    const name = nameByRequestId.get(p.requestId);
    if (!name) return;
    if (dlStateByName.value[name] !== "downloading") return;
    setDlPercent(name, p.percent);
  });
}

/**
 * 中止进行中的传输。
 * clearDone=true：连同已完成态一并清空（关面板 / 刷新）。
 * clearDone=false：仅取消当前下载，保留已导入可打开项（批量「停止」）。
 */
async function abortActiveTransfers(opts?: { clearDone?: boolean }) {
  abortGeneration += 1;
  const ids = [...activeRequestByName.values()];
  const names = [...activeRequestByName.keys()];
  activeRequestByName.clear();
  if (opts?.clearDone) {
    clearAllDlState();
  } else {
    for (const name of names) {
      setDlState(name, null);
    }
    for (const id of ids) {
      nameByRequestId.delete(id);
    }
  }
  const api = window.colorTxt?.webdav;
  if (!api?.abortTransfer) return;
  await Promise.all(
    ids.map(async (id) => {
      try {
        await api.abortTransfer(id);
      } catch {
        /* ignore */
      }
    }),
  );
}

async function abortAllDownloads() {
  await abortActiveTransfers({ clearDone: true });
}

async function stopBatchDownload() {
  await abortActiveTransfers({ clearDone: false });
}

function focusList() {
  void nextTick(() => {
    listFocusEl.value?.focus({ preventScroll: true });
    if (!listFocusEl.value) {
      modalRef.value?.focusBackdrop?.();
    }
  });
}

async function refreshList() {
  await abortAllDownloads();
  const a = auth();
  if (!a || !window.colorTxt?.webdav) {
    listError.value = "请先在设置中配置 WebDAV";
    entries.value = [];
    focusList();
    return;
  }
  loading.value = true;
  listError.value = "";
  try {
    await window.colorTxt.webdav.ensureLayout(a);
    const r = await window.colorTxt.webdav.list(a, "Books");
    if (!r.ok) {
      listError.value = r.error;
      entries.value = [];
      return;
    }
    entries.value = r.entries;
  } catch (e) {
    listError.value = e instanceof Error ? e.message : String(e);
    entries.value = [];
  } finally {
    loading.value = false;
    focusList();
  }
}

/** 串联下载单个书包；成功返回本地路径，取消/失败返回 null */
async function downloadOne(name: string): Promise<string | null> {
  const a = auth();
  if (!a || !window.colorTxt?.webdav) {
    appToast("WebDAV 未配置", { kind: "warning" });
    return null;
  }
  if (dlStateByName.value[name] === "downloading") return null;

  const gen = abortGeneration;
  const requestId = newRequestId(`webdav-panel-${name}`);
  ensureProgressListener();
  activeRequestByName.set(name, requestId);
  nameByRequestId.set(requestId, name);
  setDlState(name, "downloading");
  try {
    const r = await window.colorTxt.webdav.getToFile(
      a,
      `Books/${name}`,
      name,
      requestId,
    );
    if (gen !== abortGeneration) return null;
    if (!r.ok) {
      if ("aborted" in r && r.aborted) {
        setDlState(name, null);
        return null;
      }
      setDlState(name, null);
      appToast(r.error || `下载失败：${name}`, { kind: "danger" });
      return null;
    }
    setDlPercent(name, 100);
    return r.filePath;
  } catch (e) {
    if (gen !== abortGeneration) return null;
    setDlState(name, null);
    appToast(e instanceof Error ? e.message : String(e), { kind: "danger" });
    return null;
  } finally {
    nameByRequestId.delete(requestId);
    if (activeRequestByName.get(name) === requestId) {
      activeRequestByName.delete(name);
    }
  }
}

function toastImportSummary(okCount: number, skipCount: number, failCount: number) {
  const parts: string[] = [];
  if (okCount > 0) parts.push(`成功 ${okCount}`);
  if (skipCount > 0) parts.push(`跳过 ${skipCount}`);
  if (failCount > 0) parts.push(`失败 ${failCount}`);
  if (parts.length > 0) {
    appToast(`书包导入：${parts.join("，")}`, { kind: "info" });
  }
}

async function importDownloadedPacks(
  items: Array<{ remoteName: string; packPath: string }>,
  session?: { passwordBook: string[]; skipOnDecryptFail: boolean },
): Promise<WebDavImportPackResult | null> {
  if (items.length === 0) return null;
  try {
    const results = await props.importPackPaths(
      items.map((it) => it.packPath),
      {
        silent: true,
        passwordBook: session?.passwordBook,
        skipOnDecryptFail: session?.skipOnDecryptFail,
      },
    );
    const byPack = new Map(
      results.imported.map((r) => [r.packPath, r.openPath]),
    );
    for (const it of items) {
      const openPath = byPack.get(it.packPath);
      if (!openPath) {
        setDlState(it.remoteName, null);
        continue;
      }
      setDoneOpenPath(it.remoteName, openPath);
      setDlState(it.remoteName, "done");
    }
    return results;
  } catch (e) {
    for (const it of items) setDlState(it.remoteName, null);
    appToast(e instanceof Error ? e.message : String(e), { kind: "danger" });
    return null;
  }
}

async function onDownloadOne(name: string, ev: MouseEvent) {
  ev.stopPropagation();
  if (batchDownloading.value) return;
  if (dlStateByName.value[name] === "downloading") return;
  const filePath = await downloadOne(name);
  if (!filePath) return;
  const stats = await importDownloadedPacks([
    { remoteName: name, packPath: filePath },
  ]);
  if (stats) {
    toastImportSummary(stats.okCount, stats.skipCount, stats.failCount);
  }
}

async function onDownloadSelectedOrStop() {
  if (batchDownloading.value) {
    await stopBatchDownload();
    return;
  }
  if (selectedPaths.value.length === 0 || anyDownloading.value) return;
  batchDownloading.value = true;
  const gen = abortGeneration;
  const selected = new Set(selectedPaths.value);
  // 按当前可见列表顺序串联：下完一个立刻导入并显示「打开」
  const names = filteredSortedItems.value
    .map((it) => it.name)
    .filter((name) => selected.has(name));
  let okCount = 0;
  let skipCount = 0;
  let failCount = 0;
  let passwordBook: string[] = [];
  let skipOnDecryptFail = false;
  try {
    for (const name of names) {
      if (gen !== abortGeneration) break;
      const filePath = await downloadOne(name);
      if (!filePath || gen !== abortGeneration) continue;
      const stats = await importDownloadedPacks(
        [{ remoteName: name, packPath: filePath }],
        { passwordBook, skipOnDecryptFail },
      );
      if (!stats) continue;
      okCount += stats.okCount;
      skipCount += stats.skipCount;
      failCount += stats.failCount;
      passwordBook = stats.passwordBook;
      skipOnDecryptFail = stats.skipOnDecryptFail;
    }
    toastImportSummary(okCount, skipCount, failCount);
  } finally {
    batchDownloading.value = false;
  }
}

function onOpenDownloaded(name: string, ev: MouseEvent) {
  ev.stopPropagation();
  if (batchDownloading.value) return;
  const openPath = doneOpenPathByName.value[name]?.trim();
  if (!openPath) return;
  emit("openFile", openPath);
}

function onBeforeClose(): boolean {
  return !batchDownloading.value;
}

async function onUploadConfig() {
  const a = auth();
  if (!a) {
    appToast("请先配置 WebDAV", { kind: "warning" });
    return;
  }
  configBusy.value = true;
  try {
    const r = await uploadMainConfig(a);
    if (!r.ok) {
      appToast(r.error, { kind: "danger" });
      return;
    }
    appToast("已上传配置", { kind: "success" });
  } finally {
    configBusy.value = false;
  }
}

async function onUpdateConfig() {
  const a = auth();
  if (!a) {
    appToast("请先配置 WebDAV", { kind: "warning" });
    return;
  }
  configBusy.value = true;
  try {
    const r = await downloadMainConfig(a);
    if (!r.ok) {
      appToast(r.error, { kind: "danger" });
      return;
    }
    emit("configDownloaded");
    appToast("已同步配置", { kind: "success" });
  } finally {
    configBusy.value = false;
  }
}

function isEditableKeyTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function onModalKeydown(ev: KeyboardEvent) {
  if (isEditableKeyTarget(ev.target)) return;
  const accel = ev.ctrlKey || ev.metaKey;
  if (!accel) return;
  const k = ev.key.toLowerCase();
  if (k !== "a" && k !== "i") return;
  ev.preventDefault();
  ev.stopPropagation();
  onListKeydown(ev);
}

watch(modelValue, (open) => {
  if (!open) {
    void abortAllDownloads();
    clearSelection();
    filterQuery.value = "";
    sortMode.value = DEFAULT_SORT;
    listError.value = "";
    return;
  }
  void refreshList();
  focusList();
});

onBeforeUnmount(() => {
  void abortAllDownloads();
  progressUnsub?.();
  progressUnsub = null;
});
</script>

<template>
  <AppModal
    ref="modalRef"
    v-model="modelValue"
    title="WebDAV"
    panel-class="webDavPanelModal"
    :mask-closable="false"
    :esc-closable="!batchDownloading"
    :before-close="onBeforeClose"
    :body-scroll="false"
    @keydown="onModalKeydown"
  >
    <div class="webDavBody">
      <header class="bookSourceToolbarHeader webDavToolbar">
        <div class="webDavFilterField">
          <span
            class="webDavFilterIcon"
            aria-hidden="true"
            v-html="icons.filter"
          />
          <input
            v-model="filterQuery"
            class="bookSourceToolbarSearch webDavFilterInput"
            type="search"
            spellcheck="false"
            autocomplete="off"
            placeholder="过滤文件名…"
            aria-label="过滤 WebDAV 书包文件名"
          />
        </div>
        <AppCustomSelect
          class="webDavSortSelect"
          :model-value="sortMode"
          :display-label="sortDisplayLabel"
          :trigger-prefix-html="sortTriggerPrefixHtml"
          :fixed-top-items="[]"
          :scroll-items="sortScrollItems"
          :fixed-bottom-items="[]"
          :scroll-max-height="360"
          ariaLabel="书包列表排序"
          @update:model-value="onSortSelect"
        />
        <button
          type="button"
          class="btn"
          :disabled="loading || batchDownloading"
          title="刷新"
          @click="refreshList"
        >
          <span class="webDavToolbarIcon" v-html="icons.refresh" />
          刷新
        </button>
      </header>

      <div
        ref="listFocusEl"
        class="webDavListFocus"
        tabindex="0"
        aria-label="WebDAV 书包列表"
      >
        <div v-if="listError" class="webDavEmpty webDavEmpty--error">
          {{ listError }}
        </div>
        <div v-else-if="loading" class="webDavEmpty">
          加载中<LoadingDotsBounce />
        </div>
        <div v-else-if="!hasAnyItems" class="webDavEmpty">
          远端 Books 目录暂无书包文件
        </div>
        <div v-else-if="visibleCount === 0" class="webDavEmpty">
          无匹配的文件
        </div>
        <VirtualList
          v-else
          class="webDavList"
          :item-count="visibleCount"
          :row-stride="ROW_STRIDE"
          :overscan="10"
          :item-key="(i) => filteredSortedItems[i]?.path ?? i"
        >
          <template #default="{ index }">
            <div class="webDavRow" @click="onItemClick(index, $event)">
              <AppCheckbox
                class="webDavCheckbox"
                passive
                :model-value="
                  selectedPaths.includes(filteredSortedItems[index]!.path)
                "
                :aria-label="`选择 ${filteredSortedItems[index]!.name}`"
              />
              <span
                class="webDavName"
                :title="filteredSortedItems[index]!.name"
                >{{ filteredSortedItems[index]!.name }}</span
              >
              <span class="webDavSize">{{
                formatSize(filteredSortedItems[index]!.size)
              }}</span>
              <span class="webDavUploaded">{{
                formatUploadedAt(filteredSortedItems[index]!.lastModified)
              }}</span>
              <span class="webDavDlSlot" @click.stop>
                <span
                  v-if="
                    dlStateByName[filteredSortedItems[index]!.name] ===
                    'downloading'
                  "
                  class="webDavDlPct"
                  :title="`下载中 ${dlPercentByName[filteredSortedItems[index]!.name] ?? 0}%`"
                  aria-label="下载进度"
                  >{{
                    dlPercentByName[filteredSortedItems[index]!.name] ?? 0
                  }}%</span
                >
                <IconButton
                  v-else-if="
                    dlStateByName[filteredSortedItems[index]!.name] === 'done'
                  "
                  class="webDavDlBtn"
                  :icon-html="icons.read"
                  aria-label="打开"
                  title="打开"
                  :disabled="batchDownloading"
                  @click="
                    onOpenDownloaded(filteredSortedItems[index]!.name, $event)
                  "
                />
                <IconButton
                  v-else
                  class="webDavDlBtn"
                  :icon-html="icons.webDavDownload"
                  aria-label="下载"
                  title="下载"
                  :disabled="batchDownloading"
                  @click="
                    onDownloadOne(filteredSortedItems[index]!.name, $event)
                  "
                />
              </span>
            </div>
          </template>
        </VirtualList>
      </div>
    </div>

    <template #footer>
      <div class="webDavFooter">
        <div class="webDavFooterStart">
          <button
            type="button"
            class="btn"
            size="large"
            :disabled="configBusy"
            @click="onUploadConfig"
          >
            <span class="webDavFooterIcon" v-html="icons.webDavUpload" />
            上传配置
          </button>
          <button
            type="button"
            class="btn"
            size="large"
            :disabled="configBusy"
            @click="onUpdateConfig"
          >
            <span class="webDavFooterIcon" v-html="icons.webDavDownload" />
            同步配置
          </button>
          <!-- <span class="webDavFooterHint"
            >下载的文件会加入侧栏「文件」列表</span
          > -->
        </div>
        <div class="webDavFooterEnd">
          <span v-if="showSelCount" class="webDavSelCount">
            已选中：{{ selectedPaths.length }}/{{ visibleCount }}
          </span>
          <button
            type="button"
            class="btn"
            :class="batchDownloading ? 'danger' : 'primary'"
            size="large"
            :disabled="!batchDownloading && (!hasSelection || anyDownloading)"
            @click="onDownloadSelectedOrStop"
          >
            <span
              v-if="batchDownloading"
              class="webDavFooterIcon"
              v-html="icons.stop"
            />
            {{ batchDownloading ? "停止" : "下载选中" }}
          </button>
        </div>
      </div>
    </template>
  </AppModal>
</template>

<style>
.appModalPanel.webDavPanelModal {
  --min-width: 600px;
  --max-width: 800px;
  --max-height: calc(100vh - 48px);
  padding: 0;
  overflow: hidden;
  max-width: var(--max-width) !important;
  width: max(min(calc(100vw - 48px), var(--max-width)), var(--min-width));
  max-height: var(--max-height) !important;
  height: var(--max-height);
}
.appModalPanel.webDavPanelModal .appModalPanelHeader {
  margin-bottom: 0;
  padding: 12px 48px 12px 16px;
}
.appModalPanel.webDavPanelModal .appModalBody {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}
.appModalPanel.webDavPanelModal .webDavToolbar {
  padding: 0 10px 10px;
  border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.08));
}
.appModalPanel.webDavPanelModal .appModalFooter {
  margin-top: 0;
  padding: 10px 10px 10px 16px;
  border-top: 1px solid var(--border, rgba(0, 0, 0, 0.08));
}
.appModalPanel.webDavPanelModal .webDavList {
  padding: 0 16px;
}
.appModalPanel.webDavPanelModal
  input.bookSourceToolbarSearch.webDavFilterInput[type="search"] {
  width: 100%;
  flex: none;
  padding-left: 32px;
  font-size: 14px;
}
</style>

<style scoped>
.webDavBody {
  display: flex;
  flex-direction: column;
  outline: none;
  overflow: hidden;
  flex: 1;
  min-height: 0;
}

.webDavListFocus {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  outline: none;
}

.webDavFilterField {
  position: relative;
  flex: 1;
  min-width: 0;
}

.webDavFilterIcon {
  position: absolute;
  left: 10px;
  top: 50%;
  z-index: 1;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--secondary);
  pointer-events: none;
}

.webDavFilterIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.webDavFilterIcon :deep(svg path) {
  fill: currentColor;
}

.webDavSortSelect {
  flex-shrink: 0;
  width: 114px;
  min-width: 114px;
}

.webDavEmpty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 14px;
  padding: 24px;
  text-align: center;
}

.webDavEmpty--error {
  color: var(--danger, #c44);
}

.webDavList {
  flex: 1;
  min-height: 0;
  min-width: 0;
  background: var(--bg);
}

.webDavRow {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 6px 0;
  box-sizing: border-box;
  min-height: 50px;
  border: none;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  cursor: default;
  user-select: none;
}

.webDavCheckbox {
  flex-shrink: 0;
  pointer-events: none;
}

.webDavName {
  flex: 1 1 0%;
  min-width: 0;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.webDavSize {
  flex: 0 0 72px;
  font-size: 12px;
  color: var(--muted);
  text-align: right;
  white-space: nowrap;
}

.webDavUploaded {
  flex: 0 0 148px;
  font-size: 12px;
  color: var(--muted);
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.webDavDlSlot {
  flex: 0 0 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  height: 30px;
}

.webDavDlPct {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  white-space: nowrap;
  user-select: none;
}

.webDavFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  flex-wrap: wrap;
}

.webDavFooterStart,
.webDavFooterEnd {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.webDavFooterStart {
  flex: 1 1 auto;
  flex-wrap: wrap;
}

.webDavFooterIcon {
  display: inline-flex;
  width: 14px;
  height: 14px;
  margin-right: 4px;
  vertical-align: -2px;
}

.webDavFooterIcon :deep(svg) {
  width: 14px;
  height: 14px;
}

.webDavToolbarIcon {
  display: inline-flex;
  width: 14px;
  height: 14px;
  margin-right: 4px;
  vertical-align: -2px;
}

.webDavToolbarIcon :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;
}

.webDavToolbarIcon :deep(svg path) {
  fill: currentColor;
}

.webDavFooterHint {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}

.webDavSelCount {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
</style>
