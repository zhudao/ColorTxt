import { randomUUID } from "node:crypto";

import type {
  BookSourceRecord,
  BookSourceSearchEvent,
  SearchBookItem,
} from "@shared/bookSource/types";
import { isTextBookSource } from "@shared/bookSource/types";

import { searchMatchTier, searchResultRelevance } from "@shared/bookSource/url";

import { searchBook } from "./engine/webBook";

import {
  getBookSource,
  listEnabledTextSources,
} from "./store/bookSourceStore";
import {
  hasActiveVerification,
  dismissAllActiveVerifications,
} from "./engine/sourceVerification";

const SOURCE_TIMEOUT_MS = 30_000;

/** 弹出验证窗口后延长等待（用户手动登录/过验证码） */
const SOURCE_TIMEOUT_VERIFY_MS = 600_000;

function raceSearchWithTimeout(
  sourceUrl: string,
  searchPromise: Promise<SearchBookItem[]>,
): Promise<SearchBookItem[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let deadline = Date.now() + SOURCE_TIMEOUT_MS;
    let verifyDeadlineExtended = false;

    const schedule = () => {
      if (settled) return;
      if (!verifyDeadlineExtended && hasActiveVerification(sourceUrl)) {
        verifyDeadlineExtended = true;
        deadline = Date.now() + SOURCE_TIMEOUT_VERIFY_MS;
      }
      const remain = deadline - Date.now();
      if (remain <= 0) {
        settled = true;
        reject(new Error("超时"));
        return;
      }
      setTimeout(schedule, Math.min(remain, 800));
    };

    schedule();
    void searchPromise.then(
      (v) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      },
      (e) => {
        if (!settled) {
          settled = true;
          reject(e);
        }
      },
    );
  });
}

const SOURCE_CONCURRENCY = 4;

const RESULT_EMIT_INTERVAL_MS = 300;

/** 对齐 Legado precisionSearch 默认关闭：信任书源搜索 API 返回的列表 */
const DEFAULT_PRECISION_SEARCH = false;

type SearchOptions = {
  sourceUrls?: string[];
  precisionSearch?: boolean;
};

/**
 * 解析本次搜索参与的书源：
 * - 未限定：仅启用且配置了 searchUrl 的文本源
 * - 限定 sourceUrls：按 URL 取源，**不要求 enabled**（特指搜索某源时应可用）
 */
function resolveSearchSources(options?: SearchOptions): BookSourceRecord[] {
  const scope = options?.sourceUrls?.filter((u) => typeof u === "string" && u.trim());
  if (scope?.length) {
    const out: BookSourceRecord[] = [];
    const seen = new Set<string>();
    for (const url of scope) {
      if (seen.has(url)) continue;
      seen.add(url);
      const source = getBookSource(url);
      if (!source || !isTextBookSource(source)) continue;
      if (!source.searchUrl?.trim()) continue;
      out.push(source);
    }
    return out;
  }
  return listEnabledTextSources().filter((s) => s.searchUrl?.trim());
}

type SourceSearchState = {
  nextPage: number;
  hasMore: boolean;
};

type SearchSession = {
  id: string;
  cancelled: boolean;
  loadingMore: boolean;
  emit: (ev: BookSourceSearchEvent) => void;
  key: string;
  precisionSearch: boolean;
  sources: BookSourceRecord[];
  results: SearchBookItem[];
  resultIds: Set<string>;
  sourceStates: Map<string, SourceSearchState>;
  lastResultEmit: number;
};

const sessions = new Map<string, SearchSession>();

function sessionHasMore(session: SearchSession): boolean {
  for (const state of session.sourceStates.values()) {
    if (state.hasMore) return true;
  }
  return false;
}

/** searchUrl 未含 {{page}} / <p1,p2> 等分页占位时，仅请求第一页 */
function searchUrlSupportsPagination(source: BookSourceRecord): boolean {
  const url = source.searchUrl?.trim() ?? "";
  if (!url) return false;
  if (/\{\{page\}\}/.test(url)) return true;
  if (/<[^>]*,[^>]*>/.test(url)) return true;
  if (/@js:|@Json:|@XPath:|@json:/i.test(url)) return true;
  return false;
}

function countAppendableItems(
  session: SearchSession,
  items: SearchBookItem[],
): number {
  let count = 0;
  for (const item of items) {
    const tier = searchMatchTier(item.name, item.author, session.key);
    if (session.precisionSearch && tier === "other") continue;
    if (session.resultIds.has(item.id)) continue;
    count++;
  }
  return count;
}

function initSourceState(
  session: SearchSession,
  source: BookSourceRecord,
  itemCount: number,
  failed: boolean,
): void {
  session.sourceStates.set(source.bookSourceUrl, {
    nextPage: 2,
    hasMore:
      !failed && itemCount > 0 && searchUrlSupportsPagination(source),
  });
}

function emitSortedResults(session: SearchSession, force = false): void {
  if (session.results.length === 0) return;

  const now = Date.now();
  if (!force && now - session.lastResultEmit < RESULT_EMIT_INTERVAL_MS) return;

  session.lastResultEmit = now;

  const items = [...session.results].sort(
    (a, b) =>
      searchResultRelevance(b.name, b.author, session.key) -
      searchResultRelevance(a.name, b.author, session.key),
  );

  session.emit({
    searchId: session.id,
    type: "result",
    items,
  });
}

/** 追加书源结果（不按书名+作者跨源合并，与 Legado 各源独立展示一致） */
function appendItems(session: SearchSession, items: SearchBookItem[]): void {
  for (const item of items) {
    const tier = searchMatchTier(item.name, item.author, session.key);
    if (session.precisionSearch && tier === "other") continue;
    if (session.resultIds.has(item.id)) continue;
    session.resultIds.add(item.id);
    session.results.push(item);
  }
  emitSortedResults(session, false);
}

async function searchOneSource(
  session: SearchSession,
  source: BookSourceRecord,
  page: number,
): Promise<{ items: SearchBookItem[]; logs: string[]; failed: boolean; error?: string }> {
  const logs: string[] = [];
  try {
    const items = await raceSearchWithTimeout(
      source.bookSourceUrl,
      searchBook(source, session.key, page, logs),
    );
    return { items, logs, failed: false };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { items: [], logs, failed: true, error };
  }
}

async function runInitialSearch(
  session: SearchSession,
  options?: SearchOptions,
): Promise<void> {
  const searchId = session.id;
  session.sources = resolveSearchSources(options);

  const total = session.sources.length;
  let completed = 0;

  session.emit({ searchId, type: "progress", completed: 0, total });

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(SOURCE_CONCURRENCY, session.sources.length) },
    async () => {
      while (cursor < session.sources.length) {
        if (session.cancelled) return;

        const source = session.sources[cursor++];
        const { items, logs, failed, error } = await searchOneSource(session, source, 1);

        if (!session.cancelled) {
          appendItems(session, items);
          initSourceState(session, source, items.length, failed);
        }

        const summary = failed
          ? `[${source.bookSourceName}] 搜索失败${error ? `: ${error}` : ""}`
          : `[${source.bookSourceName}] ${items.length} 条结果`;
        const outLogs = logs.length ? [...logs, summary] : [summary];

        session.emit({
          searchId,
          type: "sourceDone",
          sourceUrl: source.bookSourceUrl,
          sourceName: source.bookSourceName,
          itemCount: items.length,
          failed,
          ...(failed && error ? { error } : {}),
          logs: outLogs,
        });

        completed += 1;
        session.emit({ searchId, type: "progress", completed, total });
      }
    },
  );

  await Promise.all(workers);

  if (!session.cancelled) {
    emitSortedResults(session, true);
  }
  session.emit({
    searchId,
    type: "done",
    cancelled: session.cancelled,
    hasMore: sessionHasMore(session),
  });
}

async function runLoadMore(session: SearchSession): Promise<void> {
  const searchId = session.id;
  const pending = session.sources.filter((source) => {
    const state = session.sourceStates.get(source.bookSourceUrl);
    return state?.hasMore;
  });

  if (!pending.length || session.cancelled) {
    session.loadingMore = false;
    session.emit({
      searchId,
      type: "loadMoreDone",
      hasMore: sessionHasMore(session),
    });
    return;
  }

  const total = pending.length;
  let completed = 0;
  session.emit({ searchId, type: "loadMoreStart", total });
  session.emit({ searchId, type: "progress", completed: 0, total });

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(SOURCE_CONCURRENCY, pending.length) },
    async () => {
      while (cursor < pending.length) {
        if (session.cancelled) return;

        const source = pending[cursor++];
        const state = session.sourceStates.get(source.bookSourceUrl);
        if (!state?.hasMore) continue;

        const page = state.nextPage;
        const { items, failed } = await searchOneSource(session, source, page);

        if (session.cancelled) return;

        state.nextPage = page + 1;
        const newCount = countAppendableItems(session, items);
        if (items.length) appendItems(session, items);
        state.hasMore = !failed && newCount > 0;

        completed += 1;
        session.emit({ searchId, type: "progress", completed, total });
      }
    },
  );

  await Promise.all(workers);

  emitSortedResults(session, true);
  session.loadingMore = false;
  session.emit({
    searchId,
    type: "loadMoreDone",
    hasMore: sessionHasMore(session),
  });
}

export function cancelSearch(searchId: string): void {
  const s = sessions.get(searchId);
  if (s) {
    s.cancelled = true;
    dismissAllActiveVerifications();
    sessions.delete(searchId);
  }
}

export function startSearch(
  key: string,
  emit: (ev: BookSourceSearchEvent) => void,
  options?: SearchOptions,
): string {
  const searchId = randomUUID();
  const session: SearchSession = {
    id: searchId,
    cancelled: false,
    loadingMore: false,
    emit,
    key,
    precisionSearch: options?.precisionSearch ?? DEFAULT_PRECISION_SEARCH,
    sources: [],
    results: [],
    resultIds: new Set(),
    sourceStates: new Map(),
    lastResultEmit: 0,
  };

  sessions.set(searchId, session);

  setImmediate(() => {
    void runInitialSearch(session, options);
  });

  return searchId;
}

/** Legado 搜索列表上拉加载下一页 */
export function loadMoreSearch(searchId: string): boolean {
  const session = sessions.get(searchId);
  if (!session || session.cancelled || session.loadingMore) return false;
  if (!sessionHasMore(session)) return false;

  session.loadingMore = true;
  void runLoadMore(session);
  return true;
}
