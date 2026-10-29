import { app, ipcMain } from "electron";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { SECRET_SLOT_WEBDAV_PASSWORD } from "@shared/secretSlots";
import {
  WEBDAV_IPC,
  type WebDavAuthPayload,
  type WebDavTransferProgress,
} from "@shared/webDavIpc";
import { getSecret } from "../secretStorage";
import {
  WebDavClient,
  ensureTrailingSlash,
  joinWebDavUrl,
} from "./webDavClient";

/** 进行中的文件传输（按 requestId），供 abortTransfer 中止 */
const transferAborts = new Map<string, AbortController>();

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof Error && e.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      e instanceof DOMException &&
      e.name === "AbortError")
  );
}

function asAuth(raw: unknown): WebDavAuthPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url.trim() : "";
  const username = typeof o.username === "string" ? o.username.trim() : "";
  if (!url || !username) return null;
  return {
    url,
    username,
    passwordOverride:
      typeof o.passwordOverride === "string" ? o.passwordOverride : undefined,
    remoteDir:
      typeof o.remoteDir === "string" && o.remoteDir.trim()
        ? o.remoteDir.trim()
        : "ColorTxt",
  };
}

async function resolvePassword(auth: WebDavAuthPayload): Promise<string> {
  if (typeof auth.passwordOverride === "string") {
    return auth.passwordOverride;
  }
  return getSecret(SECRET_SLOT_WEBDAV_PASSWORD);
}

async function createClient(auth: WebDavAuthPayload): Promise<{
  client: WebDavClient;
  appRoot: string;
}> {
  const password = await resolvePassword(auth);
  const client = new WebDavClient({
    baseUrl: auth.url,
    username: auth.username,
    password,
  });
  const appRoot = ensureTrailingSlash(
    joinWebDavUrl(auth.url, auth.remoteDir || "ColorTxt"),
  );
  return { client, appRoot };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function mkdirAppLayout(
  client: WebDavClient,
  appRoot: string,
): Promise<void> {
  const root = appRoot.replace(/\/+$/, "");
  await client.mkdir(appRoot);
  await client.mkdir(joinWebDavUrl(root, "Main"));
  await client.mkdir(joinWebDavUrl(root, "Main", "reader-backgrounds"));
  await client.mkdir(joinWebDavUrl(root, "Books"));
  await client.mkdir(joinWebDavUrl(root, "FindBook"));
  await client.mkdir(joinWebDavUrl(root, "FindBook", "bookshelf"));
}

export function registerWebDavIpcHandlers(): void {
  ipcMain.handle(WEBDAV_IPC.test, async (_evt, raw: unknown) => {
    const auth = asAuth(raw);
    if (!auth) return { ok: false as const, error: "请填写 WebDAV 地址与用户名" };
    try {
      const { client, appRoot } = await createClient(auth);
      await client.check(auth.url.endsWith("/") ? auth.url : `${auth.url}/`);
      await mkdirAppLayout(client, appRoot);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: errMsg(e) };
    }
  });

  ipcMain.handle(WEBDAV_IPC.ensureLayout, async (_evt, raw: unknown) => {
    const auth = asAuth(raw);
    if (!auth) return { ok: false as const, error: "WebDAV 未配置" };
    try {
      const { client, appRoot } = await createClient(auth);
      await mkdirAppLayout(client, appRoot);
      return { ok: true as const, appRoot };
    } catch (e) {
      return { ok: false as const, error: errMsg(e) };
    }
  });

  ipcMain.handle(WEBDAV_IPC.list, async (_evt, raw: unknown) => {
    if (!raw || typeof raw !== "object") {
      return { ok: false as const, error: "无效参数" };
    }
    const o = raw as { auth?: unknown; relativePath?: unknown };
    const auth = asAuth(o.auth);
    if (!auth) return { ok: false as const, error: "WebDAV 未配置" };
    const rel =
      typeof o.relativePath === "string" ? o.relativePath.trim() : "";
    try {
      const { client, appRoot } = await createClient(auth);
      const dirUrl = rel
        ? ensureTrailingSlash(
            joinWebDavUrl(appRoot.replace(/\/+$/, ""), ...rel.split("/")),
          )
        : appRoot;
      const entries = await client.list(dirUrl);
      return { ok: true as const, entries };
    } catch (e) {
      return { ok: false as const, error: errMsg(e) };
    }
  });

  ipcMain.handle(WEBDAV_IPC.getText, async (_evt, raw: unknown) => {
    if (!raw || typeof raw !== "object") {
      return { ok: false as const, error: "无效参数" };
    }
    const o = raw as { auth?: unknown; relativePath?: unknown };
    const auth = asAuth(o.auth);
    if (!auth) return { ok: false as const, error: "WebDAV 未配置" };
    const rel =
      typeof o.relativePath === "string" ? o.relativePath.trim() : "";
    if (!rel) return { ok: false as const, error: "缺少路径" };
    try {
      const { client, appRoot } = await createClient(auth);
      const fileUrl = joinWebDavUrl(
        appRoot.replace(/\/+$/, ""),
        ...rel.split("/"),
      );
      const { text, lastModified } = await client.getText(fileUrl);
      return { ok: true as const, text, lastModified };
    } catch (e) {
      return { ok: false as const, error: errMsg(e) };
    }
  });

  ipcMain.handle(WEBDAV_IPC.getToFile, async (_evt, raw: unknown) => {
    if (!raw || typeof raw !== "object") {
      return { ok: false as const, error: "无效参数" };
    }
    const o = raw as {
      auth?: unknown;
      relativePath?: unknown;
      fileName?: unknown;
      requestId?: unknown;
    };
    const auth = asAuth(o.auth);
    if (!auth) return { ok: false as const, error: "WebDAV 未配置" };
    const rel =
      typeof o.relativePath === "string" ? o.relativePath.trim() : "";
    if (!rel) return { ok: false as const, error: "缺少路径" };
    const baseName =
      typeof o.fileName === "string" && o.fileName.trim()
        ? o.fileName.trim()
        : path.basename(rel);
    const requestId =
      typeof o.requestId === "string" && o.requestId.trim()
        ? o.requestId.trim()
        : "";
    const sendProgress = (percent: number) => {
      if (!requestId) return;
      _evt.sender.send(WEBDAV_IPC.transferProgress, {
        requestId,
        percent,
      } satisfies WebDavTransferProgress);
    };
    const abortCtrl = new AbortController();
    if (requestId) {
      transferAborts.get(requestId)?.abort();
      transferAborts.set(requestId, abortCtrl);
    }
    const destDir = path.join(
      app.getPath("temp"),
      "colortxt-webdav",
      randomUUID(),
    );
    const dest = path.join(destDir, baseName);
    try {
      const { client, appRoot } = await createClient(auth);
      const fileUrl = joinWebDavUrl(
        appRoot.replace(/\/+$/, ""),
        ...rel.split("/"),
      );
      const { filePath, lastModified } = await client.getToFile(
        fileUrl,
        dest,
        sendProgress,
        abortCtrl.signal,
      );
      return { ok: true as const, filePath, lastModified };
    } catch (e) {
      try {
        await rm(destDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      if (abortCtrl.signal.aborted || isAbortError(e)) {
        return { ok: false as const, error: "已取消", aborted: true as const };
      }
      return { ok: false as const, error: errMsg(e) };
    } finally {
      if (requestId && transferAborts.get(requestId) === abortCtrl) {
        transferAborts.delete(requestId);
      }
    }
  });

  ipcMain.handle(WEBDAV_IPC.abortTransfer, async (_evt, raw: unknown) => {
    const requestId =
      typeof raw === "string"
        ? raw.trim()
        : raw && typeof raw === "object" && "requestId" in raw
          ? String((raw as { requestId?: unknown }).requestId ?? "").trim()
          : "";
    if (!requestId) return { ok: false as const, error: "缺少 requestId" };
    const ctrl = transferAborts.get(requestId);
    if (ctrl) ctrl.abort();
    return { ok: true as const };
  });

  ipcMain.handle(WEBDAV_IPC.putText, async (_evt, raw: unknown) => {
    if (!raw || typeof raw !== "object") {
      return { ok: false as const, error: "无效参数" };
    }
    const o = raw as {
      auth?: unknown;
      relativePath?: unknown;
      text?: unknown;
      contentType?: unknown;
    };
    const auth = asAuth(o.auth);
    if (!auth) return { ok: false as const, error: "WebDAV 未配置" };
    const rel =
      typeof o.relativePath === "string" ? o.relativePath.trim() : "";
    if (!rel) return { ok: false as const, error: "缺少路径" };
    const text = typeof o.text === "string" ? o.text : "";
    const contentType =
      typeof o.contentType === "string" && o.contentType.trim()
        ? o.contentType.trim()
        : "application/json; charset=utf-8";
    try {
      const { client, appRoot } = await createClient(auth);
      const parts = rel.split("/").filter(Boolean);
      if (parts.length > 1) {
        try {
          await client.ensureDirPath(appRoot, ...parts.slice(0, -1));
        } catch {
          // 部分网盘对已存在目录 MKCOL 误报失败；父目录缺失时由 PUT 报错
        }
      }
      const fileUrl = joinWebDavUrl(appRoot.replace(/\/+$/, ""), ...parts);
      await client.putText(fileUrl, text, contentType);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: errMsg(e) };
    }
  });

  ipcMain.handle(WEBDAV_IPC.putFile, async (_evt, raw: unknown) => {
    if (!raw || typeof raw !== "object") {
      return { ok: false as const, error: "无效参数" };
    }
    const o = raw as {
      auth?: unknown;
      relativePath?: unknown;
      localPath?: unknown;
      contentType?: unknown;
      requestId?: unknown;
    };
    const auth = asAuth(o.auth);
    if (!auth) return { ok: false as const, error: "WebDAV 未配置" };
    const rel =
      typeof o.relativePath === "string" ? o.relativePath.trim() : "";
    const localPath =
      typeof o.localPath === "string" ? o.localPath.trim() : "";
    if (!rel || !localPath) {
      return { ok: false as const, error: "缺少路径" };
    }
    const contentType =
      typeof o.contentType === "string" && o.contentType.trim()
        ? o.contentType.trim()
        : "application/octet-stream";
    const requestId =
      typeof o.requestId === "string" && o.requestId.trim()
        ? o.requestId.trim()
        : "";
    const sendProgress = (percent: number) => {
      if (!requestId) return;
      _evt.sender.send(WEBDAV_IPC.transferProgress, {
        requestId,
        percent,
      } satisfies WebDavTransferProgress);
    };
    try {
      const { client, appRoot } = await createClient(auth);
      const parts = rel.split("/").filter(Boolean);
      if (parts.length > 1) {
        try {
          await client.ensureDirPath(appRoot, ...parts.slice(0, -1));
        } catch {
          // 同上：忽略 MKCOL 误报，交由 PUT 校验父目录
        }
      }
      const fileUrl = joinWebDavUrl(appRoot.replace(/\/+$/, ""), ...parts);
      await client.putFile(fileUrl, localPath, contentType, sendProgress);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: errMsg(e) };
    }
  });

  ipcMain.handle(WEBDAV_IPC.mkdir, async (_evt, raw: unknown) => {
    if (!raw || typeof raw !== "object") {
      return { ok: false as const, error: "无效参数" };
    }
    const o = raw as { auth?: unknown; relativePath?: unknown };
    const auth = asAuth(o.auth);
    if (!auth) return { ok: false as const, error: "WebDAV 未配置" };
    const rel =
      typeof o.relativePath === "string" ? o.relativePath.trim() : "";
    try {
      const { client, appRoot } = await createClient(auth);
      if (!rel) {
        await client.ensureDirPath(appRoot);
      } else {
        await client.ensureDirPath(appRoot, ...rel.split("/").filter(Boolean));
      }
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: errMsg(e) };
    }
  });

  ipcMain.handle(WEBDAV_IPC.delete, async (_evt, raw: unknown) => {
    if (!raw || typeof raw !== "object") {
      return { ok: false as const, error: "无效参数" };
    }
    const o = raw as { auth?: unknown; relativePath?: unknown };
    const auth = asAuth(o.auth);
    if (!auth) return { ok: false as const, error: "WebDAV 未配置" };
    const rel =
      typeof o.relativePath === "string" ? o.relativePath.trim() : "";
    if (!rel) return { ok: false as const, error: "缺少路径" };
    try {
      const { client, appRoot } = await createClient(auth);
      const fileUrl = joinWebDavUrl(
        appRoot.replace(/\/+$/, ""),
        ...rel.split("/"),
      );
      await client.delete(fileUrl);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: errMsg(e) };
    }
  });
}
