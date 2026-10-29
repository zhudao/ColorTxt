import { app } from "electron";
import { existsSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { CreateMainWindow } from "./windowFactory";
import { isSupportedShellOpenPath } from "../shared/ebookExtensions";
import { openTxtInMainWindow } from "./openTxtInMainWindow";

type SetupLaunchTxtHandlersOptions = {
  createWindow: CreateMainWindow;
  findBookWindowByWindowId: Map<number, boolean>;
  mainWindowFocusState: { lastId: number | null };
  /** 返回 true 表示已处理（跳过默认「开主窗 / 开 txt」） */
  onSecondInstance?: (argv: string[]) => boolean;
};

type LaunchTxtHandlerApi = {
  resolveLaunchTxtForStartup: (argv: string[]) => string | null;
  openRemainingMacPendingTxtPaths: () => void;
};

function getTxtPathFromArgv(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith("-")) continue;
    if (!isSupportedShellOpenPath(arg)) continue;
    try {
      if (!existsSync(arg)) continue;
      const s = statSync(arg);
      if (s.isFile()) return path.resolve(arg);
    } catch {
      continue;
    }
  }
  return null;
}

export function setupLaunchTxtHandlers(
  options: SetupLaunchTxtHandlersOptions,
): LaunchTxtHandlerApi {
  const {
    createWindow,
    findBookWindowByWindowId,
    mainWindowFocusState,
    onSecondInstance,
  } = options;
  const macPendingTxtPaths: string[] = [];

  async function focusAndOpenTxtPath(filePath: string) {
    const resolved = path.resolve(filePath);
    try {
      const st = await stat(resolved);
      if (!st.isFile() || !isSupportedShellOpenPath(resolved)) return;
    } catch {
      return;
    }

    // 始终路由到主阅读窗口（排除找书窗）；无主窗则新建
    openTxtInMainWindow({
      filePath: resolved,
      createWindow,
      findBookWindowByWindowId,
      mainWindowFocusState,
    });
  }

  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
  } else {
    app.on("second-instance", (_event, argv) => {
      if (onSecondInstance?.(argv)) {
        app.focus({ steal: true });
        return;
      }
      const fromArgv = getTxtPathFromArgv(argv);
      if (fromArgv) {
        void focusAndOpenTxtPath(fromArgv);
        app.focus({ steal: true });
        return;
      }
      createWindow();
      app.focus({ steal: true });
    });
  }

  if (process.platform === "darwin") {
    app.on("open-file", (event, filePath) => {
      event.preventDefault();
      if (!isSupportedShellOpenPath(filePath)) return;
      if (app.isReady()) {
        void focusAndOpenTxtPath(filePath);
      } else {
        macPendingTxtPaths.push(filePath);
      }
    });
  }

  return {
    resolveLaunchTxtForStartup(argv: string[]) {
      const fromArgv = getTxtPathFromArgv(argv);
      const fromMac = macPendingTxtPaths.shift() ?? null;
      return fromArgv ?? fromMac;
    },
    openRemainingMacPendingTxtPaths() {
      for (const p of macPendingTxtPaths) {
        void focusAndOpenTxtPath(p);
      }
      macPendingTxtPaths.length = 0;
    },
  };
}
