/** 找书下载默认子目录（位于 userData 下） */
export const BOOK_SOURCE_DOWNLOAD_DEFAULT_SUBDIR = "DownloadedBooks";

/** 章节正文离线缓存（对齐 Legado book_cache，位于 userData 下） */
export const BOOK_SOURCE_CHAPTER_CACHE_SUBDIR = "book_cache";

export function defaultBookSourceDownloadRoot(userData: string): string {
  const base = userData.replace(/[/\\]+$/, "");
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base}${sep}${BOOK_SOURCE_DOWNLOAD_DEFAULT_SUBDIR}`;
}

export function defaultBookSourceChapterCacheRoot(userData: string): string {
  const base = userData.replace(/[/\\]+$/, "");
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base}${sep}${BOOK_SOURCE_CHAPTER_CACHE_SUBDIR}`;
}
