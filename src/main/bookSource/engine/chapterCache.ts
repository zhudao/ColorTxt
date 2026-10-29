/**
 * 章节正文离线缓存（对齐 Legado BookHelp）
 * 目录：{cacheRoot}/{书名前9字+bookUrlMd16}/
 * 文件：{chapterUrlMd16}.nb
 *
 * 用 chapterUrl 哈希作文件名（而非 index），避免「目录数组下标」与「阅读顺序下标」不一致。
 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { BOOK_SOURCE_CHAPTER_CACHE_SUBDIR } from "@shared/bookSource/paths";

const FILE_NAME_INVALID = /[\\/:*?"<>|.]/g;

function md5Encode16(s: string): string {
  const hex = createHash("md5").update(String(s), "utf8").digest("hex");
  return hex.slice(8, 24);
}

/** 对齐 Legado Book.getFolderNameNoCache */
export function bookCacheFolderName(bookName: string, bookUrl: string): string {
  const cleaned = (bookName || "").replace(FILE_NAME_INVALID, "");
  const prefix = cleaned.slice(0, Math.min(9, cleaned.length));
  return `${prefix}${md5Encode16(bookUrl)}`;
}

export function chapterCacheFileName(chapterUrl: string): string {
  return `${md5Encode16(chapterUrl)}.nb`;
}

export function defaultChapterCacheRoot(): string {
  return path.join(app.getPath("userData"), BOOK_SOURCE_CHAPTER_CACHE_SUBDIR);
}

function resolveCacheRoot(cacheDir?: string): string {
  const trimmed = cacheDir?.trim();
  return trimmed || defaultChapterCacheRoot();
}

export function bookCacheDir(
  bookName: string,
  bookUrl: string,
  cacheDir?: string,
): string {
  return path.join(
    resolveCacheRoot(cacheDir),
    bookCacheFolderName(bookName, bookUrl),
  );
}

function chapterCachePath(
  bookName: string,
  bookUrl: string,
  chapterUrl: string,
  cacheDir?: string,
): string {
  return path.join(
    bookCacheDir(bookName, bookUrl, cacheDir),
    chapterCacheFileName(chapterUrl),
  );
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function hasChapterCache(
  bookName: string,
  bookUrl: string,
  chapterUrl: string,
  cacheDir?: string,
): Promise<boolean> {
  if (!chapterUrl.trim()) return false;
  return pathExists(chapterCachePath(bookName, bookUrl, chapterUrl, cacheDir));
}

export async function readChapterCache(
  bookName: string,
  bookUrl: string,
  chapterUrl: string,
  cacheDir?: string,
): Promise<string | null> {
  if (!chapterUrl.trim()) return null;
  const file = chapterCachePath(bookName, bookUrl, chapterUrl, cacheDir);
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

export async function saveChapterCache(
  bookName: string,
  bookUrl: string,
  chapterUrl: string,
  content: string,
  cacheDir?: string,
): Promise<void> {
  if (!chapterUrl.trim()) return;
  const dir = bookCacheDir(bookName, bookUrl, cacheDir);
  await mkdir(dir, { recursive: true });
  await writeFile(
    chapterCachePath(bookName, bookUrl, chapterUrl, cacheDir),
    content,
    "utf8",
  );
}

/** 在给定章节 URL 列表中，返回已有正文缓存的子集 */
export async function filterCachedChapterUrls(
  bookName: string,
  bookUrl: string,
  chapterUrls: string[],
  cacheDir?: string,
): Promise<string[]> {
  if (!chapterUrls.length) return [];
  const dir = bookCacheDir(bookName, bookUrl, cacheDir);
  let names: Set<string>;
  try {
    names = new Set(await readdir(dir));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const url of chapterUrls) {
    if (!url?.trim()) continue;
    if (names.has(chapterCacheFileName(url))) out.push(url);
  }
  return out;
}

/** 删除单章正文离线缓存（对齐 Legado `BookHelp.delContent`） */
export async function deleteChapterCache(
  bookName: string,
  bookUrl: string,
  chapterUrl: string,
  cacheDir?: string,
): Promise<{ cleared: boolean }> {
  if (!bookUrl.trim() || !chapterUrl.trim()) return { cleared: false };
  const file = chapterCachePath(bookName, bookUrl, chapterUrl, cacheDir);
  try {
    await rm(file, { force: true });
    return { cleared: true };
  } catch {
    return { cleared: false };
  }
}

/** 删除某本书的章节正文离线缓存目录 */
export async function clearBookChapterCache(
  bookName: string,
  bookUrl: string,
  cacheDir?: string,
): Promise<{ cleared: boolean }> {
  if (!bookUrl.trim()) return { cleared: false };
  const dir = bookCacheDir(bookName, bookUrl, cacheDir);
  try {
    await rm(dir, { recursive: true, force: true });
    return { cleared: true };
  } catch {
    return { cleared: false };
  }
}

/** 清空章节正文离线缓存根目录下的全部内容 */
export async function clearAllChapterCache(
  cacheDir?: string,
): Promise<{ cleared: boolean }> {
  const root = resolveCacheRoot(cacheDir);
  try {
    await rm(root, { recursive: true, force: true });
    return { cleared: true };
  } catch {
    return { cleared: false };
  }
}
