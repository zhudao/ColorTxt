import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { WebDavListEntry } from "@shared/webDavIpc";

export type WebDavClientOptions = {
  baseUrl: string;
  username: string;
  password: string;
};

function trimSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, "");
}

/** 拼 URL：对各路径段做 encodeURIComponent（避免书源 id 中的 :/?# 等弄坏路径） */
export function joinWebDavUrl(baseUrl: string, ...segments: string[]): string {
  let base = baseUrl.trim();
  if (!base) return "";
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  base = base.replace(/\/+$/, "");
  const parts = segments
    .flatMap((s) => trimSlashes(s.replace(/\\/g, "/")).split("/"))
    .filter(Boolean)
    .map((seg) => {
      try {
        return encodeURIComponent(decodeURIComponent(seg));
      } catch {
        return encodeURIComponent(seg);
      }
    });
  if (parts.length === 0) return `${base}/`;
  return `${base}/${parts.join("/")}`;
}

export function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function basicAuthHeader(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`, "utf8").toString(
    "base64",
  );
  return `Basic ${token}`;
}

function decodeHrefName(href: string): string {
  try {
    const u = new URL(href, "https://placeholder.local");
    const segs = u.pathname.split("/").filter(Boolean);
    const last = segs[segs.length - 1] ?? "";
    return decodeURIComponent(last);
  } catch {
    const segs = href.split("/").filter(Boolean);
    const last = segs[segs.length - 1] ?? href;
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  }
}

function parsePropfindXml(xml: string, requestUrl: string): WebDavListEntry[] {
  const entries: WebDavListEntry[] = [];
  const responseRe =
    /<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi;
  let m: RegExpExecArray | null;
  const requestPath = (() => {
    try {
      return new URL(requestUrl).pathname.replace(/\/+$/, "") || "/";
    } catch {
      return "";
    }
  })();

  while ((m = responseRe.exec(xml))) {
    const block = m[1] ?? "";
    const hrefMatch = block.match(
      /<(?:[\w-]+:)?href[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?href>/i,
    );
    if (!hrefMatch) continue;
    const hrefRaw = hrefMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    let hrefPath = hrefRaw;
    try {
      hrefPath = new URL(hrefRaw, requestUrl).pathname;
    } catch {
      /* keep */
    }
    const normHref = hrefPath.replace(/\/+$/, "") || "/";
    const normReq = requestPath.replace(/\/+$/, "") || "/";
    // 跳过目录自身
    if (normHref === normReq) continue;

    const isCollection =
      /<(?:[\w-]+:)?resourcetype[^>]*>[\s\S]*<(?:[\w-]+:)?collection\b/i.test(
        block,
      ) || /\/\s*$/.test(hrefRaw);
    const sizeMatch = block.match(
      /<(?:[\w-]+:)?getcontentlength[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?getcontentlength>/i,
    );
    const lmMatch = block.match(
      /<(?:[\w-]+:)?getlastmodified[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?getlastmodified>/i,
    );
    const displayMatch = block.match(
      /<(?:[\w-]+:)?displayname[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?displayname>/i,
    );
    let size: number | null = null;
    if (sizeMatch) {
      const n = Number(sizeMatch[1].trim());
      size = Number.isFinite(n) ? n : null;
    }
    const lastModified = lmMatch ? lmMatch[1].trim() || null : null;
    const nameFromDisplay = displayMatch
      ? displayMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim()
      : "";
    const name = nameFromDisplay || decodeHrefName(hrefRaw);
    if (!name) continue;
    entries.push({
      href: hrefRaw,
      name,
      isDirectory: isCollection,
      size,
      lastModified,
    });
  }
  return entries;
}

export class WebDavClient {
  private readonly auth: string;
  readonly baseUrl: string;

  constructor(opts: WebDavClientOptions) {
    this.baseUrl = opts.baseUrl.trim().replace(/\/+$/, "");
    this.auth = basicAuthHeader(opts.username, opts.password);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: this.auth,
      ...extra,
    };
  }

  async request(
    url: string,
    init: RequestInit & { method: string },
    /** 超时毫秒；`null` 表示不限时（大文件传输） */
    timeoutMs: number | null = 45_000,
    externalSignal?: AbortSignal | null,
  ): Promise<Response> {
    const ctrl = new AbortController();
    const onExternalAbort = () => ctrl.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      externalSignal.addEventListener("abort", onExternalAbort);
    }
    const timer =
      timeoutMs == null
        ? null
        : setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: {
          ...this.headers(
            init.headers as Record<string, string> | undefined,
          ),
        },
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        if (externalSignal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        throw new Error("WebDAV 请求超时");
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  /** PROPFIND Depth 0 — 鉴权探测 */
  async check(url: string): Promise<void> {
    const res = await this.request(ensureTrailingSlash(url), {
      method: "PROPFIND",
      headers: {
        Depth: "0",
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`,
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("WebDAV 认证失败，请检查用户名与密码");
    }
    if (res.status !== 207 && res.status !== 200) {
      throw new Error(`WebDAV 连接失败（HTTP ${res.status}）`);
    }
  }

  async list(dirUrl: string): Promise<WebDavListEntry[]> {
    const url = ensureTrailingSlash(dirUrl);
    const res = await this.request(url, {
      method: "PROPFIND",
      headers: {
        Depth: "1",
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getlastmodified/>
  </d:prop>
</d:propfind>`,
    });
    if (!res.ok && res.status !== 207) {
      throw new Error(`列出目录失败（HTTP ${res.status}）`);
    }
    const xml = await res.text();
    return parsePropfindXml(xml, url);
  }

  /** PROPFIND Depth 0：目录是否已存在且可访问（兼容有/无尾斜杠） */
  async dirExists(dirUrl: string): Promise<boolean> {
    const withSlash = ensureTrailingSlash(dirUrl);
    const noSlash = withSlash.replace(/\/+$/, "");
    const urls = noSlash === withSlash ? [withSlash] : [withSlash, noSlash];
    for (const url of urls) {
      const res = await this.request(url, {
        method: "PROPFIND",
        headers: {
          Depth: "0",
          "Content-Type": "application/xml; charset=utf-8",
        },
        body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`,
      });
      if (res.status === 207 || res.status === 200) return true;
    }
    return false;
  }

  /** 在父目录 PROPFIND Depth 1 中查找同名子集合（坚果云上比 Depth 0 更稳） */
  async childDirExists(dirUrl: string): Promise<boolean> {
    const withSlash = ensureTrailingSlash(dirUrl);
    const noSlash = withSlash.replace(/\/+$/, "");
    const name = decodeHrefName(noSlash);
    if (!name) return false;
    const parent = `${noSlash.slice(0, noSlash.length - name.length)}`;
    const parentUrl = ensureTrailingSlash(parent || noSlash);
    try {
      const entries = await this.list(parentUrl);
      return entries.some(
        (e) =>
          e.isDirectory &&
          (e.name === name || e.name.replace(/\/+$/, "") === name),
      );
    } catch {
      return false;
    }
  }

  async collectionReady(dirUrl: string): Promise<boolean> {
    return (
      (await this.dirExists(dirUrl)) || (await this.childDirExists(dirUrl))
    );
  }

  /**
   * 创建单级目录。
   * 坚果云对已存在集合常返回 400（而非 405）；需结合探测 / 父目录列表判定。
   * 若 MKCOL 均失败，再尝试 PUT 占位文件以触发部分服务端自动建集。
   */
  async mkdir(dirUrl: string): Promise<void> {
    const withSlash = ensureTrailingSlash(dirUrl);
    if (await this.collectionReady(withSlash)) return;

    const noSlash = withSlash.replace(/\/+$/, "");
    const candidates = [withSlash, noSlash];
    let lastStatus = 0;

    for (const url of candidates) {
      const res = await this.request(url, {
        method: "MKCOL",
        headers: { "Content-Length": "0" },
      });
      lastStatus = res.status;
      if (
        res.status === 201 ||
        res.status === 200 ||
        res.status === 405 ||
        res.status === 409 ||
        res.status === 412
      ) {
        return;
      }
      if (
        res.status === 301 ||
        res.status === 302 ||
        res.status === 307 ||
        res.status === 308
      ) {
        return;
      }
      if (await this.collectionReady(withSlash)) return;
    }

    if (await this.collectionReady(withSlash)) return;

    // 末招：PUT 占位（部分网盘会顺带创建中间目录）
    const keepUrl = joinWebDavUrl(noSlash, ".colortxt-keep");
    try {
      const putRes = await this.request(keepUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": "0",
        },
        body: "",
      });
      if (putRes.status === 201 || putRes.status === 204 || putRes.ok) {
        try {
          await this.delete(keepUrl);
        } catch {
          /* 占位可留 */
        }
        if (await this.collectionReady(withSlash)) return;
      } else {
        lastStatus = putRes.status || lastStatus;
      }
    } catch {
      /* ignore */
    }

    if (await this.collectionReady(withSlash)) return;

    throw new Error(
      `创建目录失败（HTTP ${lastStatus || 400}）：${withSlash}`,
    );
  }

  /**
   * 逐级创建目录。
   * `rootUrl` 为应用根（如 …/ColorTxt/）；`segments` 为相对其子路径。
   */
  async ensureDirPath(rootUrl: string, ...segments: string[]): Promise<string> {
    let cur = ensureTrailingSlash(rootUrl);
    await this.mkdir(cur);
    for (const seg of segments) {
      const part = trimSlashes(seg);
      if (!part) continue;
      cur = ensureTrailingSlash(joinWebDavUrl(cur.replace(/\/+$/, ""), part));
      await this.mkdir(cur);
    }
    return cur;
  }

  async getText(fileUrl: string): Promise<{
    text: string;
    lastModified: string | null;
  }> {
    const res = await this.request(fileUrl, { method: "GET" });
    if (res.status === 404) throw new Error("远端文件不存在");
    if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`);
    const text = await res.text();
    return {
      text,
      lastModified: res.headers.get("last-modified"),
    };
  }

  async getToFile(
    fileUrl: string,
    destPath: string,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal | null,
  ): Promise<{ filePath: string; lastModified: string | null }> {
    const { Transform } = await import("node:stream");
    const { unlink } = await import("node:fs/promises");
    const throwIfAborted = () => {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
    };
    throwIfAborted();
    let wrotePartial = false;
    try {
      const res = await this.request(fileUrl, { method: "GET" }, null, signal);
      if (res.status === 404) throw new Error("远端文件不存在");
      if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`);
      await mkdir(path.dirname(destPath), { recursive: true });
      const totalHdr = res.headers.get("content-length");
      const total =
        totalHdr && /^\d+$/.test(totalHdr) ? Number(totalHdr) : 0;
      let lastPct = -1;
      const report = (received: number) => {
        if (total <= 0) return;
        const pct = Math.min(100, Math.round((received / total) * 100));
        if (pct === lastPct) return;
        lastPct = pct;
        onProgress?.(pct);
      };
      onProgress?.(0);
      wrotePartial = true;
      if (!res.body) {
        throwIfAborted();
        const buf = Buffer.from(await res.arrayBuffer());
        throwIfAborted();
        await writeFile(destPath, buf);
        onProgress?.(100);
      } else {
        const nodeStream = Readable.fromWeb(
          res.body as import("node:stream/web").ReadableStream,
        );
        let received = 0;
        const counter = new Transform({
          transform(chunk, _enc, cb) {
            if (signal?.aborted) {
              cb(new DOMException("Aborted", "AbortError"));
              return;
            }
            received += chunk.length;
            report(received);
            cb(null, chunk);
          },
        });
        await pipeline(nodeStream, counter, createWriteStream(destPath));
        onProgress?.(100);
      }
      return {
        filePath: destPath,
        lastModified: res.headers.get("last-modified"),
      };
    } catch (e) {
      if (wrotePartial) {
        try {
          await unlink(destPath);
        } catch {
          /* ignore */
        }
      }
      throw e;
    }
  }

  async putText(
    fileUrl: string,
    text: string,
    contentType = "application/json; charset=utf-8",
  ): Promise<void> {
    const doPut = () =>
      this.request(fileUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: text,
      });
    let res = await doPut();
    // 父目录缺失时坚果云常回 400（而非 409）；补建后重试
    if (
      res.status === 409 ||
      res.status === 404 ||
      res.status === 403 ||
      res.status === 400
    ) {
      const parent = fileUrl.replace(/\/+$/, "").replace(/\/[^/]+$/, "");
      if (parent) {
        try {
          await this.mkdir(parent);
        } catch {
          /* PUT 仍会给出明确错误 */
        }
        res = await doPut();
      }
    }
    if (!res.ok && res.status !== 201 && res.status !== 204) {
      let detail = "";
      try {
        detail = (await res.text()).trim().slice(0, 160);
      } catch {
        /* ignore */
      }
      const hint = detail ? `：${detail}` : "";
      throw new Error(`上传失败（HTTP ${res.status}）${hint}`);
    }
  }

  async putFile(
    fileUrl: string,
    localPath: string,
    contentType = "application/octet-stream",
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    const { createReadStream } = await import("node:fs");
    const { stat } = await import("node:fs/promises");
    const { Transform } = await import("node:stream");
    const st = await stat(localPath);
    const total = st.size;
    let lastPct = -1;
    const report = (sent: number) => {
      const pct =
        total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;
      if (pct === lastPct) return;
      lastPct = pct;
      onProgress?.(pct);
    };
    report(0);

    const fileStream = createReadStream(localPath);
    let sent = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        sent += chunk.length;
        report(sent);
        cb(null, chunk);
      },
    });
    const piped = fileStream.pipe(counter);
    const res = await this.request(
      fileUrl,
      {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(total),
        },
        // undici：流式 body 需 duplex
        duplex: "half",
        body: Readable.toWeb(piped) as BodyInit,
      } as RequestInit & { method: string; duplex: "half" },
      null,
    );
    if (!res.ok && res.status !== 201 && res.status !== 204) {
      throw new Error(`上传失败（HTTP ${res.status}）`);
    }
    onProgress?.(100);
  }

  async delete(url: string): Promise<void> {
    const res = await this.request(url, { method: "DELETE" });
    if (res.status === 404) return;
    if (!res.ok && res.status !== 204) {
      throw new Error(`删除失败（HTTP ${res.status}）`);
    }
  }
}
