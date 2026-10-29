import type { BookSourceRecord } from "@shared/bookSource/types";

type ConcurrentRecord = {
  time: number;
  accessLimit: number;
  interval: number;
  frequency: number;
};

const concurrentRecordMap = new Map<string, ConcurrentRecord>();

/**
 * 未配置 concurrentRate 时的默认并发上限。
 * Rhino 中 `list.map(() => java.ajax)` 实质串行；Node 升成 async map 后若无限制
 * 会同时打满列表项详情请求，易触发限流与 TimeoutError。
 */
const DEFAULT_MAX_INFLIGHT_PER_SOURCE = 3;

type InflightGate = {
  active: number;
  max: number;
  waiters: Array<() => void>;
};

const inflightGateMap = new Map<string, InflightGate>();

async function withInflightLimit<T>(
  key: string,
  max: number,
  block: () => Promise<T>,
): Promise<T> {
  let gate = inflightGateMap.get(key);
  if (!gate) {
    gate = { active: 0, max, waiters: [] };
    inflightGateMap.set(key, gate);
  } else if (gate.max !== max) {
    gate.max = max;
  }
  while (gate.active >= gate.max) {
    await new Promise<void>((resolve) => {
      gate!.waiters.push(resolve);
    });
  }
  gate.active += 1;
  try {
    return await block();
  } finally {
    gate.active -= 1;
    const next = gate.waiters.shift();
    if (next) next();
  }
}

export class ConcurrentException extends Error {
  waitTime: number;
  constructor(message: string, waitTime: number) {
    super(message);
    this.name = "ConcurrentException";
    this.waitTime = waitTime;
  }
}

function throughput(rate: string | null | undefined): number {
  if (!rate?.trim() || rate === "0") return Number.POSITIVE_INFINITY;
  try {
    const idx = rate.indexOf("/");
    if (idx > 0) {
      const limit = Number.parseFloat(rate.slice(0, idx));
      const ms = Number.parseFloat(rate.slice(idx + 1));
      if (limit <= 0 || ms <= 0) return Number.POSITIVE_INFINITY;
      return (limit * 1000) / ms;
    }
    const ms = Number.parseFloat(rate);
    if (ms <= 0) return Number.POSITIVE_INFINITY;
    return 1000 / ms;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function effectiveRate(rate1?: string | null, rate2?: string | null): string | null {
  const t1 = throughput(rate1);
  const t2 = throughput(rate2);
  if (t1 <= t2) return rate1?.trim() || null;
  return rate2?.trim() || null;
}

function buildRecord(rate: string): ConcurrentRecord {
  const rateIndex = rate.indexOf("/");
  if (rateIndex > 0) {
    const accessLimit = Number.parseInt(rate.slice(0, rateIndex), 10) || 1;
    const interval = Number.parseInt(rate.slice(rateIndex + 1), 10) || 0;
    return {
      time: Date.now(),
      accessLimit,
      interval,
      frequency: 1,
    };
  }
  return {
    time: Date.now(),
    accessLimit: 1,
    interval: Number.parseInt(rate, 10) || 0,
    frequency: 1,
  };
}

function recordToRate(record: ConcurrentRecord): string {
  return record.accessLimit > 1
    ? `${record.accessLimit}/${record.interval}`
    : String(record.interval);
}

/** Legado ConcurrentRateLimiter.updateConcurrentRate */
export function updateConcurrentRate(key: string, concurrentRate: string): void {
  try {
    const rateIndex = concurrentRate.indexOf("/");
    const next =
      rateIndex > 0
        ? (() => {
            const accessLimit = Number.parseInt(concurrentRate.slice(0, rateIndex), 10);
            const interval = Number.parseInt(concurrentRate.slice(rateIndex + 1), 10);
            if (accessLimit <= 0 || interval <= 0) throw new Error("invalid");
            const prev = concurrentRecordMap.get(key);
            return {
              time: prev?.time ?? Date.now(),
              accessLimit,
              interval,
              frequency: prev?.frequency ?? 0,
            } satisfies ConcurrentRecord;
          })()
        : (() => {
            const interval = Number.parseInt(concurrentRate, 10);
            if (interval <= 0) throw new Error("invalid");
            const prev = concurrentRecordMap.get(key);
            return {
              time: prev?.time ?? Date.now(),
              accessLimit: 1,
              interval,
              frequency: prev?.frequency ?? 0,
            } satisfies ConcurrentRecord;
          })();
    concurrentRecordMap.set(key, next);
  } catch {
    /* ignore invalid rate */
  }
}

function fetchStart(source?: BookSourceRecord): ConcurrentRecord | null {
  const sourceRate = source?.concurrentRate?.trim();
  if (!sourceRate || sourceRate === "0") return null;
  const key = source?.bookSourceUrl?.trim();
  if (!key) return null;

  let isNewRecord = false;
  const fetchRecord = (() => {
    const existing = concurrentRecordMap.get(key);
    if (!existing) {
      isNewRecord = true;
      const created = buildRecord(sourceRate);
      concurrentRecordMap.set(key, created);
      return created;
    }
    const recordRate = recordToRate(existing);
    if (recordRate !== sourceRate) {
      const effective = effectiveRate(sourceRate, recordRate);
      if (effective && effective !== recordRate) {
        isNewRecord = true;
        const created = buildRecord(effective);
        concurrentRecordMap.set(key, created);
        return created;
      }
    }
    return existing;
  })();

  if (isNewRecord) return fetchRecord;

  let waitTime = 0;
  const nextTime = fetchRecord.time + fetchRecord.interval;
  const nowTime = Date.now();
  if (nowTime >= nextTime) {
    fetchRecord.time = nowTime;
    fetchRecord.frequency = 1;
  } else if (fetchRecord.frequency < fetchRecord.accessLimit) {
    fetchRecord.frequency += 1;
  } else {
    waitTime = nextTime - nowTime;
  }

  if (waitTime > 0) {
    throw new ConcurrentException(
      `根据并发率还需等待${waitTime}毫秒才可以访问`,
      waitTime,
    );
  }
  return fetchRecord;
}

async function getConcurrentRecord(source?: BookSourceRecord): Promise<void> {
  while (true) {
    try {
      fetchStart(source);
      return;
    } catch (e) {
      if (e instanceof ConcurrentException) {
        await new Promise((r) => setTimeout(r, e.waitTime));
        continue;
      }
      throw e;
    }
  }
}

export class ConcurrentRateLimiter {
  constructor(private source?: BookSourceRecord) {}

  async withLimit<T>(block: () => Promise<T>): Promise<T> {
    await getConcurrentRecord(this.source);
    return block();
  }
}

export async function withSourceRateLimit<T>(
  source: BookSourceRecord | undefined,
  block: () => Promise<T>,
  skip = false,
): Promise<T> {
  if (skip || !source) return block();
  const rate = source.concurrentRate?.trim();
  if (rate && rate !== "0") {
    return new ConcurrentRateLimiter(source).withLimit(block);
  }
  const key = source.bookSourceUrl?.trim();
  if (!key) return block();
  return withInflightLimit(key, DEFAULT_MAX_INFLIGHT_PER_SOURCE, block);
}
