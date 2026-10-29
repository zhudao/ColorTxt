import { spawnSync } from "node:child_process";
import { createCipheriv, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { app } from "electron";

import type { BookSourceRecord } from "@shared/bookSource/types";

import {
  DEFAULT_BOOK_SOURCE_USER_AGENT,
  getWebViewUserAgent,
} from "./bookSourceUserAgent";
import { cookieHeaderForUrl, setCookieFromResponse } from "./cookieManager";
import { getSourceVariable } from "../store/bookSourceStore";

const MAX_BYTES = 8 * 1024 * 1024;
const SYNC_HTTP_META_PREFIX = "__COLORTXT_SYNC_HTTP_META__";

export type SyncHttpRequest = {
  url: string;
  headers?: Record<string, string>;
  method?: string;
  body?: string | null;
};

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

function defaultSyncUserAgent(): string {
  try {
    return getWebViewUserAgent() || DEFAULT_BOOK_SOURCE_USER_AGENT;
  } catch {
    return DEFAULT_BOOK_SOURCE_USER_AGENT;
  }
}

/** 对齐 analyzeUrl / OkHttp：WebView UA，并按书源开关补 Cookie */
export function prepareSyncBookSourceHeaders(
  url: string,
  headers: Record<string, string> | undefined,
  source?: BookSourceRecord | null,
): Record<string, string> {
  const out = { ...(headers ?? {}) };
  if (!hasHeader(out, "User-Agent")) {
    out["User-Agent"] = defaultSyncUserAgent();
  }
  if (source?.enabledCookieJar && !hasHeader(out, "Cookie")) {
    const ck = cookieHeaderForUrl(url);
    if (ck) out.Cookie = ck;
  }
  return out;
}

function parseSyncHttpMeta(stderr: Buffer | null | undefined): string[] {
  const text = stderr?.toString("utf8") ?? "";
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(SYNC_HTTP_META_PREFIX)) continue;
    try {
      const parsed = JSON.parse(line.slice(SYNC_HTTP_META_PREFIX.length)) as {
        setCookie?: unknown;
      };
      return Array.isArray(parsed.setCookie)
        ? parsed.setCookie.map((v) => String(v))
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function syncHttpErrorMessage(
  stderr: Buffer | null | undefined,
  status: number | null,
): string {
  const text =
    stderr
      ?.toString("utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.startsWith(SYNC_HTTP_META_PREFIX))
      .join("\n")
      .trim() ?? "";
  return text || `sync HTTP exit ${status ?? "?"}`;
}

function encodeFrame(input: string): Buffer {
  const body = Buffer.from(input, "utf8");
  const frame = Buffer.alloc(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

function decodeFrame(stdout: Buffer | null | undefined): Buffer {
  if (!stdout || stdout.length < 4) return Buffer.alloc(0);
  const tryAt = (offset: number): Buffer | null => {
    if (stdout.length < offset + 4) return null;
    const len = stdout.readUInt32BE(offset);
    if (len <= 0) return null;
    if (len > MAX_BYTES) return null;
    if (stdout.length < offset + 4 + len) return null;
    return stdout.subarray(offset + 4, offset + 4 + len);
  };
  const at0 = tryAt(0);
  if (at0) return at0;
  // 某些环境下 helper 进程会在 stdout 混入短日志，向后扫描首个可用帧。
  const scanLimit = Math.min(stdout.length - 4, 2048);
  for (let i = 1; i <= scanLimit; i++) {
    const body = tryAt(i);
    if (body) return body;
  }
  throw new Error("sync HTTP: invalid helper response frame");
}

/**
 * 部分书源二进制接口在正文前带 2 字节大端长度前缀。
 * Android OkHttp `body().bytes()` 对齐的是去掉该前缀后的载荷；不剥离会导致
 * 后续解密 `slice(8,-16)` 密文长度非 8 倍数而报 CryptoException。
 */
export function normalizeLegadoBinaryHttpBody(body: Buffer): Buffer {
  if (body.length >= 4) {
    const declared = body.readUInt16BE(0);
    if (declared === body.length - 2) {
      return body.subarray(2);
    }
  }
  return body;
}

function assertBinaryResponse(url: string, body: Buffer): void {
  if (!body.length) {
    throw new Error(`sync HTTP: empty response (${url.slice(0, 120)})`);
  }
  const head = body[0];
  if (head === 0x7b || head === 0x5b) {
    const text = body.toString("utf8").trim();
    throw new Error(
      `sync HTTP: API returned JSON instead of binary (${url.slice(0, 120)}): ${text.slice(0, 160)}`,
    );
  }
}

function parseJsonBody(body: Buffer): unknown {
  const head = body[0];
  if (head !== 0x7b && head !== 0x5b) return null;
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
}

function parseSignedContentDeviceId(source?: BookSourceRecord | null): string | null {
  if (!source?.bookSourceUrl) return null;
  try {
    const raw = getSourceVariable(source.bookSourceUrl);
    if (!raw?.trim()) return null;
    const parsed = JSON.parse(raw) as { deviceid?: unknown };
    const id = String(parsed?.deviceid ?? "").trim().toLowerCase();
    return /^[0-9a-f]{16}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function tripleDesCbcBase64(plain: string, key: string, iv: string): string {
  let keyBuf = Buffer.from(key, "utf8");
  if (keyBuf.length === 16) {
    keyBuf = Buffer.concat([keyBuf, keyBuf.subarray(0, 8)]);
  } else if (keyBuf.length !== 24) {
    keyBuf =
      keyBuf.length > 24
        ? keyBuf.subarray(0, 24)
        : Buffer.concat([keyBuf, Buffer.alloc(24 - keyBuf.length)]);
  }
  let ivBuf = Buffer.from(iv, "utf8");
  if (ivBuf.length !== 8) {
    ivBuf =
      ivBuf.length > 8
        ? ivBuf.subarray(0, 8)
        : Buffer.concat([ivBuf, Buffer.alloc(8 - ivBuf.length)]);
  }
  const c = createCipheriv("des-ede3-cbc", keyBuf, ivBuf);
  return Buffer.concat([c.update(Buffer.from(plain, "utf8")), c.final()]).toString("base64");
}

/** 带 QDSign 的正文接口：首次失败时按书源变量 deviceid 重签重试（路径特征匹配，不绑死域名） */
function tryBuildSignedContentRetryRequest(
  req: SyncHttpRequest,
  source?: BookSourceRecord | null,
): SyncHttpRequest | null {
  const urlText = req.url || "";
  if (!/\/argus\/api\/v2\/bookcontent\/safegetcontent/i.test(urlText)) {
    return null;
  }
  const deviceId = parseSignedContentDeviceId(source);
  if (!deviceId) return null;
  let u: URL;
  try {
    u = new URL(urlText);
  } catch {
    return null;
  }
  const bidRaw = u.searchParams.get("bookId") ?? "";
  const cidRaw = u.searchParams.get("chapterId") ?? "";
  const bid = (bidRaw.match(/\d+/)?.[0] ?? "").trim();
  const cid = (cidRaw.match(/\d+/)?.[0] ?? "").trim();
  if (!bid || !cid) return null;
  const query = `bookId=${bid}&chapterId=${cid}`;
  const t = Date.now();
  const signRaw = `Rv1rPTnczce|${t}||||||${createHash("md5").update(query.toLowerCase(), "utf8").digest("hex")}`;
  const qdSign = tripleDesCbcBase64(
    signRaw,
    "{1dYgqE)h9,R)hKqEcv4]k[h",
    "01234567",
  );
  const infoRaw = `${deviceId}||||||1||999|${t}`;
  const qdInfo = tripleDesCbcBase64(
    infoRaw,
    "0821CAAD409B84020821CAAD",
    "\0\0\0\0\0\0\0\0",
  );
  return {
    ...req,
    url: `${u.origin}${u.pathname}?${query}`,
    headers: {
      ...(req.headers ?? {}),
      QDSign: qdSign,
      QDInfo: qdInfo,
      tstamp: String(t),
    },
    method: "GET",
    body: null,
  };
}

function resolveBinaryFetchHelperDir(): string {
  const candidates = [
    path.join(app.getAppPath(), "scripts", "binary-fetch-helper"),
    path.join(process.cwd(), "scripts", "binary-fetch-helper"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
  }
  return candidates[0]!;
}

function chromiumChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function runChromiumHelperFetch(input: string): {
  status: number | null;
  stdout: Buffer | null;
  stderr: Buffer | null;
  error?: Error;
} {
  const helperDir = resolveBinaryFetchHelperDir();
  const r = spawnSync(process.execPath, [helperDir], {
    input: encodeFrame(input),
    maxBuffer: MAX_BYTES + 65536,
    env: chromiumChildEnv(),
    windowsHide: true,
    timeout: 90_000,
  });
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    error: r.error,
  };
}

function runNodeUndiciFetch(input: string): {
  status: number | null;
  stdout: Buffer | null;
  stderr: Buffer | null;
  error?: Error;
} {
  const script = `
    const { stdin, stdout, stderr } = require('node:process');
    const { Agent, fetch } = require('undici');
    const META = ${JSON.stringify(SYNC_HTTP_META_PREFIX)};
    let raw = '';
    stdin.on('data', (c) => { raw += c; });
    stdin.on('end', async () => {
      try {
        const { url, headers, method, body } = JSON.parse(raw);
        const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
        const init = { method, headers, redirect: 'follow', dispatcher };
        if (body != null && method !== 'GET' && method !== 'HEAD') init.body = body;
        const res = await fetch(url, init);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > ${MAX_BYTES}) {
          stderr.write('response too large');
          process.exit(2);
        }
        const setCookie = typeof res.headers.getSetCookie === 'function'
          ? res.headers.getSetCookie()
          : (() => {
              const sc = res.headers.get('set-cookie');
              return sc ? [sc] : [];
            })();
        if (setCookie.length) {
          stderr.write(META + JSON.stringify({ setCookie }) + '\\n');
        }
        stdout.write(buf);
        process.exit(0);
      } catch (e) {
        stderr.write(String(e && e.stack || e));
        process.exit(1);
      }
    });
  `;
  const r = spawnSync(process.execPath, ["-e", script], {
    input,
    maxBuffer: MAX_BYTES + 4096,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    windowsHide: true,
  });
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    error: r.error,
  };
}

/**
 * 子进程同步 HTTP（对齐 Legado OkHttp 阻塞 execute）。
 * Electron 内用 Chromium session.fetch 子进程，与 java.ajax 网络栈一致。
 * 返回原始字节（含文本 HTML）；调用方自行解码 / 校验。
 */
export function syncBookSourceHttpBody(
  req: SyncHttpRequest,
  source?: BookSourceRecord | null,
): Buffer {
  const useChromium = Boolean(process.versions.electron);
  const executeOnce = (request: SyncHttpRequest): Buffer => {
    const headers = prepareSyncBookSourceHeaders(request.url, request.headers, source);
    const input = JSON.stringify({
      url: request.url,
      headers,
      method: (request.method ?? "GET").toUpperCase(),
      body: request.body ?? null,
    });
    const r = useChromium ? runChromiumHelperFetch(input) : runNodeUndiciFetch(input);
    if (r.error) throw r.error;
    const setCookies = parseSyncHttpMeta(r.stderr);
    if (setCookies.length) {
      for (const sc of setCookies) {
        setCookieFromResponse(request.url, sc);
      }
    }
    if (r.status !== 0) {
      throw new Error(syncHttpErrorMessage(r.stderr, r.status));
    }
    const raw = useChromium
      ? decodeFrame(r.stdout)
      : (r.stdout ?? Buffer.alloc(0));
    return normalizeLegadoBinaryHttpBody(raw);
  };

  let body = executeOnce(req);
  const parsed = parseJsonBody(body) as { Result?: unknown; Message?: unknown } | null;
  if (parsed?.Result === -3 && String(parsed?.Message ?? "").includes("参数异常")) {
    const retryReq = tryBuildSignedContentRetryRequest(req, source);
    if (retryReq) {
      body = executeOnce(retryReq);
    }
  }
  return body;
}

/** 同步拉取二进制正文：拒绝空响应与误当密文的 JSON 错误体 */
export function syncBookSourceHttpBinary(
  req: SyncHttpRequest,
  source?: BookSourceRecord | null,
): Buffer {
  const body = syncBookSourceHttpBody(req, source);
  assertBinaryResponse(req.url, body);
  return body;
}
