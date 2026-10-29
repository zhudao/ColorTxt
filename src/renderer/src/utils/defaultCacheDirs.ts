import { EBOOK_CONVERT_DEFAULT_SUBDIR, UNPACKED_BOOKS_DEFAULT_SUBDIR } from "@shared/ebookConvertPaths";
import { BOOK_SOURCE_DOWNLOAD_DEFAULT_SUBDIR, BOOK_SOURCE_CHAPTER_CACHE_SUBDIR } from "@shared/bookSource/paths";
import { defaultAiDataCacheRoot, defaultBuiltinModelCacheRoot } from "@shared/aiDataPaths";
import { defaultCharacterPortraitCacheRoot } from "@shared/characterPortraitPaths";
import { joinFs } from "../ebook/pathUtils";

/**
 * 与 preload `getDefaultEbookConvertOutputDir` / `useAppPersistence` 一致：
 * 优先 preload 默认；若为空则用 `userData` + `ConvertedTxt`。
 */
export function resolveDefaultEbookConvertOutputDirSync(): string {
  try {
    const p = window.colorTxt?.getDefaultEbookConvertOutputDir?.();
    if (typeof p === "string") {
      const t = p.trim();
      if (t) return t;
    }
  } catch {
    /* ignore */
  }
  try {
    const ud = window.colorTxt?.getUserDataPath?.();
    if (typeof ud === "string") {
      const t = ud.trim();
      if (t) return joinFs(t, EBOOK_CONVERT_DEFAULT_SUBDIR);
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** 彩读书包默认解压目录：userData/UnpackedBooks */
export function resolveDefaultUnpackedBooksDirSync(): string {
  try {
    const ud = window.colorTxt?.getUserDataPath?.();
    if (typeof ud === "string") {
      const t = ud.trim();
      if (t) return joinFs(t, UNPACKED_BOOKS_DEFAULT_SUBDIR);
    }
  } catch {
    /* ignore */
  }
  return "";
}

/**
 * 有效解压目录：设置非空则用之，否则 `userData/UnpackedBooks`。
 */
export function resolveBookPackUnpackDir(
  configured: string | null | undefined,
): string {
  const t = configured?.trim() ?? "";
  if (t) return t;
  return resolveDefaultUnpackedBooksDirSync();
}

/**
 * 与 preload `getDefaultCharacterPortraitCacheDir` 一致：
 * 优先 preload 默认；若为空则用 `userData` + 默认子目录名。
 */
export function resolveDefaultCharacterPortraitCacheDirSync(): string {
  try {
    const p = window.colorTxt?.getDefaultCharacterPortraitCacheDir?.();
    if (typeof p === "string") {
      const t = p.trim();
      if (t) return t;
    }
  } catch {
    /* ignore */
  }
  try {
    const ud = window.colorTxt?.getUserDataPath?.();
    if (typeof ud === "string") {
      const t = ud.trim();
      if (t) return defaultCharacterPortraitCacheRoot(t);
    }
  } catch {
    /* ignore */
  }
  return "";
}

/**
 * 与 preload `getDefaultAiDataCacheDir` 一致：
 * 优先 preload 默认；若为空则用 `userData` + `ai/data`。
 */
export function resolveDefaultAiDataCacheDirSync(): string {
  try {
    const p = window.colorTxt?.getDefaultAiDataCacheDir?.();
    if (typeof p === "string") {
      const t = p.trim();
      if (t) return t;
    }
  } catch {
    /* ignore */
  }
  try {
    const ud = window.colorTxt?.getUserDataPath?.();
    if (typeof ud === "string") {
      const t = ud.trim();
      if (t) return defaultAiDataCacheRoot(t);
    }
  } catch {
    /* ignore */
  }
  return "";
}

/**
 * 与 preload `getDefaultBuiltinModelCacheDir` 一致：
 * 优先 preload 默认；若为空则用 `userData` + `ai/model-cache`。
 */
export function resolveDefaultBuiltinModelCacheDirSync(): string {
  try {
    const p = window.colorTxt?.getDefaultBuiltinModelCacheDir?.();
    if (typeof p === "string") {
      const t = p.trim();
      if (t) return t;
    }
  } catch {
    /* ignore */
  }
  try {
    const ud = window.colorTxt?.getUserDataPath?.();
    if (typeof ud === "string") {
      const t = ud.trim();
      if (t) return defaultBuiltinModelCacheRoot(t);
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** 找书下载目录默认 userData/DownloadedBooks */
export function resolveDefaultBookSourceDownloadDirSync(): string {
  try {
    const p = window.colorTxt?.getDefaultBookSourceDownloadDir?.();
    if (typeof p === "string") {
      const t = p.trim();
      if (t) return t;
    }
  } catch {
    /* ignore */
  }
  try {
    const ud = window.colorTxt?.getUserDataPath?.();
    if (typeof ud === "string") {
      const t = ud.trim();
      if (t) return joinFs(t, BOOK_SOURCE_DOWNLOAD_DEFAULT_SUBDIR);
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** 找书章节离线缓存目录默认 userData/book_cache */
export function resolveDefaultBookSourceChapterCacheDirSync(): string {
  try {
    const p = window.colorTxt?.getDefaultBookSourceChapterCacheDir?.();
    if (typeof p === "string") {
      const t = p.trim();
      if (t) return t;
    }
  } catch {
    /* ignore */
  }
  try {
    const ud = window.colorTxt?.getUserDataPath?.();
    if (typeof ud === "string") {
      const t = ud.trim();
      if (t) return joinFs(t, BOOK_SOURCE_CHAPTER_CACHE_SUBDIR);
    }
  } catch {
    /* ignore */
  }
  return "";
}

/** 本地词典缓存目录默认 userData/dictionaries */
export function resolveDefaultDictionariesDirSync(): string {
  try {
    const p = window.colorTxt?.getDefaultDictionariesDir?.();
    if (typeof p === "string") {
      const t = p.trim();
      if (t) return t;
    }
  } catch {
    /* ignore */
  }
  try {
    const ud = window.colorTxt?.getUserDataPath?.();
    if (typeof ud === "string") {
      const t = ud.trim();
      if (t) return joinFs(t, "dictionaries");
    }
  } catch {
    /* ignore */
  }
  return "";
}

export async function resolveEffectiveAiDataCacheDir(
  configured: string,
): Promise<string> {
  const trimmed = configured.trim();
  if (trimmed) return trimmed;
  const syncDefault = resolveDefaultAiDataCacheDirSync();
  if (syncDefault) return syncDefault;
  try {
    const p = await window.colorTxt?.getDefaultAiDataCacheDir?.();
    if (typeof p === "string" && p.trim()) return p.trim();
  } catch {
    /* ignore */
  }
  return "";
}

export async function resolveEffectiveBuiltinModelCacheDir(
  configured: string,
): Promise<string> {
  const trimmed = configured.trim();
  if (trimmed) return trimmed;
  const syncDefault = resolveDefaultBuiltinModelCacheDirSync();
  if (syncDefault) return syncDefault;
  try {
    const p = window.colorTxt?.getDefaultBuiltinModelCacheDir?.();
    if (typeof p === "string" && p.trim()) return p.trim();
  } catch {
    /* ignore */
  }
  return "";
}
