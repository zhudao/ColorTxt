import { session } from "electron";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/** 与 analyzeUrl 默认请求头一致，供 java.getWebViewUA / 验证窗共用 */
export const DEFAULT_BOOK_SOURCE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** 对齐 Legado JsExtensions.getWebViewUA：返回 WebView / Chromium 默认 UA */
export function getWebViewUserAgent(): string {
  try {
    const ua = session.defaultSession.getUserAgent();
    return ua?.trim() || DEFAULT_BOOK_SOURCE_USER_AGENT;
  } catch {
    return DEFAULT_BOOK_SOURCE_USER_AGENT;
  }
}

let cachedAndroidId: string | null = null;

/** 对齐 Legado JsExtensions.androidId：稳定设备标识（16 位 hex） */
export function getAndroidId(): string {
  if (cachedAndroidId) return cachedAndroidId;
  const file = path.join(app.getPath("userData"), "bookSourceAndroidId.txt");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{16}$/i.test(existing)) {
      cachedAndroidId = existing.toLowerCase();
      return cachedAndroidId;
    }
  } catch {
    /* create below */
  }
  const id = createHash("md5")
    .update(randomBytes(16))
    .digest("hex")
    .slice(0, 16);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, id, "utf8");
  } catch {
    /* memory-only fallback */
  }
  cachedAndroidId = id;
  return id;
}
