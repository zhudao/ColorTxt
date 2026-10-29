import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 读不到用户终端配置时的平台回退族名（等宽）。 */
export function terminalFontFallbackFace(): string {
  if (process.platform === "darwin") return "Menlo";
  if (process.platform === "win32") return "Cascadia Mono";
  return "DejaVu Sans Mono";
}

function stripJsonComments(raw: string): string {
  return raw
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function pickFontFaceFromWtSettings(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  const profiles = root.profiles;
  if (!profiles || typeof profiles !== "object") return null;
  const defaults = (profiles as Record<string, unknown>).defaults;
  if (!defaults || typeof defaults !== "object") return null;
  const d = defaults as Record<string, unknown>;
  if (typeof d.fontFace === "string" && d.fontFace.trim()) {
    return d.fontFace.trim();
  }
  const font = d.font;
  if (font && typeof font === "object") {
    const face = (font as Record<string, unknown>).face;
    if (typeof face === "string" && face.trim()) return face.trim();
  }
  return null;
}

async function readWindowsTerminalFontFace(): Promise<string | null> {
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;
  const direct = path.join(local, "Microsoft", "Windows Terminal", "settings.json");
  try {
    const raw = await readFile(direct, "utf8");
    const face = pickFontFaceFromWtSettings(JSON.parse(stripJsonComments(raw)));
    if (face) return face;
  } catch {
    /* missing / invalid */
  }
  const packages = path.join(local, "Packages");
  try {
    const dirs = await readdir(packages);
    for (const name of dirs) {
      if (!name.startsWith("Microsoft.WindowsTerminal")) continue;
      const p = path.join(packages, name, "LocalState", "settings.json");
      try {
        const raw = await readFile(p, "utf8");
        const face = pickFontFaceFromWtSettings(JSON.parse(stripJsonComments(raw)));
        if (face) return face;
      } catch {
        /* next */
      }
    }
  } catch {
    /* no packages dir */
  }
  return null;
}

async function readConsoleRegistryFaceName(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "reg",
      ["query", "HKCU\\Console", "/v", "FaceName"],
      { windowsHide: true, timeout: 3000 },
    );
    const m = stdout.match(/FaceName\s+REG_\w+\s+(.+)\r?\n/i);
    const face = m?.[1]?.trim();
    // Windows 未自定义时常见占位符，不是可渲染族名。
    if (
      face &&
      face.length > 0 &&
      !/^__DefaultTTFont__$/i.test(face) &&
      !face.startsWith("__")
    ) {
      return face;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * 尽量解析当前用户「终端」默认字体族名。
 * Windows：Windows Terminal settings → 控制台 FaceName → 回退 Cascadia Mono。
 * macOS / Linux：平台常见终端等宽字体。
 */
export async function resolveTerminalDefaultFontFace(): Promise<string> {
  if (process.platform === "win32") {
    const wt = await readWindowsTerminalFontFace();
    if (wt) return wt;
    const consoleFace = await readConsoleRegistryFaceName();
    if (consoleFace) return consoleFace;
  }
  return terminalFontFallbackFace();
}
