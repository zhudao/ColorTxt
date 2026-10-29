import { computed, onBeforeUnmount, ref, shallowRef } from "vue";
import type {
  BookSourceDownloadEvent,
  BookSourceImportPreviewItem,
  BookSourceListItem,
  BookSourceRecord,
  BookSourceSearchEvent,
  Book,
  BookChapter,
  SearchBookItem,
} from "@shared/bookSource/types";
import { parseBookSourceJson } from "@shared/bookSource/types";
import { searchBookToBook } from "@shared/bookSource/bookModel";
import { appPrompt } from "../../services/appDialog";
import { appLoading } from "../../services/appLoading";
import { ipcPlain } from "../ipcPlain";

const NETWORK_IMPORT_MAX_RETRIES = 5;
const NETWORK_IMPORT_RETRY_DELAY_MS = 1000;

let nextNetworkImportRequestId = 1;

export class NetworkImportAbortedError extends Error {
  constructor(message = "已取消") {
    super(message);
    this.name = "NetworkImportAbortedError";
  }
}

export function isNetworkImportAborted(e: unknown): boolean {
  return e instanceof NetworkImportAbortedError;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new NetworkImportAbortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new NetworkImportAbortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new NetworkImportAbortedError();
}

export function useBookSourceApi() {
  const api = window.colorTxt;

  async function listSources(): Promise<BookSourceListItem[]> {
    return api.bookSourceList();
  }

  async function getSource(url: string): Promise<BookSourceRecord | null> {
    return api.bookSourceGet(url);
  }

  async function saveSource(source: BookSourceRecord) {
    return api.bookSourceSave(ipcPlain(source));
  }

  async function deleteSources(urls: string[]) {
    return api.bookSourceDelete(urls);
  }

  async function toggleSource(url: string, enabled: boolean) {
    return api.bookSourceToggle(url, enabled);
  }

  async function importFromFile(): Promise<BookSourceImportPreviewItem[]> {
    const r = await api.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "JSON", extensions: ["json"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (r.canceled || !r.filePaths.length) return [];
    const read = await api.bookSourceReadFile(r.filePaths[0]);
    if (!read.ok || !read.text) return [];
    const sources = parseBookSourceJson(read.text);
    return api.bookSourceImportPreview(sources);
  }

  /** 拉取网络书源正文；失败则间隔重试；支持 Esc / AbortSignal 中断 */
  async function fetchNetworkImportText(
    url: string,
    signal: AbortSignal,
    hooks?: {
      onRequestId?: (requestId: number) => void;
      onRequestSettled?: () => void;
    },
  ): Promise<string> {
    let lastMessage = "加载失败";
    for (
      let attempt = 0;
      attempt <= NETWORK_IMPORT_MAX_RETRIES;
      attempt++
    ) {
      throwIfAborted(signal);
      if (attempt > 0) {
        appLoading.update(
          `获取失败，正在重试 ${attempt}/${NETWORK_IMPORT_MAX_RETRIES}`,
        );
        await sleep(NETWORK_IMPORT_RETRY_DELAY_MS, signal);
        throwIfAborted(signal);
        appLoading.update("正在获取书源");
      }
      const requestId = nextNetworkImportRequestId++;
      hooks?.onRequestId?.(requestId);
      try {
        const res = await api.bookSourceFetchUrl(url, { requestId });
        throwIfAborted(signal);
        if (res.aborted) throw new NetworkImportAbortedError();
        if (res.ok && res.text) return res.text;
        lastMessage = res.message?.trim() || "加载失败";
        // 入参无效无需重试
        if (lastMessage === "URL 无效") break;
      } finally {
        hooks?.onRequestSettled?.();
      }
    }
    throw new Error(lastMessage);
  }

  async function importFromNetwork(): Promise<BookSourceImportPreviewItem[]> {
    const url = await appPrompt("", {
      title: "网络导入",
      placeholder: "URL",
    });
    if (!url?.trim()) return [];

    const ac = new AbortController();
    let activeRequestId: number | null = null;
    const onEsc = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      if (activeRequestId != null) {
        void api.bookSourceFetchUrlAbort(activeRequestId);
      }
      ac.abort();
    };

    // 拦截 Esc，避免关掉书源面板等下层模态
    window.addEventListener("keydown", onEsc, true);
    try {
      return await appLoading.with("正在获取书源", async () => {
        const text = await fetchNetworkImportText(url.trim(), ac.signal, {
          onRequestId: (id) => {
            activeRequestId = id;
          },
          onRequestSettled: () => {
            activeRequestId = null;
          },
        });
        throwIfAborted(ac.signal);
        appLoading.update("正在解析书源");
        const sources = parseBookSourceJson(text);
        throwIfAborted(ac.signal);
        if (!sources.length) {
          throw new Error(
            "未解析到有效书源（需含 bookSourceUrl / bookSourceName）",
          );
        }
        appLoading.update("正在准备导入预览");
        const preview = await api.bookSourceImportPreview(sources);
        throwIfAborted(ac.signal);
        return preview;
      });
    } finally {
      window.removeEventListener("keydown", onEsc, true);
      if (activeRequestId != null) {
        void api.bookSourceFetchUrlAbort(activeRequestId);
      }
    }
  }

  /** 从系统剪贴板 JSON 解析书源并生成导入预览（数组或单对象） */
  async function importFromClipboard(): Promise<BookSourceImportPreviewItem[]> {
    const text = await navigator.clipboard.readText();
    const sources = parseBookSourceJson(text);
    if (!sources.length) return [];
    return api.bookSourceImportPreview(sources);
  }

  async function commitImport(payload: {
    addUrls: string[];
    updateUrls: string[];
    sources: BookSourceRecord[];
  }) {
    return api.bookSourceImportCommit(ipcPlain(payload));
  }

  async function reorderSource(url: string, position: "top" | "bottom") {
    return api.bookSourceReorder(url, position);
  }

  async function applySourceCustomOrders(
    updates: Array<{ url: string; customOrder: number }>,
  ) {
    return api.bookSourceApplyCustomOrders(ipcPlain(updates));
  }

  return {
    listSources,
    getSource,
    saveSource,
    deleteSources,
    toggleSource,
    reorderSource,
    applySourceCustomOrders,
    importFromFile,
    importFromNetwork,
    importFromClipboard,
    commitImport,
  };
}

/** 可参与搜索的文本书源数量（可选限定 sourceUrls） */
export async function countEligibleSearchSources(
  options?: { sourceUrls?: string[] },
): Promise<number> {
  const all = await window.colorTxt.bookSourceList();
  const scope = options?.sourceUrls?.length
    ? new Set(options.sourceUrls)
    : null;
  return all.filter((s) => {
    if (!s.hasSearchUrl) return false;
    const t = s.bookSourceType;
    if (t !== 0 && t !== undefined && t !== null) return false;
    if (scope) return scope.has(s.bookSourceUrl);
    // 未限定时仅统计启用源；特指 sourceUrls 时不要求 enabled
    return s.enabled;
  }).length;
}

export function useBookSourceSearch() {
  const searching = ref(false);
  const loadingMore = ref(false);
  const searchHasMore = ref(false);
  const searchPage = ref(1);
  const searchPhase = ref<"searching" | "completed" | "stopped" | null>(null);
  const searchKey = ref("");
  const progress = ref({ completed: 0, total: 0 });
  const results = shallowRef<SearchBookItem[]>([]);
  const searchLogs = ref<string[]>([]);
  const searchSourceErrors = ref<string[]>([]);
  const searchSourceStats = ref<
    Array<{
      sourceName: string;
      sourceUrl: string;
      itemCount: number;
      failed: boolean;
    }>
  >([]);
  /** 最近一次搜索因无启用搜索源而短路（未进 IPC） */
  const noEnabledSearchSources = ref(false);
  let searchId = "";
  let searchSeq = 0;
  let unsub: (() => void) | null = null;

  const pageLoading = computed(() => searching.value || loadingMore.value);

  function reset() {
    results.value = [];
    progress.value = { completed: 0, total: 0 };
    searchLogs.value = [];
    searchSourceErrors.value = [];
    searchSourceStats.value = [];
    searchHasMore.value = false;
    loadingMore.value = false;
    searchPage.value = 1;
    noEnabledSearchSources.value = false;
  }

  async function search(
    key: string,
    options?: { sourceUrls?: string[]; precisionSearch?: boolean },
  ) {
    const k = key.trim();
    if (!k) return;
    const seq = ++searchSeq;

    unsub?.();
    unsub = null;
    if (searchId) {
      await window.colorTxt.bookSourceSearchCancel(searchId);
      searchId = "";
    }

    const eligible = await countEligibleSearchSources(options);
    if (seq !== searchSeq) return;

    searchKey.value = k;
    searchPhase.value = null;
    searching.value = false;
    reset();

    if (eligible === 0) {
      noEnabledSearchSources.value = true;
      return;
    }

    searching.value = true;
    searchPhase.value = "searching";

    const searchOptions =
      options?.sourceUrls?.length || options?.precisionSearch
        ? {
            ...(options.sourceUrls?.length
              ? { sourceUrls: options.sourceUrls }
              : {}),
            ...(options.precisionSearch ? { precisionSearch: true } : {}),
          }
        : undefined;

    const r = await window.colorTxt.bookSourceSearch(k, searchOptions);
    if (seq !== searchSeq) return;

    const currentSearchId = r.searchId;
    if (!currentSearchId) {
      searching.value = false;
      searchPhase.value = null;
      return;
    }
    searchId = currentSearchId;

    unsub = window.colorTxt.onBookSourceSearchEvent((ev: BookSourceSearchEvent) => {
      if (ev.searchId !== currentSearchId) return;
      if (ev.type === "progress") {
        progress.value = {
          completed: Math.max(progress.value.completed, ev.completed),
          total: ev.total,
        };
      } else if (ev.type === "result") {
        results.value = ev.items;
      } else if (ev.type === "sourceDone") {
        searchSourceStats.value = [
          ...searchSourceStats.value,
          {
            sourceName: ev.sourceName,
            sourceUrl: ev.sourceUrl,
            itemCount: ev.itemCount,
            failed: ev.failed,
          },
        ];
        if (ev.logs?.length) {
          searchLogs.value = [...searchLogs.value, ...ev.logs];
        }
        if (ev.error) {
          searchSourceErrors.value = [
            ...searchSourceErrors.value,
            `[${ev.sourceName}] ${ev.error}`,
          ];
        }
      } else if (ev.type === "loadMoreStart") {
        loadingMore.value = true;
        progress.value = { completed: 0, total: ev.total };
      } else if (ev.type === "done") {
        searching.value = false;
        searchPhase.value = ev.cancelled ? "stopped" : "completed";
        searchHasMore.value = ev.hasMore === true;
      } else if (ev.type === "loadMoreDone") {
        loadingMore.value = false;
        searchHasMore.value = ev.hasMore;
      }
    });
  }

  async function loadMore() {
    if (!searchId || pageLoading.value || !searchHasMore.value) {
      return;
    }
    loadingMore.value = true;
    searchPage.value += 1;
    progress.value = { completed: 0, total: 0 };
    const r = await window.colorTxt.bookSourceSearchLoadMore(searchId);
    if (!r.ok) {
      loadingMore.value = false;
      searchPage.value = Math.max(1, searchPage.value - 1);
    }
  }

  async function cancel() {
    searchSeq += 1;
    unsub?.();
    unsub = null;
    if (searchId) {
      await window.colorTxt.bookSourceSearchCancel(searchId);
      searchId = "";
    }
    searching.value = false;
    searchPhase.value = "stopped";
  }

  /** 无启用源时的短路「已搜索」态：有源可用后清回未搜索空状态 */
  function clearShortCircuitSearch() {
    if (!noEnabledSearchSources.value) return;
    searchSeq += 1;
    unsub?.();
    unsub = null;
    searchId = "";
    searching.value = false;
    searchPhase.value = null;
    searchKey.value = "";
    reset();
  }

  onBeforeUnmount(() => {
    unsub?.();
    if (searchId) void window.colorTxt.bookSourceSearchCancel(searchId);
  });

  return {
    searching,
    loadingMore,
    pageLoading,
    searchPage,
    searchHasMore,
    searchPhase,
    searchKey,
    progress,
    results,
    searchLogs,
    searchSourceErrors,
    searchSourceStats,
    noEnabledSearchSources,
    search,
    loadMore,
    cancel,
    reset,
    clearShortCircuitSearch,
  };
}

export function useBookSourceDownload(onDone?: (filePath: string) => void) {
  const downloading = ref(false);
  const downloadProgress = ref({
    current: 0,
    total: 0,
    chapterName: "",
    chapterUrl: "",
  });
  let downloadId = "";
  /** 每次开始/取消递增，用于丢弃取消后迟到的进度与完成事件 */
  let sessionGen = 0;
  let unsub: (() => void) | null = null;
  let pendingResolve: ((path: string | null) => void) | null = null;

  function finish(path: string | null) {
    downloading.value = false;
    downloadProgress.value = {
      ...downloadProgress.value,
      chapterName: "",
      chapterUrl: "",
    };
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve?.(path);
  }

  async function download(
    item: SearchBookItem,
    outputDir: string,
    cacheDir?: string,
    options?: { cacheOnly?: boolean },
  ): Promise<string | null> {
    if (downloading.value) return null;
    const cacheOnly = options?.cacheOnly === true;
    const gen = ++sessionGen;
    downloading.value = true;
    downloadProgress.value = {
      current: 0,
      total: 0,
      chapterName: "",
      chapterUrl: "",
    };
    unsub?.();
    return new Promise((resolve) => {
      pendingResolve = resolve;
      unsub = window.colorTxt.onBookSourceDownloadEvent(
        (ev: BookSourceDownloadEvent) => {
          if (gen !== sessionGen || ev.downloadId !== downloadId) return;
          if (ev.type === "progress") {
            downloadProgress.value = {
              current: ev.current,
              total: ev.total,
              chapterName: ev.chapterName ?? "",
              chapterUrl: ev.chapterUrl ?? "",
            };
          } else if (ev.type === "done") {
            // cacheOnly 时 filePath 为空字符串，仍视为成功（与 null 取消/失败区分）
            if (!cacheOnly) {
              if (ev.filePath) onDone?.(ev.filePath);
              finish(ev.filePath || null);
            } else {
              finish("");
            }
          } else if (ev.type === "error") {
            finish(null);
          }
        },
      );
      void window.colorTxt
        .bookSourceDownload({
          bookUrl: item.bookUrl,
          bookSourceUrl: item.origin,
          name: item.name,
          author: item.author,
          outputDir: cacheOnly ? "" : outputDir,
          cacheDir: cacheDir?.trim() || undefined,
          cacheOnly,
        })
        .then((r) => {
          if (gen !== sessionGen) {
            // 已取消：忽略迟到的 id，并通知主进程停止
            void window.colorTxt.bookSourceDownloadCancel(r.downloadId);
            return;
          }
          downloadId = r.downloadId;
        })
        .catch(() => {
          if (gen === sessionGen) finish(null);
        });
    });
  }

  /** 立即退出忙碌态并请求主进程停止（不必等当前章节网络结束） */
  async function cancel() {
    const id = downloadId;
    sessionGen += 1;
    downloadId = "";
    unsub?.();
    unsub = null;
    if (downloading.value || pendingResolve) finish(null);
    if (id) void window.colorTxt.bookSourceDownloadCancel(id);
  }

  onBeforeUnmount(() => {
    void cancel();
  });

  return { downloading, downloadProgress, download, cancel };
}

export function useBookSourceDetail() {
  const loading = ref(false);
  const error = ref("");
  const logs = ref<string[]>([]);
  const detail = ref<Book | null>(null);
  const chapters = ref<BookChapter[]>([]);

  async function load(item: SearchBookItem) {
    loading.value = true;
    error.value = "";
    logs.value = [];
    detail.value = null;
    chapters.value = [];
    try {
      const seed = searchBookToBook(item);
      const infoRes = await window.colorTxt.bookSourceGetBookInfo({
        bookSourceUrl: item.origin,
        bookUrl: seed.bookUrl,
        name: seed.name,
        author: seed.author,
        kind: seed.kind,
        wordCount: seed.wordCount,
        intro: seed.intro,
        lastChapter: seed.lastChapter,
        coverUrl: seed.coverUrl,
        variable: seed.variable,
        infoHtml: seed.infoHtml ?? item.infoHtml,
        infoUrl: item.infoUrl,
        tocUrl: item.tocUrl ?? seed.tocUrl,
      });
      if (infoRes.logs?.length) logs.value = infoRes.logs;
      if (infoRes.message || !infoRes.detail) {
        error.value = infoRes.message ?? "加载书籍信息失败";
        return;
      }
      const book: Book = {
        ...infoRes.detail,
        origin: item.origin,
        originName: item.originName,
      };
      detail.value = book;
      const tocRes = await window.colorTxt.bookSourceGetChapterList({
        bookSourceUrl: item.origin,
        book,
      });
      if (tocRes.logs?.length) logs.value = [...logs.value, ...tocRes.logs];
      if (tocRes.message) {
        error.value = tocRes.message;
        return;
      }
      chapters.value = tocRes.chapters ?? [];
      if (detail.value && chapters.value.length) {
        // 对齐 Legado：拉完目录后用最新章节标题覆盖 ruleBookInfo.lastChapter
        const latestTitle = chapters.value.find((ch) => !ch.isVolume)?.title?.trim();
        if (latestTitle) {
          detail.value = { ...detail.value, lastChapter: latestTitle };
        }
      }
      if (!chapters.value.length && !error.value && logs.value.length) {
        error.value = "未获取到章节";
      }
    } finally {
      loading.value = false;
    }
  }

  function reset() {
    loading.value = false;
    error.value = "";
    logs.value = [];
    detail.value = null;
    chapters.value = [];
  }

  return { loading, error, logs, detail, chapters, load, reset };
}

export function useBookSourceChapterContent() {
  const loading = ref(false);
  const error = ref("");
  const logs = ref<string[]>([]);
  let loadSeq = 0;

  async function load(payload: {
    bookSourceUrl: string;
    book: Book;
    chapterUrl: string;
    chapterTitle: string;
    chapterIndex: number;
    isVolume?: boolean;
    nextChapterUrl?: string;
    chapterUrls?: string[];
    cacheDir?: string;
    /** 默认 true；false 忽略缓存重新拉取 */
    preferCache?: boolean;
  }): Promise<{ content: string; displayTitle: string } | null> {
    const seq = ++loadSeq;
    loading.value = true;
    error.value = "";
    logs.value = [];
    try {
      const res = await window.colorTxt.bookSourceGetChapterContent(
        ipcPlain(payload),
      );
      if (seq !== loadSeq) return null;
      if (res.logs?.length) logs.value = res.logs;
      if (res.message) {
        error.value = res.message;
        return null;
      }
      return {
        content: res.content ?? "",
        displayTitle: res.displayTitle?.trim() || payload.chapterTitle,
      };
    } finally {
      if (seq === loadSeq) loading.value = false;
    }
  }

  function cancel() {
    loadSeq += 1;
    loading.value = false;
  }

  onBeforeUnmount(() => cancel());

  return { loading, error, logs, load, cancel };
}

export function newEmptyBookSource(): BookSourceRecord {
  return {
    bookSourceUrl: "",
    bookSourceName: "新书源",
    bookSourceType: 0,
    enabled: true,
    enabledExplore: true,
    enabledCookieJar: true,
    searchUrl: "",
    ruleSearch: {},
    ruleBookInfo: {},
    ruleToc: {},
    ruleContent: {},
    ruleExplore: {},
    lastUpdateTime: Date.now(),
  };
}
