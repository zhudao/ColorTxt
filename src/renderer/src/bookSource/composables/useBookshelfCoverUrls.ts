import { ref, watch, type Ref } from "vue";
import type { SearchBookItem } from "@shared/bookSource/types";
import { updateFindBookBookshelfCover } from "../findBookBookshelf";

/** 多源大列表时限制同时代理解析的封面数，避免打满网络 / IPC */
const DEFAULT_MAX_CONCURRENT = 4;
/** 瞬时失败（超时等）后最短再试间隔 */
const SOFT_RETRY_BASE_MS = 1500;
const SOFT_RETRY_MAX = 3;

/** 需走主进程代理解析的封面（直链常被防盗链，应用内须带书源 headers） */
function shouldResolveCover(item: SearchBookItem): boolean {
  const url = item.coverUrl?.trim();
  if (!url) return true;
  if (url.startsWith("data:")) return false;
  if (url.startsWith("colortxt-local:")) return true;
  return /^https?:\/\//i.test(url);
}

function inferCoverSourceUrl(item: SearchBookItem): string | undefined {
  const source = item.coverSourceUrl?.trim();
  if (source) return source;
  const url = item.coverUrl?.trim();
  if (url && /^https?:\/\//i.test(url)) return url;
  return undefined;
}

function normalizeVisibleIds(
  raw: ReadonlySet<string> | readonly string[] | null | undefined,
): Set<string> | null {
  if (raw == null) return null;
  if (raw instanceof Set) return raw;
  return new Set(raw);
}

export type UseBookshelfCoverUrlsOptions = {
  /**
   * 仅解析这些 id（VirtualList 可见窗）。
   * 不传 / 为 null：解析 `books` 全部（书架等小列表）。
   */
  visibleIds?: Ref<ReadonlySet<string> | readonly string[] | null | undefined>;
  maxConcurrent?: number;
};

/**
 * 书架 / 搜索 / 发现：异步解析可展示封面。
 * - 解析中：无 URL、pending=true → 列表显示占位，不用默认封面
 * - 成功：返回代理 URL
 * - 硬失败（空结果 / 重试耗尽）：failed → 列表再用默认封面兜底
 * - 软失败（异常）：冷却后可对可见项再试
 */
export function useBookshelfCoverUrls(
  books: Ref<readonly SearchBookItem[]>,
  options?: UseBookshelfCoverUrlsOptions,
) {
  const coverUrls = ref<Record<string, string>>({});
  const failedIds = ref<Record<string, true>>({});
  const pendingIds = ref<Record<string, true>>({});
  const resolvingIds = new Set<string>();
  const queuedIds = new Set<string>();
  const queue: string[] = [];
  let activeCount = 0;
  const softFailCount = new Map<string, number>();
  const softRetryAfter = new Map<string, number>();
  let softRetryTimer: ReturnType<typeof setTimeout> | null = null;

  const maxConcurrent = options?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const booksById = new Map<string, SearchBookItem>();

  function setPending(id: string, on: boolean) {
    if (on) {
      if (pendingIds.value[id]) return;
      pendingIds.value = { ...pendingIds.value, [id]: true };
      return;
    }
    if (!pendingIds.value[id]) return;
    const next = { ...pendingIds.value };
    delete next[id];
    pendingIds.value = next;
  }

  function syncBooksIndex() {
    booksById.clear();
    for (const item of books.value) {
      booksById.set(item.id, item);
    }
  }

  function currentVisibleSet(): Set<string> | null {
    return normalizeVisibleIds(options?.visibleIds?.value);
  }

  function isSoftCooling(id: string): boolean {
    const until = softRetryAfter.get(id);
    return until != null && until > Date.now();
  }

  function scheduleSoftRetryWake() {
    if (softRetryTimer != null) return;
    let nextAt = Infinity;
    for (const t of softRetryAfter.values()) {
      if (t < nextAt) nextAt = t;
    }
    if (!Number.isFinite(nextAt)) return;
    const delay = Math.max(50, nextAt - Date.now());
    softRetryTimer = setTimeout(() => {
      softRetryTimer = null;
      const now = Date.now();
      for (const [id, t] of softRetryAfter) {
        if (t <= now) softRetryAfter.delete(id);
      }
      scheduleVisibleCovers();
      scheduleSoftRetryWake();
    }, delay);
  }

  function enqueueId(id: string, preferFront: boolean) {
    if (
      !booksById.has(id) ||
      coverUrls.value[id] ||
      failedIds.value[id] ||
      resolvingIds.has(id) ||
      queuedIds.has(id) ||
      isSoftCooling(id)
    ) {
      return;
    }
    queuedIds.add(id);
    if (preferFront) queue.unshift(id);
    else queue.push(id);
  }

  function takeNextId(visible: Set<string> | null): string | undefined {
    if (visible && visible.size > 0) {
      const idx = queue.findIndex((id) => visible.has(id));
      if (idx >= 0) {
        const [id] = queue.splice(idx, 1);
        if (id) queuedIds.delete(id);
        return id;
      }
      // 队列里已无可见项：勿占用并发拉屏外封面
      return undefined;
    }
    const id = queue.shift();
    if (id) queuedIds.delete(id);
    return id;
  }

  function pump() {
    const visible = currentVisibleSet();
    while (activeCount < maxConcurrent) {
      const id = takeNextId(visible);
      if (!id) break;
      const item = booksById.get(id);
      if (!item) continue;
      if (coverUrls.value[id] || failedIds.value[id] || isSoftCooling(id)) {
        continue;
      }
      void runResolve(item);
    }
  }

  async function runResolve(item: SearchBookItem): Promise<void> {
    if (resolvingIds.has(item.id)) return;
    if (coverUrls.value[item.id] || failedIds.value[item.id]) return;

    if (!shouldResolveCover(item)) {
      const raw = item.coverUrl?.trim();
      if (raw) coverUrls.value = { ...coverUrls.value, [item.id]: raw };
      else failedIds.value = { ...failedIds.value, [item.id]: true };
      return;
    }

    resolvingIds.add(item.id);
    activeCount += 1;
    setPending(item.id, true);
    try {
      const res = await window.colorTxt.bookSourceResolveCoverDisplay({
        bookSourceUrl: item.origin,
        coverSourceUrl: inferCoverSourceUrl(item),
        coverUrl: item.coverUrl,
        bookUrl: item.bookUrl,
        name: item.name,
        author: item.author,
        kind: item.kind,
        wordCount: item.wordCount,
        intro: item.intro,
        lastChapter: item.lastChapter,
      });
      if (!res.coverUrl) {
        failedIds.value = { ...failedIds.value, [item.id]: true };
        softFailCount.delete(item.id);
        softRetryAfter.delete(item.id);
        return;
      }
      coverUrls.value = { ...coverUrls.value, [item.id]: res.coverUrl };
      softFailCount.delete(item.id);
      softRetryAfter.delete(item.id);
      updateFindBookBookshelfCover(item.bookUrl, item.origin, {
        coverUrl: res.coverUrl,
        coverSourceUrl: res.coverSourceUrl ?? inferCoverSourceUrl(item),
      });
    } catch {
      const n = (softFailCount.get(item.id) ?? 0) + 1;
      softFailCount.set(item.id, n);
      if (n >= SOFT_RETRY_MAX) {
        failedIds.value = { ...failedIds.value, [item.id]: true };
        softRetryAfter.delete(item.id);
      } else {
        const until = Date.now() + SOFT_RETRY_BASE_MS * n;
        softRetryAfter.set(item.id, until);
        scheduleSoftRetryWake();
      }
    } finally {
      resolvingIds.delete(item.id);
      activeCount = Math.max(0, activeCount - 1);
      setPending(item.id, false);
      pump();
    }
  }

  function scheduleVisibleCovers() {
    syncBooksIndex();
    const visible = currentVisibleSet();
    if (visible == null) {
      for (const item of books.value) {
        enqueueId(item.id, false);
      }
    } else {
      for (const id of visible) {
        enqueueId(id, true);
      }
    }
    pump();
  }

  watch(
    () => {
      const ids = books.value.map((b) => b.id).join("\0");
      const vis = options?.visibleIds
        ? [...(normalizeVisibleIds(options.visibleIds.value) ?? [])].sort().join("\0")
        : "";
      return `${ids}\n${vis}`;
    },
    () => {
      scheduleVisibleCovers();
    },
    { immediate: true },
  );

  function getCoverUrl(item: SearchBookItem): string | undefined {
    if (failedIds.value[item.id]) return undefined;
    return coverUrls.value[item.id];
  }

  function isCoverPending(item: SearchBookItem): boolean {
    if (coverUrls.value[item.id] || failedIds.value[item.id]) return false;
    if (pendingIds.value[item.id] || resolvingIds.has(item.id)) return true;
    if (isSoftCooling(item.id)) return false;
    if (!shouldResolveCover(item)) return false;
    const visible = currentVisibleSet();
    if (visible != null && !visible.has(item.id)) return false;
    // 已进入调度范围、尚未 kick 的瞬时态也视为 pending（避免闪默认封面）
    return true;
  }

  async function retryCover(item: SearchBookItem): Promise<boolean> {
    const prev = getCoverUrl(item);
    const nextFailed = { ...failedIds.value };
    delete nextFailed[item.id];
    failedIds.value = nextFailed;
    const nextUrls = { ...coverUrls.value };
    delete nextUrls[item.id];
    coverUrls.value = nextUrls;
    softFailCount.delete(item.id);
    softRetryAfter.delete(item.id);
    syncBooksIndex();
    enqueueId(item.id, true);
    pump();
    // 等到本次解析离开 resolving（含排队）
    while (queuedIds.has(item.id) || resolvingIds.has(item.id)) {
      await new Promise((r) => setTimeout(r, 40));
    }
    const next = getCoverUrl(item);
    return Boolean(next && next !== prev);
  }

  return { getCoverUrl, isCoverPending, retryCover };
}
