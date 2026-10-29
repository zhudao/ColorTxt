import { app, ipcMain } from "electron";
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  READER_BACKGROUND_IMAGE_EXTS,
  READER_BACKGROUND_MAX_BYTES,
  READER_BACKGROUND_SUBDIR,
  type ReaderBackgroundDeleteResult,
  type ReaderBackgroundImportResult,
  type ReaderBackgroundImportBytesPayload,
  type ReaderBackgroundInstallFilePayload,
  type ReaderBackgroundInstallFileResult,
} from "@shared/readerBackground";

const EXT_SET = new Set<string>(READER_BACKGROUND_IMAGE_EXTS);

function backgroundsDir(): string {
  return path.join(app.getPath("userData"), READER_BACKGROUND_SUBDIR);
}

function isAllowedExt(ext: string): boolean {
  return EXT_SET.has(ext.toLowerCase());
}

function safeFileName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length < 200 &&
    !name.includes("..") &&
    !name.includes("/") &&
    !name.includes("\\")
  );
}

function destInBackgroundsDir(fileName: string): string | null {
  if (!safeFileName(fileName) || !isAllowedExt(path.extname(fileName))) {
    return null;
  }
  const dir = backgroundsDir();
  const dest = path.resolve(dir, fileName);
  const resolvedDir = path.resolve(dir);
  if (
    dest !== resolvedDir &&
    !dest.startsWith(`${resolvedDir}${path.sep}`)
  ) {
    return null;
  }
  return dest;
}

function displayNameFromPath(sourcePath: string): string {
  const base = path.basename(sourcePath, path.extname(sourcePath)).trim();
  return base || "image";
}

function bytesToUint8(bytesRaw: unknown): Uint8Array | null {
  if (bytesRaw instanceof Uint8Array) return bytesRaw;
  if (ArrayBuffer.isView(bytesRaw)) {
    return new Uint8Array(
      bytesRaw.buffer,
      bytesRaw.byteOffset,
      bytesRaw.byteLength,
    );
  }
  if (bytesRaw instanceof ArrayBuffer) return new Uint8Array(bytesRaw);
  return null;
}

function tooLarge(byteLength: number): boolean {
  return byteLength > READER_BACKGROUND_MAX_BYTES;
}

export function registerReaderBackgroundIpc(): void {
  ipcMain.removeHandler("readerBackground:importFromPath");
  ipcMain.handle(
    "readerBackground:importFromPath",
    async (_evt, sourcePathRaw: unknown): Promise<ReaderBackgroundImportResult> => {
      const sourcePath =
        typeof sourcePathRaw === "string" ? sourcePathRaw.trim() : "";
      if (!sourcePath) return { ok: false, error: "路径为空" };
      const ext = path.extname(sourcePath);
      if (!isAllowedExt(ext)) {
        return { ok: false, error: "仅支持 png / jpg / jpeg / webp" };
      }
      try {
        const st = await stat(sourcePath);
        if (!st.isFile()) return { ok: false, error: "不是文件" };
        if (tooLarge(st.size)) return { ok: false, error: "图片过大" };
      } catch {
        return { ok: false, error: "无法读取文件" };
      }
      const id = randomUUID();
      const fileName = `${id}${ext.toLowerCase()}`;
      const dest = destInBackgroundsDir(fileName);
      if (!dest) return { ok: false, error: "无效文件名" };
      try {
        await mkdir(backgroundsDir(), { recursive: true });
        await copyFile(sourcePath, dest);
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "复制失败",
        };
      }
      return {
        ok: true,
        id,
        name: displayNameFromPath(sourcePath),
        fileName,
      };
    },
  );

  ipcMain.removeHandler("readerBackground:importFromBytes");
  ipcMain.handle(
    "readerBackground:importFromBytes",
    async (
      _evt,
      payloadRaw: unknown,
    ): Promise<ReaderBackgroundImportResult> => {
      if (!payloadRaw || typeof payloadRaw !== "object") {
        return { ok: false, error: "参数无效" };
      }
      const payload = payloadRaw as Partial<ReaderBackgroundImportBytesPayload>;
      const name =
        typeof payload.name === "string" && payload.name.trim()
          ? payload.name.trim()
          : "image";
      let ext =
        typeof payload.ext === "string" ? payload.ext.trim().toLowerCase() : "";
      if (ext && !ext.startsWith(".")) ext = `.${ext}`;
      if (!isAllowedExt(ext)) {
        return { ok: false, error: "仅支持 png / jpg / jpeg / webp" };
      }
      const bytes = bytesToUint8(payload.bytes);
      if (!bytes || bytes.byteLength === 0) {
        return { ok: false, error: "图片数据为空" };
      }
      if (tooLarge(bytes.byteLength)) {
        return { ok: false, error: "图片过大" };
      }
      const id = randomUUID();
      const fileName = `${id}${ext}`;
      const dest = destInBackgroundsDir(fileName);
      if (!dest) return { ok: false, error: "无效文件名" };
      try {
        await mkdir(backgroundsDir(), { recursive: true });
        await writeFile(dest, Buffer.from(bytes));
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "写入失败",
        };
      }
      return { ok: true, id, name, fileName };
    },
  );

  ipcMain.removeHandler("readerBackground:installFile");
  ipcMain.handle(
    "readerBackground:installFile",
    async (
      _evt,
      payloadRaw: unknown,
    ): Promise<ReaderBackgroundInstallFileResult> => {
      if (!payloadRaw || typeof payloadRaw !== "object") {
        return { ok: false, error: "参数无效" };
      }
      const payload = payloadRaw as Partial<ReaderBackgroundInstallFilePayload>;
      const id = typeof payload.id === "string" ? payload.id.trim() : "";
      const fileName =
        typeof payload.fileName === "string" ? payload.fileName.trim() : "";
      const dest = destInBackgroundsDir(fileName);
      if (!id || !dest) {
        return { ok: false, error: "无效文件名" };
      }
      const bytes = bytesToUint8(payload.bytes);
      if (!bytes || bytes.byteLength === 0) {
        return { ok: false, error: "图片数据为空" };
      }
      if (tooLarge(bytes.byteLength)) {
        return { ok: false, error: "图片过大" };
      }
      try {
        await mkdir(backgroundsDir(), { recursive: true });
        try {
          const st = await stat(dest);
          if (st.isFile()) {
            return { ok: true, id, fileName, existed: true };
          }
        } catch {
          /* not found */
        }
        await writeFile(dest, Buffer.from(bytes));
        return { ok: true, id, fileName, existed: false };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "写入失败",
        };
      }
    },
  );

  ipcMain.removeHandler("readerBackground:deleteFile");
  ipcMain.handle(
    "readerBackground:deleteFile",
    async (_evt, fileNameRaw: unknown): Promise<ReaderBackgroundDeleteResult> => {
      const fileName = typeof fileNameRaw === "string" ? fileNameRaw.trim() : "";
      const dest = destInBackgroundsDir(fileName);
      if (!dest) return { ok: false, error: "无效文件名" };
      try {
        await rm(dest, { force: true });
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "删除失败",
        };
      }
    },
  );
}
