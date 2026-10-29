import { reactive } from "vue";

export const appLoadingModel = reactive({
  open: false,
  /** 文案不含省略号；跳动点由 `AppLoadingHost` 渲染 */
  message: "请稍候",
});

let depth = 0;

/**
 * 全局 loading 蒙层（与 `appAlert` / `appToast` 同类，可随处调用）。
 * 支持嵌套：`show` / `close` 成对；`depth` 归零才真正关闭。
 */
export const appLoading = {
  show(message = "请稍候"): void {
    depth += 1;
    appLoadingModel.message = message.trim() || "请稍候";
    appLoadingModel.open = true;
  },

  /** 更新当前蒙层文案（不改变嵌套深度） */
  update(message: string): void {
    if (!appLoadingModel.open) return;
    appLoadingModel.message = message.trim() || "请稍候";
  },

  close(): void {
    depth = Math.max(0, depth - 1);
    if (depth === 0) {
      appLoadingModel.open = false;
    }
  },

  /** 强制关闭（忽略嵌套深度；异常恢复用） */
  closeAll(): void {
    depth = 0;
    appLoadingModel.open = false;
  },

  async with<T>(message: string, work: () => Promise<T>): Promise<T> {
    appLoading.show(message);
    try {
      return await work();
    } finally {
      appLoading.close();
    }
  },
};
