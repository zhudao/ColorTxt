import type { BookSourceRecord, SearchBookItem } from "@shared/bookSource/types";
import {
  addBookSourceGroups,
  addErrorComment,
  getCheckKeyword,
  getInvalidGroupNames,
  removeBookSourceGroups,
  removeErrorComment,
  removeInvalidGroups,
} from "./engine/bookSourceGroups";
import { getExploreKinds } from "./engine/exploreKinds";
import {
  exploreBook,
  getBookInfo,
  getChapterContent,
  getChapterList,
  searchBook,
} from "./engine/webBook";
import { getBookSource, saveBookSource } from "./store/bookSourceStore";

export type CheckSourceConfig = {
  keyword: string;
  /** 单个书源超时（毫秒） */
  timeout: number;
  /** 同时校验的书源数 */
  concurrency: number;
  checkSearch: boolean;
  checkDiscovery: boolean;
  checkInfo: boolean;
  checkCategory: boolean;
  checkContent: boolean;
};

export type CheckSourceEvent =
  | {
      type: "progress";
      completed: number;
      total: number;
      sourceUrl: string;
      sourceName: string;
      message: string;
    }
  | {
      /** 单个书源过程状态（对齐 Legado Debug.debugMessageMap 中间态） */
      type: "sourceStatus";
      sourceUrl: string;
      sourceName: string;
      message: string;
    }
  | {
      type: "sourceDone";
      sourceUrl: string;
      sourceName: string;
      ok: boolean;
      message: string;
      bookSourceGroup?: string;
      respondTime?: number;
    }
  | {
      type: "done";
      cancelled: boolean;
      completed: number;
      total: number;
    };

const DEFAULT_CONCURRENCY = 4;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 32;

const DEFAULT_CONFIG: CheckSourceConfig = {
  keyword: "我的",
  timeout: 180_000,
  concurrency: DEFAULT_CONCURRENCY,
  checkSearch: true,
  checkDiscovery: true,
  checkInfo: true,
  checkCategory: true,
  checkContent: true,
};

let config: CheckSourceConfig = { ...DEFAULT_CONFIG };

function clampConcurrency(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, Math.floor(n)));
}

/** 对齐 Legado：仅短消息进列表（msg.length < 30） */
const CHECK_STATUS_MAX_LEN = 30;

class ContentEmptyError extends Error {
  constructor(message = "正文为空") {
    super(message);
    this.name = "ContentEmptyError";
  }
}

class TocEmptyError extends Error {
  constructor(message = "目录为空") {
    super(message);
    this.name = "TocEmptyError";
  }
}

/** 用户点停止：不把进行中的书源标成失败 */
class CheckCancelledError extends Error {
  constructor() {
    super("已停止校验");
    this.name = "CheckCancelledError";
  }
}

/** 对齐 Legado NoStackTraceException：业务失败，不标「网站失效」 */
class CheckFailError extends Error {
  source: BookSourceRecord;
  constructor(message: string, source: BookSourceRecord) {
    super(message);
    this.name = "CheckFailError";
    this.source = source;
  }
}

type StatusReporter = (rawMsg: string) => void;

let running = false;
let cancelled = false;

export function getCheckSourceConfig(): CheckSourceConfig {
  return { ...config };
}

export function setCheckSourceConfig(patch: Partial<CheckSourceConfig>): CheckSourceConfig {
  if (typeof patch.keyword === "string" && patch.keyword.trim()) {
    config.keyword = patch.keyword.trim();
  }
  if (typeof patch.timeout === "number" && patch.timeout > 0) {
    config.timeout = patch.timeout;
  }
  if (typeof patch.concurrency === "number") {
    config.concurrency = clampConcurrency(patch.concurrency);
  }
  if (typeof patch.checkSearch === "boolean") config.checkSearch = patch.checkSearch;
  if (typeof patch.checkDiscovery === "boolean") {
    config.checkDiscovery = patch.checkDiscovery;
  }
  if (typeof patch.checkInfo === "boolean") config.checkInfo = patch.checkInfo;
  if (typeof patch.checkCategory === "boolean") {
    config.checkCategory = patch.checkCategory;
  }
  if (typeof patch.checkContent === "boolean") config.checkContent = patch.checkContent;
  // 至少校验搜索或发现之一
  if (!config.checkSearch && !config.checkDiscovery) {
    config.checkSearch = true;
  }
  return getCheckSourceConfig();
}

export function isCheckSourceRunning(): boolean {
  return running;
}

export function cancelCheckSource(): void {
  cancelled = true;
}

function formatCheckTime(ms: number): string {
  const safe = Math.max(0, ms);
  const mm = String(Math.floor(safe / 60_000) % 60).padStart(2, "0");
  const ss = String(Math.floor((safe % 60_000) / 1000)).padStart(2, "0");
  const SSS = String(safe % 1000).padStart(3, "0");
  return `[${mm}:${ss}.${SSS}]`;
}

/** 对齐 Legado AppPattern.debugMessageSymbolRegex */
function stripDebugSymbols(msg: string): string {
  return msg.replace(/[⇒◇┌└≡]/g, "").trim();
}

function createStatusReporter(
  sourceUrl: string,
  sourceName: string,
  startedAt: number,
  emit: (ev: CheckSourceEvent) => void,
): StatusReporter {
  return (rawMsg: string) => {
    if (cancelled) return;
    // Legado：过滤过长消息后去掉符号写入列表
    if (rawMsg.length >= CHECK_STATUS_MAX_LEN) return;
    const cleaned = stripDebugSymbols(rawMsg);
    if (!cleaned) return;
    emit({
      type: "sourceStatus",
      sourceUrl,
      sourceName,
      message: `${formatCheckTime(Date.now() - startedAt)} ${cleaned}`,
    });
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (cancelled) return Promise.reject(new CheckCancelledError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      action();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`${label}超时`)));
    }, ms);
    const poll = setInterval(() => {
      if (cancelled) finish(() => reject(new CheckCancelledError()));
    }, 50);
    promise.then(
      (v) => finish(() => resolve(v)),
      (e) => finish(() => reject(e)),
    );
  });
}

function isTimeoutError(e: unknown): boolean {
  return e instanceof Error && /超时$/.test(e.message);
}

function isScriptError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const name = e.name || "";
  const msg = e.message || "";
  return (
    /Script/i.test(name) ||
    /JavaScript/i.test(name) ||
    /Rhino/i.test(name) ||
    /js\s*失效/i.test(msg) ||
    /SyntaxError/i.test(name) ||
    /ReferenceError/i.test(name) ||
    (/TypeError/i.test(name) && /java\.|source\.|eval/i.test(msg))
  );
}

function throwIfCancelled(): void {
  if (cancelled) throw new CheckCancelledError();
}

async function checkBook(
  item: SearchBookItem,
  source: BookSourceRecord,
  isSearchBook: boolean,
  report: StatusReporter,
): Promise<BookSourceRecord> {
  let next = source;
  const bookType = isSearchBook ? "搜索" : "发现";
  try {
    if (!config.checkInfo) return next;

    throwIfCancelled();
    let tocUrl = "";
    let bookUrl = item.bookUrl;
    let name = item.name;
    let author = item.author;

    report("┌获取目录链接");
    const detailLogs: string[] = [];
    let detail = await getBookInfo(
      source,
      bookUrl,
      name,
      author,
      detailLogs,
      {
        kind: item.kind,
        wordCount: item.wordCount,
        intro: item.intro,
        lastChapter: item.lastChapter,
        coverUrl: item.coverUrl,
      },
    );
    tocUrl = detail.tocUrl?.trim() || detail.bookUrl || bookUrl;
    bookUrl = detail.bookUrl || bookUrl;
    name = detail.name || name;
    author = detail.author || author;
    detail = {
      ...detail,
      tocUrl,
      bookUrl,
      name,
      author,
    };

    if (!config.checkCategory) return next;

    throwIfCancelled();
    report("┌获取目录");
    const tocLogs: string[] = [];
    const toc = await getChapterList(source, detail, tocLogs);
    const chapters = toc
      .filter((ch) => !(ch.isVolume && ch.url.startsWith(ch.title)))
      .slice(0, 2);
    if (!chapters.length) {
      throw new TocEmptyError();
    }
    if (!config.checkContent) return next;

    throwIfCancelled();
    report("┌获取正文");
    const first = chapters[0]!;
    const nextChapterUrl = chapters[1]?.url ?? first.url;
    const contentLogs: string[] = [];
    const content = await getChapterContent(
      source,
      first.url,
      detail,
      { title: first.title, url: first.url },
      contentLogs,
      nextChapterUrl,
    );
    if (!content?.trim()) {
      throw new ContentEmptyError();
    }
    next = removeBookSourceGroups(next, `${bookType}目录失效`);
    next = removeBookSourceGroups(next, `${bookType}正文失效`);
    return next;
  } catch (e) {
    if (e instanceof ContentEmptyError) {
      return addBookSourceGroups(next, `${bookType}正文失效`);
    }
    if (e instanceof TocEmptyError) {
      return addBookSourceGroups(next, `${bookType}目录失效`);
    }
    throw e;
  }
}

async function doCheckSource(
  source: BookSourceRecord,
  report: StatusReporter,
): Promise<BookSourceRecord> {
  throwIfCancelled();
  let next = removeErrorComment(removeInvalidGroups(source));

  if (config.checkSearch) {
    const searchWord = getCheckKeyword(source, config.keyword);
    if (source.searchUrl?.trim()) {
      next = removeBookSourceGroups(next, "搜索链接规则为空");
      throwIfCancelled();
      report("┌获取书籍列表");
      const logs: string[] = [];
      const searchBooks = await searchBook(source, searchWord, 1, logs);
      if (!searchBooks.length) {
        next = addBookSourceGroups(next, "搜索失效");
      } else {
        next = removeBookSourceGroups(next, "搜索失效");
        throwIfCancelled();
        report("┌获取详情页链接");
        next = await checkBook(searchBooks[0]!, next, true, report);
      }
    } else {
      next = addBookSourceGroups(next, "搜索链接规则为空");
    }
  }

  if (config.checkDiscovery && source.exploreUrl?.trim()) {
    throwIfCancelled();
    report("┌解析发现");
    const kinds = await getExploreKinds(source);
    const url = kinds.find((k) => k.url?.trim())?.url;
    if (!url?.trim()) {
      next = addBookSourceGroups(next, "发现规则为空");
    } else {
      next = removeBookSourceGroups(next, "发现规则为空");
      throwIfCancelled();
      report("┌获取发现列表");
      const logs: string[] = [];
      const exploreBooks = await exploreBook(source, url, 1, logs);
      if (!exploreBooks.length) {
        next = addBookSourceGroups(next, "发现失效");
      } else {
        next = removeBookSourceGroups(next, "发现失效");
        throwIfCancelled();
        report("┌获取详情页链接");
        next = await checkBook(exploreBooks[0]!, next, false, report);
      }
    }
  }

  const finalCheckMessage = getInvalidGroupNames(next);
  if (finalCheckMessage) {
    throw new CheckFailError(finalCheckMessage, next);
  }
  return next;
}

async function checkOneSource(
  sourceUrl: string,
  emit: (ev: CheckSourceEvent) => void,
): Promise<{
  source: BookSourceRecord;
  ok: boolean;
  message: string;
  respondTime: number;
}> {
  const started = Date.now();
  const original = getBookSource(sourceUrl);
  if (!original) {
    return {
      source: {
        bookSourceUrl: sourceUrl,
        bookSourceName: sourceUrl,
        bookSourceType: 0,
      },
      ok: false,
      message: `${formatCheckTime(0)} 校验失败:书源不存在`,
      respondTime: config.timeout,
    };
  }

  const sourceName = original.bookSourceName || sourceUrl;
  const report = createStatusReporter(sourceUrl, sourceName, started, emit);
  report("开始校验");

  try {
    const checked = await withTimeout(
      doCheckSource(original, report),
      config.timeout,
      "校验",
    );
    const spending = Date.now() - started;
    const saved = { ...checked, respondTime: spending };
    saveBookSource(saved);
    return {
      source: saved,
      ok: true,
      message: `${formatCheckTime(spending)} 校验成功`,
      respondTime: spending,
    };
  } catch (e) {
    const spending = Date.now() - started;
    if (e instanceof CheckCancelledError || cancelled) {
      throw e instanceof CheckCancelledError ? e : new CheckCancelledError();
    }
    let next = e instanceof CheckFailError ? e.source : original;
    if (isTimeoutError(e) || /超时/.test(e instanceof Error ? e.message : "")) {
      next = addBookSourceGroups(next, "校验超时");
    } else if (isScriptError(e)) {
      next = addBookSourceGroups(next, "js失效");
    } else if (!(e instanceof CheckFailError)) {
      next = addBookSourceGroups(next, "网站失效");
    }
    const msg = e instanceof Error ? e.message : String(e);
    next = addErrorComment(next, msg);
    const respondTime = config.timeout + spending;
    next = { ...next, respondTime };
    saveBookSource(next);
    return {
      source: next,
      ok: false,
      message: `${formatCheckTime(spending)} 校验失败:${msg}`,
      respondTime,
    };
  }
}

export function startCheckSource(
  sourceUrls: string[],
  emit: (ev: CheckSourceEvent) => void,
  options?: { keyword?: string },
): { ok: true } | { ok: false; message: string } {
  if (running) {
    return { ok: false, message: "已有书源在校验,等完成后再试" };
  }
  const urls = sourceUrls.filter((u) => typeof u === "string" && u.trim());
  if (!urls.length) {
    return { ok: false, message: "未选择书源" };
  }
  if (options?.keyword?.trim()) {
    config.keyword = options.keyword.trim();
  }

  running = true;
  cancelled = false;
  const total = urls.length;
  let completed = 0;
  let cursor = 0;

  void (async () => {
    try {
      const workers = Array.from(
        { length: Math.min(clampConcurrency(config.concurrency), urls.length) },
        async () => {
          while (cursor < urls.length) {
            if (cancelled) return;
            const sourceUrl = urls[cursor++]!;
            const source = getBookSource(sourceUrl);
            const sourceName = source?.bookSourceName ?? sourceUrl;
            let result: Awaited<ReturnType<typeof checkOneSource>>;
            try {
              result = await checkOneSource(sourceUrl, emit);
            } catch (e) {
              if (e instanceof CheckCancelledError) return;
              throw e;
            }
            completed += 1;
            emit({
              type: "sourceDone",
              sourceUrl: result.source.bookSourceUrl,
              sourceName: result.source.bookSourceName || sourceName,
              ok: result.ok,
              message: result.message,
              bookSourceGroup: result.source.bookSourceGroup,
              respondTime: result.respondTime,
            });
            emit({
              type: "progress",
              completed,
              total,
              sourceUrl: result.source.bookSourceUrl,
              sourceName: result.source.bookSourceName || sourceName,
              message: result.message,
            });
          }
        },
      );
      await Promise.all(workers);
      emit({
        type: "done",
        cancelled,
        completed,
        total,
      });
    } catch (e) {
      console.error("[checkSource]", e);
      emit({
        type: "done",
        cancelled: true,
        completed,
        total,
      });
    } finally {
      running = false;
    }
  })();

  return { ok: true };
}
