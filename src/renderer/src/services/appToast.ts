import { reactive } from "vue";

export type AppToastKind =
  | "none"
  | "success"
  | "warning"
  | "danger"
  | "primary"
  | "info";

export type AppToastItem = {
  id: number;
  message: string;
  kind: AppToastKind;
  showClose: boolean;
};

export type AppToastOptions = {
  /**
   * 视觉类型。默认 `none`（无图标，普通前景色）。
   * 书源 `java.toast` / `java.longToast` 无类型参数，走默认 `none`；
   * 需要提示语义时须显式传入 `info` / `success` / `warning` / `danger` / `primary`。
   */
  kind?: AppToastKind;
  /** 为 `true` 时在右侧显示关闭按钮，可提前关闭 */
  showClose?: boolean;
  /**
   * 自动关闭延迟（毫秒）。默认 3000。
   * 传入 `0` 表示不自动关闭（需调用 `dismissAppToast`，或在 `showClose: true` 时点击关闭）。
   */
  duration?: number;
};

const DEFAULT_DURATION_MS = 3000;

export const appToastItems = reactive<AppToastItem[]>([]);

let idSeq = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function dismissAppToast(id: number): void {
  const t = timers.get(id);
  if (t !== undefined) {
    clearTimeout(t);
    timers.delete(id);
  }
  const i = appToastItems.findIndex((x) => x.id === id);
  if (i >= 0) appToastItems.splice(i, 1);
}

/**
 * 顶部弱提示：与 `appAlert` 类似的随处调用方式，无阻塞蒙层。
 * @returns 该条 toast 的 id，可用于 `dismissAppToast` 提前关闭。
 */
export function appToast(message: string, options?: AppToastOptions): number {
  const id = ++idSeq;
  const kind = options?.kind ?? "none";
  const duration = options?.duration ?? DEFAULT_DURATION_MS;
  const showClose = options?.showClose === true;
  appToastItems.push({ id, message, kind, showClose });
  if (duration > 0) {
    const t = setTimeout(() => dismissAppToast(id), duration);
    timers.set(id, t);
  }
  return id;
}

export function clearAllAppToasts(): void {
  for (const id of [...timers.keys()]) {
    const t = timers.get(id);
    if (t !== undefined) clearTimeout(t);
    timers.delete(id);
  }
  appToastItems.splice(0, appToastItems.length);
}
