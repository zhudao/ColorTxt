/** WebDAV IPC 通道与载荷类型 */

export const WEBDAV_IPC = {
  test: "webdav:test",
  list: "webdav:list",
  getText: "webdav:getText",
  getToFile: "webdav:getToFile",
  putText: "webdav:putText",
  putFile: "webdav:putFile",
  mkdir: "webdav:mkdir",
  delete: "webdav:delete",
  ensureLayout: "webdav:ensureLayout",
  /** 主进程 → 渲染：putFile / getToFile 字节进度 */
  transferProgress: "webdav:transfer-progress",
  /** 渲染 → 主进程：中止带 requestId 的传输（删半成品本地文件） */
  abortTransfer: "webdav:abortTransfer",
} as const;

export type WebDavAuthPayload = {
  url: string;
  username: string;
  /** 若提供则优先于 vault 密码（设置页「测试连接」草稿） */
  passwordOverride?: string;
  /** 应用根目录名，默认 ColorTxt */
  remoteDir?: string;
};

export type WebDavListEntry = {
  href: string;
  name: string;
  isDirectory: boolean;
  size: number | null;
  lastModified: string | null;
};

export type WebDavTransferProgress = {
  requestId: string;
  /** 0–100 */
  percent: number;
};

export type WebDavOk = { ok: true };
export type WebDavErr = { ok: false; error: string };

export type WebDavTestResult = WebDavOk | WebDavErr;
export type WebDavListResult =
  | { ok: true; entries: WebDavListEntry[] }
  | WebDavErr;
export type WebDavGetTextResult =
  | { ok: true; text: string; lastModified: string | null }
  | WebDavErr;
export type WebDavGetToFileResult =
  | { ok: true; filePath: string; lastModified: string | null }
  | (WebDavErr & { aborted?: boolean });
export type WebDavPutResult = WebDavOk | WebDavErr;
export type WebDavMkdirResult = WebDavOk | WebDavErr;
export type WebDavDeleteResult = WebDavOk | WebDavErr;
export type WebDavAbortResult = WebDavOk | WebDavErr;
