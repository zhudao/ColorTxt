import { AI_REQUEST_MAX_RETRIES, isRetryableAiRequestError } from "@shared/aiRequestRetry";
import { sleepAbortable } from "../shared/sleep";

export { AI_REQUEST_MAX_RETRIES, isRetryableAiRequestError };

const RETRY_DELAYS_MS = [2000, 4000, 8000];

export type WithAiRequestRetriesOpts<T> = {
  maxRetries?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, maxRetries: number, err: unknown) => void;
  run: () => Promise<T>;
};

export async function withAiRequestRetries<T>(
  opts: WithAiRequestRetriesOpts<T>,
): Promise<T> {
  const maxRetries = opts.maxRetries ?? AI_REQUEST_MAX_RETRIES;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await opts.run();
    } catch (e) {
      lastErr = e;
      if (opts.signal?.aborted) throw e;
      if (attempt >= maxRetries || !isRetryableAiRequestError(e)) throw e;
      opts.onRetry?.(attempt + 1, maxRetries, e);
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!;
      await sleepAbortable(delay, opts.signal);
    }
  }
  throw lastErr;
}
