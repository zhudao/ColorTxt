import { ipcMain, type WebContents } from "electron";
import { readFile } from "node:fs/promises";
import { BOOK_SOURCE_IPC } from "@shared/bookSource/ipc";
import type {
  BookSourceImportCommitPayload,
  BookSourcePayActionPayload,
  BookSourceResolveCoverPayload,
} from "@shared/bookSource/ipc";
import type { BookSourceRecord, BookSourceGetBookInfoPayload, BookSourceGetChapterListPayload, BookSourceGetChapterContentPayload, BookChapter } from "@shared/bookSource/types";
import { parseBookSourceJson } from "@shared/bookSource/types";
import { coerceBook } from "@shared/bookSource/bookModel";
import {
  applyBookSourceCustomOrders,
  deleteBookSources,
  getBookSource,
  getBookCustomVariable,
  getLoginHeader,
  getLoginInfo,
  getSourceVariable,
  importCommit,
  importPreview,
  listBookSources,
  moveBookSourceToBottom,
  moveBookSourceToTop,
  removeLoginHeader,
  clearLoginSessionAck,
  saveBookSource,
  setBookCustomVariable,
  setLoginInfo,
  setSourceVariable,
  toggleBookSource,
} from "./store/bookSourceStore";
import { cancelSearch, loadMoreSearch, startSearch } from "./searchService";
import { cancelDownload, startDownload } from "./downloadService";
import {
  cancelCheckSource,
  getCheckSourceConfig,
  setCheckSourceConfig,
  startCheckSource,
} from "./checkSourceService";
import { openBrowserLogin } from "./engine/jsExtensions";
import {
  getLoginUiRows,
  runLoginUiButton,
  runSourceLogin,
} from "./engine/loginCheck";
import { runChapterPayAction } from "./engine/payAction";
import { clearExploreKindsCache, getExploreKinds } from "./engine/exploreKinds";
import { fetchViaChromiumNet } from "./engine/chromiumNetFetch";
import {
  exploreBook,
  getBookInfo,
  getChapterList,
} from "./engine/webBook";
import { getChapterContentWithCache } from "./engine/getChapterContentWithCache";
import {
  filterCachedChapterUrls,
  clearBookChapterCache,
  clearAllChapterCache,
  saveChapterCache,
} from "./engine/chapterCache";
import { fetchCoverDisplayUrl } from "./engine/coverImage";
import {
  getDefaultBookSourceProxy,
  getInsecureTlsAgent,
  getProxyDispatcher,
  parseLegadoProxy,
  setDefaultBookSourceProxy,
} from "./engine/httpProxy";
import {
  getDomainFromUrl,
  removeDomainCookies,
} from "./engine/cookieManager";
import {
  appendBookSourceErrorLog,
  summarizeBookSourceError,
} from "./engine/bookSourceErrorLog";

function sendTo(
  wc: WebContents,
  channel: string,
  payload: unknown,
): void {
  if (!wc.isDestroyed()) wc.send(channel, payload);
}

/** 网络导入等：按 requestId 取消进行中的 fetchUrl */
const fetchUrlAbortByRequestId = new Map<number, AbortController>();

export function registerBookSourceIpcHandlers(): void {
  ipcMain.handle(BOOK_SOURCE_IPC.list, () => listBookSources());

  ipcMain.handle(BOOK_SOURCE_IPC.get, (_e, url: unknown) => {
    if (typeof url !== "string") return null;
    return getBookSource(url);
  });

  ipcMain.handle(BOOK_SOURCE_IPC.save, (_e, source: unknown) => {
    try {
      const s = source as BookSourceRecord;
      saveBookSource(s);
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  });

  ipcMain.handle(BOOK_SOURCE_IPC.delete, (_e, urls: unknown) => {
    const list = Array.isArray(urls) ? urls.filter((u) => typeof u === "string") : [];
    deleteBookSources(list as string[]);
    return { ok: true };
  });

  ipcMain.handle(BOOK_SOURCE_IPC.toggle, (_e, url: unknown, enabled: unknown) => {
    if (typeof url === "string" && typeof enabled === "boolean") {
      toggleBookSource(url, enabled);
    }
    return { ok: true };
  });

  ipcMain.handle(BOOK_SOURCE_IPC.importPreview, (_e, sources: unknown) => {
    const list = Array.isArray(sources) ? (sources as BookSourceRecord[]) : [];
    return importPreview(list);
  });

  ipcMain.handle(
    BOOK_SOURCE_IPC.importCommit,
    (_e, payload: unknown) => {
      const p = payload as BookSourceImportCommitPayload;
      const r = importCommit(p);
      return { ok: true, ...r };
    },
  );

  ipcMain.handle(BOOK_SOURCE_IPC.fetchUrl, async (_e, url: unknown, options: unknown) => {
    if (typeof url !== "string" || !url.trim()) {
      return { ok: false, message: "URL 无效" };
    }
    const requestId =
      options &&
      typeof options === "object" &&
      typeof (options as { requestId?: unknown }).requestId === "number"
        ? Math.trunc((options as { requestId: number }).requestId)
        : null;
    const ac = new AbortController();
    if (requestId != null && Number.isFinite(requestId)) {
      fetchUrlAbortByRequestId.set(requestId, ac);
    }
    try {
      // 与书源请求一致：undici 失败时回退 Chromium session（部分站点 Node TLS 会被重置）
      const res = await fetchViaChromiumNet({
        url: url.trim(),
        method: "GET",
        timeoutMs: 30_000,
        signal: ac.signal,
      });
      return { ok: true, text: res.body };
    } catch (e) {
      if (ac.signal.aborted) {
        return { ok: false, aborted: true, message: "已取消" };
      }
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      };
    } finally {
      if (requestId != null) fetchUrlAbortByRequestId.delete(requestId);
    }
  });

  ipcMain.handle(BOOK_SOURCE_IPC.fetchUrlAbort, (_e, requestId: unknown) => {
    if (typeof requestId !== "number" || !Number.isFinite(requestId)) {
      return { ok: false };
    }
    const id = Math.trunc(requestId);
    fetchUrlAbortByRequestId.get(id)?.abort();
    fetchUrlAbortByRequestId.delete(id);
    return { ok: true };
  });

  ipcMain.handle(BOOK_SOURCE_IPC.readFile, async (_e, filePath: unknown) => {
    if (typeof filePath !== "string" || !filePath.trim()) {
      return { ok: false, message: "路径无效" };
    }
    try {
      const text = await readFile(filePath, "utf8");
      return { ok: true, text };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  });

  ipcMain.handle(BOOK_SOURCE_IPC.search, (e, key: unknown, options: unknown) => {
    const k = typeof key === "string" ? key.trim() : "";
    if (!k) return { searchId: "" };
    const opts =
      options && typeof options === "object"
        ? (options as { sourceUrls?: unknown; precisionSearch?: unknown })
        : null;
    const sourceUrls = Array.isArray(opts?.sourceUrls)
      ? opts.sourceUrls.filter((u) => typeof u === "string")
      : undefined;
    const precisionSearch = opts?.precisionSearch === true;
    const wc = e.sender;
    const searchId = startSearch(
      k,
      (ev) => {
        sendTo(wc, BOOK_SOURCE_IPC.searchEvent, ev);
      },
      {
        ...(sourceUrls?.length ? { sourceUrls } : {}),
        ...(precisionSearch ? { precisionSearch: true } : {}),
      },
    );
    return { searchId };
  });

  ipcMain.handle(
    BOOK_SOURCE_IPC.reorder,
    (_e, url: unknown, position: unknown) => {
      if (typeof url !== "string") return { ok: false };
      if (position === "top") moveBookSourceToTop(url);
      else if (position === "bottom") moveBookSourceToBottom(url);
      else return { ok: false };
      return { ok: true };
    },
  );

  ipcMain.handle(
    BOOK_SOURCE_IPC.applyCustomOrders,
    (_e, updates: unknown) => {
      if (!Array.isArray(updates)) return { ok: false };
      const list: Array<{ url: string; customOrder: number }> = [];
      for (const row of updates) {
        if (!row || typeof row !== "object") continue;
        const rec = row as { url?: unknown; customOrder?: unknown };
        if (typeof rec.url !== "string" || typeof rec.customOrder !== "number") {
          continue;
        }
        if (!Number.isFinite(rec.customOrder)) continue;
        list.push({ url: rec.url, customOrder: rec.customOrder });
      }
      applyBookSourceCustomOrders(list);
      return { ok: true };
    },
  );

  ipcMain.handle(BOOK_SOURCE_IPC.searchCancel, (_e, searchId: unknown) => {
    if (typeof searchId === "string") cancelSearch(searchId);
  });

  ipcMain.handle(BOOK_SOURCE_IPC.searchLoadMore, (_e, searchId: unknown) => {
    if (typeof searchId !== "string" || !searchId) return { ok: false };
    return { ok: loadMoreSearch(searchId) };
  });

  ipcMain.handle(BOOK_SOURCE_IPC.download, (e, req: unknown) => {
    const wc = e.sender;
    const downloadId = startDownload(
      req as import("@shared/bookSource/types").BookSourceDownloadRequest,
      (ev) => {
        sendTo(wc, BOOK_SOURCE_IPC.downloadEvent, ev);
      },
    );
    return { downloadId };
  });

  ipcMain.handle(BOOK_SOURCE_IPC.downloadCancel, (_e, downloadId: unknown) => {
    if (typeof downloadId === "string") cancelDownload(downloadId);
  });

  ipcMain.handle(BOOK_SOURCE_IPC.getLoginInfo, (_e, url: unknown) => {
    if (typeof url !== "string") return {};
    return getLoginInfo(url);
  });

  ipcMain.handle(
    BOOK_SOURCE_IPC.setLoginInfo,
    (_e, url: unknown, info: unknown) => {
      if (typeof url === "string" && info && typeof info === "object") {
        setLoginInfo(url, info as Record<string, string>);
      }
      return { ok: true };
    },
  );

  ipcMain.handle(BOOK_SOURCE_IPC.getLoginUi, async (_e, sourceUrl: unknown) => {
    if (typeof sourceUrl !== "string") return { rows: [] };
    const source = getBookSource(sourceUrl);
    if (!source) return { rows: [], message: "书源不存在" };
    const logs: string[] = [];
    try {
      const rows = await getLoginUiRows(source, {}, logs);
      return { rows, logs };
    } catch (e) {
      return {
        rows: [],
        message: e instanceof Error ? e.message : String(e),
        logs,
      };
    }
  });

  ipcMain.handle(
    BOOK_SOURCE_IPC.browserLogin,
    async (_e, sourceUrl: unknown, title: unknown) => {
      if (typeof sourceUrl !== "string") {
        return { ok: false, message: "书源无效" };
      }
      const source = getBookSource(sourceUrl);
      if (!source?.loginUrl?.trim()) {
        return { ok: false, message: "未配置 loginUrl" };
      }
      const winTitle =
        typeof title === "string" && title.trim()
          ? title
          : `登录 · ${source.bookSourceName}`;
      return await openBrowserLogin(source, winTitle);
    },
  );

  ipcMain.handle(
    BOOK_SOURCE_IPC.login,
    async (_e, sourceUrl: unknown, loginData: unknown, options: unknown) => {
      if (typeof sourceUrl !== "string") {
        return { ok: false, message: "书源无效" };
      }
      const source = getBookSource(sourceUrl);
      if (!source) return { ok: false, message: "书源不存在" };
      const logs: string[] = [];
      try {
        const data =
          loginData && typeof loginData === "object"
            ? (loginData as Record<string, string>)
            : {};
        const buttonAction =
          options &&
          typeof options === "object" &&
          "buttonAction" in options &&
          typeof (options as { buttonAction?: unknown }).buttonAction === "string"
            ? (options as { buttonAction: string }).buttonAction
            : undefined;
        if (buttonAction?.trim()) {
          await runLoginUiButton(source, data, buttonAction, logs);
        } else {
          runSourceLogin(source, data, logs);
        }
        return { ok: true, logs };
      } catch (e) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : String(e),
          logs,
        };
      }
    },
  );

  ipcMain.handle(BOOK_SOURCE_IPC.payAction, async (_e, payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return { ok: false, message: "参数无效" };
    }
    const p = payload as BookSourcePayActionPayload;
    if (typeof p.bookSourceUrl !== "string" || !p.bookSourceUrl.trim()) {
      return { ok: false, message: "书源无效" };
    }
    if (!p.book || typeof p.book !== "object") {
      return { ok: false, message: "书籍无效" };
    }
    if (!p.chapter || typeof p.chapter !== "object") {
      return { ok: false, message: "章节无效" };
    }
    const source = getBookSource(p.bookSourceUrl);
    if (!source) return { ok: false, message: "书源不存在" };
    return await runChapterPayAction({
      source,
      book: coerceBook(p.book),
      chapter: p.chapter as BookChapter,
      cacheDir:
        typeof p.cacheDir === "string" ? p.cacheDir : undefined,
    });
  });

  ipcMain.handle(BOOK_SOURCE_IPC.getLoginHeader, (_e, sourceUrl: unknown) => {
    if (typeof sourceUrl !== "string") return "";
    return getLoginHeader(sourceUrl) ?? "";
  });

  ipcMain.handle(BOOK_SOURCE_IPC.removeLoginHeader, (_e, sourceUrl: unknown) => {
    if (typeof sourceUrl === "string") {
      removeLoginHeader(sourceUrl);
    }
    return { ok: true };
  });

  ipcMain.handle(BOOK_SOURCE_IPC.clearCookie, (_e, sourceUrl: unknown) => {
    if (typeof sourceUrl !== "string" || !sourceUrl.trim()) {
      return { ok: false, message: "书源 URL 无效" };
    }
    const url = sourceUrl.trim();
    removeDomainCookies(getDomainFromUrl(url));
    clearLoginSessionAck(url);
    return { ok: true };
  });

  ipcMain.handle(BOOK_SOURCE_IPC.exploreKinds, async (_e, sourceUrl: unknown) => {
    if (typeof sourceUrl !== "string") {
      return { kinds: [], message: "无效书源" };
    }
    const source = getBookSource(sourceUrl);
    if (!source) return { kinds: [], message: "书源不存在" };
    const logs: string[] = [];
    try {
      const kinds = await getExploreKinds(source, logs);
      return { kinds, logs };
    } catch (e) {
      if (!logs.length) {
        appendBookSourceErrorLog(logs, e, {
          phase: "发现分类",
          sourceName: source.bookSourceName,
          sourceUrl: source.bookSourceUrl,
        });
      }
      return {
        kinds: [],
        message: summarizeBookSourceError(e),
        logs,
      };
    }
  });

  ipcMain.handle(
    BOOK_SOURCE_IPC.exploreBooks,
    async (
      _e,
      payload: unknown,
    ) => {
      const p = payload as { sourceUrl?: string; exploreUrl?: string; page?: number };
      if (typeof p?.sourceUrl !== "string" || typeof p?.exploreUrl !== "string") {
        return { items: [], message: "参数无效" };
      }
      const source = getBookSource(p.sourceUrl);
      if (!source) return { items: [], message: "书源不存在" };
      const logs: string[] = [];
      try {
        const items = await exploreBook(
          source,
          p.exploreUrl,
          typeof p.page === "number" ? p.page : 1,
          logs,
        );
        return { items, logs };
      } catch (e) {
        if (!logs.length) {
          appendBookSourceErrorLog(logs, e, {
            phase: "发现书籍列表",
            sourceName: source.bookSourceName,
            sourceUrl: source.bookSourceUrl,
            url: p.exploreUrl,
            extra: `页码: ${typeof p.page === "number" ? p.page : 1}`,
          });
        }
        return {
          items: [],
          message: summarizeBookSourceError(e),
          logs,
        };
      }
    },
  );

  ipcMain.handle(
    BOOK_SOURCE_IPC.exploreClearKindsCache,
    (_e, sourceUrl: unknown) => {
      if (typeof sourceUrl === "string") {
        const source = getBookSource(sourceUrl);
        if (source) clearExploreKindsCache(source);
      }
      return { ok: true };
    },
  );

  ipcMain.handle(BOOK_SOURCE_IPC.getBookInfo, async (_e, payload: unknown) => {
    const p = payload as BookSourceGetBookInfoPayload;
    if (
      typeof p?.bookSourceUrl !== "string" ||
      typeof p?.bookUrl !== "string" ||
      typeof p?.name !== "string" ||
      typeof p?.author !== "string"
    ) {
      return { message: "参数无效" };
    }
    const source = getBookSource(p.bookSourceUrl);
    if (!source) return { message: "书源不存在" };
    const logs: string[] = [];
    try {
      const detail = await getBookInfo(
        source,
        p.bookUrl,
        p.name,
        p.author,
        logs,
        {
          kind: p.kind,
          wordCount: p.wordCount,
          intro: p.intro,
          lastChapter: p.lastChapter,
          coverUrl: p.coverUrl,
          variable: p.variable,
          infoHtml: p.infoHtml,
          infoUrl: p.infoUrl,
          tocUrl: p.tocUrl,
        },
      );
      return { detail, logs };
    } catch (e) {
      if (!logs.length) {
        appendBookSourceErrorLog(logs, e, {
          phase: "书籍详情",
          sourceName: source.bookSourceName,
          sourceUrl: source.bookSourceUrl,
          url: p.bookUrl,
        });
      }
      return { message: summarizeBookSourceError(e), logs };
    }
  });

  ipcMain.handle(
    BOOK_SOURCE_IPC.resolveCoverDisplay,
    async (_e, payload: unknown) => {
      const p = payload as BookSourceResolveCoverPayload;
      if (typeof p?.bookSourceUrl !== "string") {
        return { message: "参数无效" };
      }
      const source = getBookSource(p.bookSourceUrl);
      if (!source) return { message: "书源不存在" };
      const logs: string[] = [];
      try {
        let sourceUrl = p.coverSourceUrl?.trim();
        if (!sourceUrl) {
          const cu = p.coverUrl?.trim();
          if (cu && /^https?:\/\//i.test(cu)) sourceUrl = cu;
          else if (cu?.startsWith("data:")) {
            return { coverUrl: cu, coverSourceUrl: cu, logs };
          }
        }
        if (sourceUrl && !sourceUrl.startsWith("colortxt-local:")) {
          const coverUrl = await fetchCoverDisplayUrl(
            source,
            sourceUrl,
            logs,
            typeof p.bookUrl === "string" ? p.bookUrl : undefined,
          );
          if (coverUrl) {
            return { coverUrl, coverSourceUrl: sourceUrl, logs };
          }
        }
        if (
          typeof p.bookUrl === "string" &&
          typeof p.name === "string" &&
          typeof p.author === "string"
        ) {
          const detail = await getBookInfo(
            source,
            p.bookUrl,
            p.name,
            p.author,
            logs,
            {
              kind: p.kind,
              wordCount: p.wordCount,
              intro: p.intro,
              lastChapter: p.lastChapter,
              coverUrl: p.coverUrl,
            },
          );
          return {
            coverUrl: detail.coverUrl || undefined,
            coverSourceUrl: detail.coverSourceUrl,
            logs,
          };
        }
        return { message: "无法解析封面", logs };
      } catch (e) {
        if (!logs.length) {
          appendBookSourceErrorLog(logs, e, {
            phase: "封面",
            sourceName: source.bookSourceName,
            sourceUrl: source.bookSourceUrl,
            url: p.bookUrl,
          });
        }
        return { message: summarizeBookSourceError(e), logs };
      }
    },
  );

  ipcMain.handle(BOOK_SOURCE_IPC.getChapterList, async (_e, payload: unknown) => {
    const p = payload as BookSourceGetChapterListPayload;
    const book = p?.book;
    if (
      typeof p?.bookSourceUrl !== "string" ||
      !book ||
      typeof book !== "object" ||
      typeof book.bookUrl !== "string" ||
      !book.bookUrl.trim()
    ) {
      return { message: "参数无效" };
    }
    const source = getBookSource(p.bookSourceUrl);
    if (!source) return { message: "书源不存在" };
    const logs: string[] = [];
    try {
      const chapters = await getChapterList(
        source,
        coerceBook(book),
        logs,
      );
      return { chapters, logs };
    } catch (e) {
      if (!logs.length) {
        appendBookSourceErrorLog(logs, e, {
          phase: "章节目录",
          sourceName: source.bookSourceName,
          sourceUrl: source.bookSourceUrl,
          url: book.tocUrl || book.bookUrl,
        });
      }
      return { message: summarizeBookSourceError(e), logs };
    }
  });

  ipcMain.handle(BOOK_SOURCE_IPC.getChapterContent, async (_e, payload: unknown) => {
    const p = payload as BookSourceGetChapterContentPayload;
    const book = p?.book;
    if (
      typeof p?.bookSourceUrl !== "string" ||
      !book ||
      typeof book !== "object" ||
      typeof book.bookUrl !== "string" ||
      !book.bookUrl.trim() ||
      typeof p?.chapterUrl !== "string" ||
      typeof p?.chapterTitle !== "string" ||
      typeof p?.chapterIndex !== "number"
    ) {
      return { message: "参数无效" };
    }
    const source = getBookSource(p.bookSourceUrl);
    if (!source) return { message: "书源不存在" };
    const logs: string[] = [];
    try {
      const chapter = {
        title: p.chapterTitle,
        url: p.chapterUrl,
        index: p.chapterIndex,
        isVolume: Boolean(p.isVolume),
      };
      const cacheDir =
        typeof p.cacheDir === "string" && p.cacheDir.trim()
          ? p.cacheDir.trim()
          : undefined;
      const preferCache = p.preferCache !== false;
      const { content, fromCache, displayTitle } = await getChapterContentWithCache(
        source,
        p.chapterUrl,
        coerceBook(book),
        chapter,
        logs,
        p.nextChapterUrl,
        {
          cacheDir,
          preferCache,
          chapterUrls: Array.isArray(p.chapterUrls)
            ? p.chapterUrls.filter((u): u is string => typeof u === "string")
            : undefined,
        },
      );
      return { content, fromCache, displayTitle, logs };
    } catch (e) {
      if (!logs.length) {
        appendBookSourceErrorLog(logs, e, {
          phase: "章节正文",
          sourceName: source.bookSourceName,
          sourceUrl: source.bookSourceUrl,
          url: p.chapterUrl,
        });
      }
      const detail = summarizeBookSourceError(e);
      return {
        message: detail.startsWith("获取正文失败")
          ? detail
          : `获取正文失败\n\n${detail}`,
        logs,
      };
    }
  });

  ipcMain.handle(BOOK_SOURCE_IPC.chapterCacheStatus, async (_e, payload: unknown) => {
    const p = payload as {
      name?: string;
      bookUrl?: string;
      chapterUrls?: unknown;
      cacheDir?: string;
    };
    if (typeof p?.bookUrl !== "string" || !p.bookUrl.trim()) {
      return { cachedUrls: [] as string[] };
    }
    const urls = Array.isArray(p.chapterUrls)
      ? p.chapterUrls.filter((u): u is string => typeof u === "string")
      : [];
    const cacheDir =
      typeof p.cacheDir === "string" && p.cacheDir.trim()
        ? p.cacheDir.trim()
        : undefined;
    const cachedUrls = await filterCachedChapterUrls(
      typeof p.name === "string" ? p.name : "",
      p.bookUrl,
      urls,
      cacheDir,
    );
    return { cachedUrls };
  });

  ipcMain.handle(BOOK_SOURCE_IPC.saveChapterCache, async (_e, payload: unknown) => {
    const p = payload as {
      name?: string;
      bookUrl?: string;
      chapterUrl?: string;
      content?: string;
      cacheDir?: string;
    };
    if (
      typeof p?.bookUrl !== "string" ||
      !p.bookUrl.trim() ||
      typeof p?.chapterUrl !== "string" ||
      !p.chapterUrl.trim() ||
      typeof p?.content !== "string"
    ) {
      return { ok: false, message: "参数无效" };
    }
    const cacheDir =
      typeof p.cacheDir === "string" && p.cacheDir.trim()
        ? p.cacheDir.trim()
        : undefined;
    try {
      await saveChapterCache(
        typeof p.name === "string" ? p.name : "",
        p.bookUrl.trim(),
        p.chapterUrl.trim(),
        p.content,
        cacheDir,
      );
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle(BOOK_SOURCE_IPC.clearChapterCache, async (_e, payload: unknown) => {
    const p = payload as {
      name?: string;
      bookUrl?: string;
      cacheDir?: string;
    };
    if (typeof p?.bookUrl !== "string" || !p.bookUrl.trim()) {
      return { ok: false, message: "参数无效" };
    }
    const cacheDir =
      typeof p.cacheDir === "string" && p.cacheDir.trim()
        ? p.cacheDir.trim()
        : undefined;
    const { cleared } = await clearBookChapterCache(
      typeof p.name === "string" ? p.name : "",
      p.bookUrl,
      cacheDir,
    );
    return { ok: true, cleared };
  });

  ipcMain.handle(
    BOOK_SOURCE_IPC.clearAllChapterCache,
    async (_e, payload: unknown) => {
      const p = (payload ?? {}) as { cacheDir?: string };
      const cacheDir =
        typeof p.cacheDir === "string" && p.cacheDir.trim()
          ? p.cacheDir.trim()
          : undefined;
      const { cleared } = await clearAllChapterCache(cacheDir);
      return { ok: true, cleared };
    },
  );

  ipcMain.handle(BOOK_SOURCE_IPC.getSourceVariable, (_e, sourceUrl: unknown) => {
    if (typeof sourceUrl !== "string" || !sourceUrl.trim()) return "";
    return getSourceVariable(sourceUrl.trim());
  });

  ipcMain.handle(
    BOOK_SOURCE_IPC.setSourceVariable,
    (_e, payload: unknown) => {
      const p = payload as { sourceUrl?: string; variable?: string };
      if (typeof p?.sourceUrl !== "string" || !p.sourceUrl.trim()) {
        return { ok: false };
      }
      setSourceVariable(p.sourceUrl.trim(), p.variable ?? "");
      return { ok: true };
    },
  );

  ipcMain.handle(BOOK_SOURCE_IPC.getBookVariable, (_e, bookUrl: unknown) => {
    if (typeof bookUrl !== "string" || !bookUrl.trim()) return "";
    return getBookCustomVariable(bookUrl.trim());
  });

  ipcMain.handle(BOOK_SOURCE_IPC.setBookVariable, (_e, payload: unknown) => {
    const p = payload as { bookUrl?: string; variable?: string };
    if (typeof p?.bookUrl !== "string" || !p.bookUrl.trim()) {
      return { ok: false };
    }
    setBookCustomVariable(p.bookUrl.trim(), p.variable ?? "");
    return { ok: true };
  });

  ipcMain.handle(
    BOOK_SOURCE_IPC.checkStart,
    (e, sourceUrls: unknown, options: unknown) => {
      const urls = Array.isArray(sourceUrls)
        ? sourceUrls.filter((u): u is string => typeof u === "string")
        : [];
      const opts =
        options && typeof options === "object"
          ? (options as { keyword?: string })
          : {};
      const wc = e.sender;
      return startCheckSource(
        urls,
        (ev) => sendTo(wc, BOOK_SOURCE_IPC.checkEvent, ev),
        opts,
      );
    },
  );

  ipcMain.handle(BOOK_SOURCE_IPC.checkCancel, () => {
    cancelCheckSource();
    return { ok: true };
  });

  ipcMain.handle(BOOK_SOURCE_IPC.checkGetConfig, () => getCheckSourceConfig());

  ipcMain.handle(BOOK_SOURCE_IPC.checkSetConfig, (_e, patch: unknown) => {
    const p =
      patch && typeof patch === "object"
        ? (patch as Partial<ReturnType<typeof getCheckSourceConfig>>)
        : {};
    return setCheckSourceConfig(p);
  });

  ipcMain.handle(BOOK_SOURCE_IPC.setHttpProxy, (_e, proxy: unknown) => {
    if (proxy == null || proxy === "") {
      setDefaultBookSourceProxy(null);
      return { ok: true };
    }
    if (typeof proxy !== "string") return { ok: false };
    setDefaultBookSourceProxy(proxy);
    return { ok: true };
  });

  ipcMain.handle(BOOK_SOURCE_IPC.getHttpProxy, () => {
    return getDefaultBookSourceProxy() ?? null;
  });

  ipcMain.handle(BOOK_SOURCE_IPC.testHttpProxy, async (_e, payload: unknown) => {
    const p =
      payload && typeof payload === "object"
        ? (payload as { proxy?: unknown; url?: unknown })
        : {};
    const url = typeof p.url === "string" ? p.url.trim() : "";
    if (!url) return { ok: false, message: "请填写测试 URL" };
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { ok: false, message: "测试 URL 格式无效" };
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return { ok: false, message: "测试 URL 仅支持 http/https" };
    }

    const proxyRaw =
      typeof p.proxy === "string" ? p.proxy.trim() : p.proxy == null ? "" : "";
    let dispatcher;
    if (proxyRaw) {
      if (!parseLegadoProxy(proxyRaw)) {
        return { ok: false, message: "代理地址格式无效" };
      }
      dispatcher = getProxyDispatcher(proxyRaw);
      if (!dispatcher) {
        return { ok: false, message: "无法创建代理连接" };
      }
    } else {
      dispatcher = getInsecureTlsAgent();
    }

    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
        dispatcher,
      } as RequestInit & { dispatcher?: unknown });
      return {
        ok: true,
        message: `HTTP ${res.status}`,
      };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  });
}

export function parseImportedBookSources(text: string): BookSourceRecord[] {
  return parseBookSourceJson(text);
}
