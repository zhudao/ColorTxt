/** 通义 TTS 全局限流：避免多段并行预取触发 HTTP 429 */

const MIN_INTERVAL_MS = 280;
const MAX_ATTEMPTS = 5;

let tail: Promise<void> = Promise.resolve();
let lastStartedAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 502;
}

function isRetryableFetchError(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|network|ECONNRESET|ETIMEDOUT|socket/i.test(msg);
}

export async function withDashScopeSynthSlot<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const prev = tail;
  let release!: () => void;
  tail = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastStartedAt);
    if (wait > 0) await sleep(wait);
    lastStartedAt = Date.now();
    return await fn();
  } finally {
    release();
  }
}

export async function fetchDashScopeTts(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  return withDashScopeSynthSlot(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) throw new Error("interrupted");
      if (attempt > 0) {
        const backoff = Math.min(8000, 400 * 2 ** attempt);
        await sleep(backoff);
      }
      try {
        const resp = await fetch(url, { ...init, signal });
        if (isRetryableStatus(resp.status)) {
          lastErr = new Error(`通义语音合成 HTTP ${resp.status}`);
          if (attempt < MAX_ATTEMPTS - 1) continue;
          throw new Error(
            `通义语音合成 HTTP ${resp.status}（请求过于频繁，请稍后重试）`,
          );
        }
        return resp;
      } catch (err) {
        if (signal.aborted) throw new Error("interrupted");
        lastErr = err;
        if (attempt < MAX_ATTEMPTS - 1 && isRetryableFetchError(err)) {
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("通义语音合成失败");
  });
}
