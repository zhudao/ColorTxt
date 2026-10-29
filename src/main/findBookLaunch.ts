import { app } from "electron";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { FIND_BOOK_WINDOW_TITLE } from "@shared/findBookWindowTitle";
import type { CreateMainWindow } from "./windowFactory";
import type { BrowserWindow } from "electron";

/** 桌面快捷方式 / CLI：仅打开找书窗口，不开主界面 */
export const FIND_BOOK_LAUNCH_FLAG = "--find-book";

export function argvHasFindBookFlag(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === FIND_BOOK_LAUNCH_FLAG);
}

export type FindBookInitialTab = "bookshelf" | "search";

export function resolveFindBookIconPath(): string {
  const fileName =
    process.platform === "win32" ? "icon_find.ico" : "icon_find.png";
  return app.isPackaged
    ? path.join(process.resourcesPath, fileName)
    : path.join(app.getAppPath(), "resources", fileName);
}

export function openFindBookLaunchWindow(
  createWindow: CreateMainWindow,
  initialTab: FindBookInitialTab = "bookshelf",
): BrowserWindow {
  return createWindow({
    openFindBook: true,
    findBookInitialTab: initialTab,
  });
}

/** 是否支持「生成桌面快捷方式」（Windows / Linux） */
export function supportsFindBookDesktopShortcut(): boolean {
  return process.platform === "win32" || process.platform === "linux";
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

async function createWindowsDesktopShortcut(): Promise<
  { ok: true; shortcutPath: string } | { ok: false; error: string }
> {
  const desktop = app.getPath("desktop");
  const shortcutPath = path.join(desktop, `${FIND_BOOK_WINDOW_TITLE}.lnk`);
  const iconPath = resolveFindBookIconPath();
  if (!existsSync(iconPath)) {
    return { ok: false, error: "找不到找书图标资源" };
  }

  const targetPath = process.execPath;
  const argumentsValue = app.isPackaged
    ? FIND_BOOK_LAUNCH_FLAG
    : `"${app.getAppPath().replace(/"/g, "")}" ${FIND_BOOK_LAUNCH_FLAG}`;
  const workingDirectory = app.isPackaged
    ? path.dirname(process.execPath)
    : app.getAppPath();

  const ps = `
$ErrorActionPreference = 'Stop'
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut('${escapePowerShellSingleQuoted(shortcutPath)}')
$Shortcut.TargetPath = '${escapePowerShellSingleQuoted(targetPath)}'
$Shortcut.Arguments = '${escapePowerShellSingleQuoted(argumentsValue)}'
$Shortcut.WorkingDirectory = '${escapePowerShellSingleQuoted(workingDirectory)}'
$Shortcut.IconLocation = '${escapePowerShellSingleQuoted(iconPath)}'
$Shortcut.Description = '${escapePowerShellSingleQuoted(FIND_BOOK_WINDOW_TITLE)}'
$Shortcut.Save()
`;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps],
      { windowsHide: true },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `PowerShell 退出码 ${code}`));
    });
  });

  if (!existsSync(shortcutPath)) {
    return { ok: false, error: "快捷方式未生成" };
  }
  return { ok: true, shortcutPath };
}

async function createLinuxDesktopShortcut(): Promise<
  { ok: true; shortcutPath: string } | { ok: false; error: string }
> {
  const desktop = app.getPath("desktop");
  const shortcutPath = path.join(desktop, `${FIND_BOOK_WINDOW_TITLE}.desktop`);
  const iconPath = resolveFindBookIconPath();
  if (!existsSync(iconPath)) {
    return { ok: false, error: "找不到找书图标资源" };
  }

  const execLine = app.isPackaged
    ? `"${process.execPath}" ${FIND_BOOK_LAUNCH_FLAG}`
    : `"${process.execPath}" "${app.getAppPath()}" ${FIND_BOOK_LAUNCH_FLAG}`;

  const body = [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${FIND_BOOK_WINDOW_TITLE}`,
    `Comment=${FIND_BOOK_WINDOW_TITLE}`,
    `Exec=${execLine}`,
    `Icon=${iconPath}`,
    "Terminal=false",
    "Categories=Office;Viewer;",
    "",
  ].join("\n");

  await writeFile(shortcutPath, body, "utf8");
  return { ok: true, shortcutPath };
}

/**
 * 在桌面创建「彩读找书」快捷方式。
 * Windows：.lnk；Linux：.desktop；macOS：不支持（桌面快捷方式不常见）。
 */
export async function createFindBookDesktopShortcut(): Promise<
  { ok: true; shortcutPath: string } | { ok: false; error: string }
> {
  try {
    if (!supportsFindBookDesktopShortcut()) {
      return {
        ok: false,
        error: "当前系统不支持创建桌面快捷方式",
      };
    }
    if (process.platform === "win32") {
      return await createWindowsDesktopShortcut();
    }
    return await createLinuxDesktopShortcut();
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
