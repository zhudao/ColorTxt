import type { WebDavAuthPayload, WebDavListEntry } from "@shared/webDavIpc";
import { READER_BACKGROUND_IMAGE_EXTS } from "@shared/readerBackground";
import { persistKey } from "../constants/appUi";
import {
  parseReaderBackgroundState,
  readerBackgroundCustomAbs,
  type ReaderBackgroundState,
} from "../constants/readerBackground";

/** 与主窗 settings.json 同级；找书同步设置时也走这里（图库全局一份） */
export const READER_BACKGROUND_REMOTE_DIR = "Main/reader-backgrounds";

const EXT_SET = new Set<string>(READER_BACKGROUND_IMAGE_EXTS);

function imageContentType(fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function isAllowedTextureName(name: string): boolean {
  if (!name || name.length >= 200) return false;
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    return false;
  }
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return EXT_SET.has(ext);
}

export function uniqueCustomBackgroundFileNames(
  state: ReaderBackgroundState,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of state.custom) {
    const n = c.fileName.trim();
    if (!isAllowedTextureName(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function readerBackgroundFromLocalStorage(): ReaderBackgroundState {
  try {
    const s = localStorage.getItem(persistKey);
    if (!s) return parseReaderBackgroundState(undefined);
    const raw = JSON.parse(s) as Record<string, unknown>;
    return parseReaderBackgroundState(raw.readerBackground);
  } catch {
    return parseReaderBackgroundState(undefined);
  }
}

function remotePath(fileName: string): string {
  return `${READER_BACKGROUND_REMOTE_DIR}/${fileName}`;
}

function isMissingDirError(error: string): boolean {
  return /404|不存在|Not Found/i.test(error);
}

function sameSize(
  remoteSize: number | null,
  localSize: number,
  localExists: boolean,
): boolean {
  if (!localExists) return false;
  if (remoteSize != null && Number.isFinite(remoteSize)) {
    return remoteSize === localSize;
  }
  return true;
}

async function listRemoteTextures(
  auth: WebDavAuthPayload,
): Promise<
  | { ok: true; byName: Map<string, WebDavListEntry> }
  | { ok: false; error: string }
> {
  const api = window.colorTxt?.webdav;
  if (!api) return { ok: false, error: "WebDAV 接口不可用" };
  const listed = await api.list(auth, READER_BACKGROUND_REMOTE_DIR);
  if (!listed.ok) {
    if (isMissingDirError(listed.error)) {
      return { ok: true, byName: new Map() };
    }
    return listed;
  }
  const byName = new Map<string, WebDavListEntry>();
  for (const ent of listed.entries) {
    if (ent.isDirectory || !isAllowedTextureName(ent.name)) continue;
    byName.set(ent.name, ent);
  }
  return { ok: true, byName };
}

/** 上传自定义背景图：按文件名 + 大小跳过未变更项（不删远端孤儿，避免 JSON 尚未写入时丢文件） */
export async function uploadReaderBackgroundFiles(
  auth: WebDavAuthPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const api = window.colorTxt?.webdav;
  if (!api) return { ok: false, error: "WebDAV 接口不可用" };
  const names = uniqueCustomBackgroundFileNames(
    readerBackgroundFromLocalStorage(),
  );
  const listed = await listRemoteTextures(auth);
  if (!listed.ok) return listed;

  for (const fileName of names) {
    const abs = readerBackgroundCustomAbs(fileName);
    const st = await window.colorTxt.stat(abs);
    if (!st.isFile) continue;
    const remote = listed.byName.get(fileName);
    if (remote && sameSize(remote.size, st.size, true)) continue;
    const put = await api.putFile(
      auth,
      remotePath(fileName),
      abs,
      imageContentType(fileName),
    );
    if (!put.ok) return put;
  }
  return { ok: true };
}

/** JSON 已成功上传后再删远端不再引用的图 */
export async function pruneRemoteOrphanBackgroundFiles(
  auth: WebDavAuthPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const api = window.colorTxt?.webdav;
  if (!api) return { ok: false, error: "WebDAV 接口不可用" };
  const keep = new Set(
    uniqueCustomBackgroundFileNames(readerBackgroundFromLocalStorage()),
  );
  const listed = await listRemoteTextures(auth);
  if (!listed.ok) return listed;
  for (const [name] of listed.byName) {
    if (keep.has(name)) continue;
    const d = await api.delete(auth, remotePath(name));
    if (!d.ok) return d;
  }
  return { ok: true };
}

/** 按图库元数据拉取缺失/大小不一致的文件（可在写入 settings 之前调用） */
export async function downloadReaderBackgroundFiles(
  auth: WebDavAuthPayload,
  state: ReaderBackgroundState,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const api = window.colorTxt?.webdav;
  if (!api) return { ok: false, error: "WebDAV 接口不可用" };
  const names = uniqueCustomBackgroundFileNames(state);
  if (names.length === 0) return { ok: true };

  const listed = await listRemoteTextures(auth);
  if (!listed.ok) return listed;

  for (const fileName of names) {
    const remote = listed.byName.get(fileName);
    if (!remote) continue;
    const abs = readerBackgroundCustomAbs(fileName);
    const st = await window.colorTxt.stat(abs);
    if (st.isFile && sameSize(remote.size, st.size, true)) continue;
    const got = await api.getToFile(auth, remotePath(fileName), fileName);
    if (!got.ok) return got;
    const copied = await window.colorTxt.characterPortrait.copyFileTo({
      from: got.filePath,
      to: abs,
    });
    const tempDir = got.filePath.replace(/[/\\][^/\\]+$/, "");
    if (tempDir && tempDir !== got.filePath) {
      try {
        await window.colorTxt.removePath(tempDir);
      } catch {
        /* ignore */
      }
    }
    if (!copied.ok) {
      return { ok: false, error: copied.error || "写入背景图失败" };
    }
  }
  return { ok: true };
}

export async function deleteUnreferencedLocalBackgroundFiles(
  previousNames: readonly string[],
  nextNames: readonly string[],
): Promise<void> {
  const keep = new Set(nextNames);
  for (const fileName of previousNames) {
    if (keep.has(fileName)) continue;
    try {
      await window.colorTxt.readerBackground.deleteFile(fileName);
    } catch {
      /* ignore */
    }
  }
}
