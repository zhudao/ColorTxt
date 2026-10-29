export type PomodoroSettings = {
  enabled: boolean;
  /** 阅读时长（分钟） */
  focusMinutes: number;
  /** 短休息（分钟） */
  shortBreakMinutes: number;
  /** 长休息（分钟） */
  longBreakMinutes: number;
};

export const defaultPomodoroEnabled = true;
export const defaultPomodoroFocusMinutes = 25;
export const defaultPomodoroShortBreakMinutes = 5;
export const defaultPomodoroLongBreakMinutes = 15;

export const minPomodoroMinutes = 1;
export const maxPomodoroMinutes = 180;

/** 每完成若干轮阅读时长后进入长休息 */
export const pomodoroLongBreakEvery = 4;

export const defaultPomodoroSettings: PomodoroSettings = {
  enabled: defaultPomodoroEnabled,
  focusMinutes: defaultPomodoroFocusMinutes,
  shortBreakMinutes: defaultPomodoroShortBreakMinutes,
  longBreakMinutes: defaultPomodoroLongBreakMinutes,
};

export function clampPomodoroMinutes(v: number): number {
  if (!Number.isFinite(v)) return defaultPomodoroFocusMinutes;
  return Math.max(
    minPomodoroMinutes,
    Math.min(maxPomodoroMinutes, Math.floor(v)),
  );
}

export function mergePomodoroSettings(
  partial: Partial<PomodoroSettings> | null | undefined,
): PomodoroSettings {
  return {
    enabled:
      typeof partial?.enabled === "boolean"
        ? partial.enabled
        : defaultPomodoroEnabled,
    focusMinutes: clampPomodoroMinutes(
      partial?.focusMinutes ?? defaultPomodoroFocusMinutes,
    ),
    shortBreakMinutes: clampPomodoroMinutes(
      partial?.shortBreakMinutes ?? defaultPomodoroShortBreakMinutes,
    ),
    longBreakMinutes: clampPomodoroMinutes(
      partial?.longBreakMinutes ?? defaultPomodoroLongBreakMinutes,
    ),
  };
}
