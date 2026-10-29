import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { BookSourceRecord } from "@shared/bookSource/types";
import { getCacheValue, putCacheValue } from "../store/bookSourceStore";
import { fetchStrResponse } from "./analyzeUrl";
import type { JsExtensionHost } from "./jsExtensions";

const FILE_CACHE_PREFIX = "file:";

function md5Encode16(text: string): string {
  return createHash("md5").update(text, "utf8").digest("hex").slice(8, 24);
}

function bookSourceFilesRoot(): string {
  return path.join(app.getPath("userData"), "book-source", "files");
}

function resolveBookSourceFilePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const root = bookSourceFilesRoot();
  const abs = path.resolve(root, normalized);
  if (!abs.startsWith(root)) {
    throw new Error(`非法脚本路径: ${relativePath}`);
  }
  return abs;
}

/** Legado JsExtensions.readTxtFile */
export function readTxtFile(relativePath: string, charset = "utf8"): string {
  const abs = resolveBookSourceFilePath(relativePath);
  if (!fs.existsSync(abs)) return "";
  return fs.readFileSync(abs, charset as BufferEncoding);
}

async function downloadTextFile(
  urlStr: string,
  source: BookSourceRecord,
  host?: JsExtensionHost,
): Promise<string> {
  const res = await fetchStrResponse(urlStr, {
    source,
    host,
    logs: host?.logs,
  });
  return res.body;
}

/** Legado JsExtensions.cacheFile */
export async function cacheFile(
  urlStr: string,
  saveTimeSec = 0,
  source: BookSourceRecord,
  host?: JsExtensionHost,
): Promise<string> {
  const key = md5Encode16(urlStr);
  const cacheKey = `${FILE_CACHE_PREFIX}${key}`;
  const cachedPath = getCacheValue(source.bookSourceUrl, cacheKey);
  if (cachedPath?.trim()) {
    const abs = resolveBookSourceFilePath(cachedPath);
    if (fs.existsSync(abs)) {
      return readTxtFile(cachedPath);
    }
  }

  const body = await downloadTextFile(urlStr, source, host);
  let ext = ".txt";
  try {
    ext = path.extname(new URL(urlStr).pathname) || ".txt";
  } catch {
    /* ignore */
  }
  const fileName = `${key}${ext}`;
  const rel = path.posix.join("cache", fileName);
  const abs = resolveBookSourceFilePath(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
  putCacheValue(source.bookSourceUrl, cacheKey, rel);
  if (saveTimeSec > 0) {
    /* Legado 支持过期；当前 store 无 TTL，保留接口兼容 */
  }
  return body;
}

/** Legado JsExtensions.importScript */
export async function importScript(
  scriptPath: string,
  source: BookSourceRecord,
  host?: JsExtensionHost,
): Promise<string> {
  const pathText = String(scriptPath ?? "").trim();
  if (!pathText) throw new Error("error path null");
  const result = /^https?:\/\//i.test(pathText)
    ? await cacheFile(pathText, 0, source, host)
    : readTxtFile(pathText);
  if (!result.trim()) {
    throw new Error(`${pathText} 内容获取失败或者为空`);
  }
  return result;
}
