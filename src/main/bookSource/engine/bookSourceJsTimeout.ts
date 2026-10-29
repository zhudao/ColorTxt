import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 同步 JS 的 CPU 超时（vm.runInContext timeout）：防死循环脚本阻塞主进程。
 * 勿调大——同步执行期间主进程完全卡死。
 */
export const BOOK_SOURCE_JS_TIMEOUT_MS = (() => {
  const raw = process.env.BOOK_SOURCE_JS_TIMEOUT_MS?.trim();
  if (raw && /^\d+$/.test(raw)) return Math.max(50, Number(raw));
  return 30_000;
})();

/**
 * 异步 JS 的墙钟超时（java.ajax 链等网络等待为主，不阻塞主进程）。
 * 须显著大于 CPU 超时：部分书源发现页 bookList 会对几十本书串行补拉详情，
 * Legado/Rhino 无整段 JS 超时（只有单请求超时），30s 会把仍在正常等网络的
 * 规则掐死（串行补拉超时 → 分类永远「加载失败」）。
 * 搜索仍由 searchService 的单源 30s 兜底，不受此值影响。
 */
export const BOOK_SOURCE_JS_WALL_TIMEOUT_MS = (() => {
  const raw = process.env.BOOK_SOURCE_JS_WALL_TIMEOUT_MS?.trim();
  if (raw && /^\d+$/.test(raw)) return Math.max(50, Number(raw));
  return 180_000;
})();

export class BookSourceJsTimeoutError extends Error {
  constructor(message = "书源 JS 执行超时") {
    super(message);
    this.name = "BookSourceJsTimeoutError";
  }
}

export function isBookSourceJsTimeoutError(e: unknown): boolean {
  if (e instanceof BookSourceJsTimeoutError) return true;
  if (!(e instanceof Error)) return false;
  return (
    e.name === "BookSourceJsTimeoutError" ||
    /Script execution timed out/i.test(e.message) ||
    e.message.includes("书源 JS 执行超时")
  );
}

type DeadlineState = {
  deadlineAt: number;
  timedOut: boolean;
};

const deadlineStorage = new AsyncLocalStorage<DeadlineState>();

export function isJsEvalDeadlineExpired(): boolean {
  const state = deadlineStorage.getStore();
  if (!state) return false;
  if (state.timedOut) return true;
  if (Date.now() >= state.deadlineAt) {
    state.timedOut = true;
    return true;
  }
  return false;
}

/** 超时后后续 java.ajax 等异步入口立即失败，避免孤儿请求继续打出去 */
export function assertJsEvalAlive(): void {
  if (isJsEvalDeadlineExpired()) {
    throw new BookSourceJsTimeoutError();
  }
}

export function markJsEvalTimedOut(): void {
  const state = deadlineStorage.getStore();
  if (state) state.timedOut = true;
}

/** 同步求值期间挂载 deadline */
export function runWithJsEvalDeadline<T>(
  fn: () => T,
  timeoutMs: number = BOOK_SOURCE_JS_TIMEOUT_MS,
): T {
  const state: DeadlineState = {
    deadlineAt: Date.now() + Math.max(1, timeoutMs),
    timedOut: false,
  };
  return deadlineStorage.run(state, fn);
}

/** 异步求值期间挂载 deadline（await 链内仍可 assertAlive）；默认墙钟超时 */
export async function runWithJsEvalDeadlineAsync<T>(
  fn: () => Promise<T>,
  timeoutMs: number = BOOK_SOURCE_JS_WALL_TIMEOUT_MS,
): Promise<T> {
  const state: DeadlineState = {
    deadlineAt: Date.now() + Math.max(1, timeoutMs),
    timedOut: false,
  };
  return deadlineStorage.run(state, () => fn());
}

/** 墙钟超时：异步整段求值失败后向上抛出，并标记 deadline 已过期 */
export function raceWithJsTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = BOOK_SOURCE_JS_WALL_TIMEOUT_MS,
): Promise<T> {
  // 超时赢得 race 后，原 promise 稍后的 reject 无人消费会打 UnhandledPromiseRejection
  promise.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      markJsEvalTimedOut();
      reject(new BookSourceJsTimeoutError());
    }, Math.max(1, timeoutMs));
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** 规范化 vm timeout 抛出的错误文案 */
export function toBookSourceJsTimeoutError(e: unknown): Error {
  if (e instanceof BookSourceJsTimeoutError) return e;
  if (e instanceof Error && /Script execution timed out/i.test(e.message)) {
    return new BookSourceJsTimeoutError();
  }
  return e instanceof Error ? e : new Error(String(e));
}
