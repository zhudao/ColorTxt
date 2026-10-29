/** 位于 `app.getPath("userData")` 下的阅读区自定义背景图目录 */
export const READER_BACKGROUND_SUBDIR = "reader-backgrounds";

export const READER_BACKGROUND_IMAGE_EXTS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
] as const;

/** 自定义背景图单文件上限（导入路径 / 字节 / 配色包安装共用） */
export const READER_BACKGROUND_MAX_BYTES = 12 * 1024 * 1024;

export type ReaderBackgroundImportOk = {
  ok: true;
  id: string;
  name: string;
  fileName: string;
};

export type ReaderBackgroundImportFail = { ok: false; error: string };

export type ReaderBackgroundImportResult =
  | ReaderBackgroundImportOk
  | ReaderBackgroundImportFail;

export type ReaderBackgroundImportBytesPayload = {
  bytes: Uint8Array;
  ext: string;
  name: string;
};

/** 配色包导入：按 `fileName` 写入（可与图项 id 不同，副本共用文件），已存在则跳过 */
export type ReaderBackgroundInstallFilePayload = {
  id: string;
  fileName: string;
  bytes: Uint8Array;
};

export type ReaderBackgroundInstallFileOk = {
  ok: true;
  id: string;
  fileName: string;
  existed: boolean;
};

export type ReaderBackgroundInstallFileResult =
  | ReaderBackgroundInstallFileOk
  | ReaderBackgroundImportFail;

export type ReaderBackgroundDeleteResult =
  | { ok: true }
  | { ok: false; error: string };
