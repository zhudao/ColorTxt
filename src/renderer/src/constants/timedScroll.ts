export type TimedScrollRange = "screen" | "line";

export type TimedScrollSettings = {
  range: TimedScrollRange;
  intervalMs: number;
};

export const TIMED_SCROLL_RANGE_OPTIONS: {
  id: TimedScrollRange;
  label: string;
}[] = [
  { id: "screen", label: "一页" },
  { id: "line", label: "一行" },
];

export const defaultTimedScrollRange: TimedScrollRange = "screen";
export const defaultTimedScrollIntervalMs = 3000;
export const minTimedScrollIntervalMs = 200;
export const maxTimedScrollIntervalMs = 600_000;

export const defaultTimedScrollSettings: TimedScrollSettings = {
  range: defaultTimedScrollRange,
  intervalMs: defaultTimedScrollIntervalMs,
};

export function timedScrollRangeLabel(range: TimedScrollRange): string {
  return (
    TIMED_SCROLL_RANGE_OPTIONS.find((o) => o.id === range)?.label ?? "一屏"
  );
}

export function clampTimedScrollIntervalMs(v: number): number {
  if (!Number.isFinite(v)) return defaultTimedScrollIntervalMs;
  return Math.max(
    minTimedScrollIntervalMs,
    Math.min(maxTimedScrollIntervalMs, Math.floor(v)),
  );
}

export function mergeTimedScrollSettings(
  partial: Partial<TimedScrollSettings> | null | undefined,
): TimedScrollSettings {
  const range =
    partial?.range === "line" || partial?.range === "screen"
      ? partial.range
      : defaultTimedScrollRange;
  return {
    range,
    intervalMs: clampTimedScrollIntervalMs(
      partial?.intervalMs ?? defaultTimedScrollIntervalMs,
    ),
  };
}
