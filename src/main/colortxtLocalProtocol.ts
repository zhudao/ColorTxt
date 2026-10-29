import { protocol } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

const FONT_MIME: Record<string, string> = {
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".ttc": "font/collection",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** ref → 绝对路径 */
const pathByRef = new Map<string, string>();
/** 规范化绝对路径键 → ref，同一路径复用同一短 URL，避免重复占表 */
const refByPathKey = new Map<string, string>();

const MAX_REMOTE_COVERS = 300;
/** ref → 远程封面缓存 */
const remoteCoverByRef = new Map<string, { body: Buffer; mime: string }>();

/** 注册远程封面字节，返回 `colortxt-local://cover/{ref}` */
export function registerRemoteCoverBytes(
  cacheKey: string,
  body: Buffer,
  mime: string,
): string {
  const ref = createHash("md5").update(cacheKey).digest("hex");
  remoteCoverByRef.set(ref, { body, mime });
  if (remoteCoverByRef.size > MAX_REMOTE_COVERS) {
    const first = remoteCoverByRef.keys().next().value;
    if (first) remoteCoverByRef.delete(first);
  }
  return `colortxt-local://cover/${ref}`;
}

function pathKey(resolved: string): string {
  return path.resolve(resolved).replace(/\\/g, "/").toLowerCase();
}

/**
 * 为本地文件注册短 `colortxt-local://resource/{uuid}`，避免把整段路径放进 URL
 *（超长 + 中文经 encode 后极易超过 Chromium 实际限制，导致 `<img>` 根本不发起请求）。
 */
export async function registerLocalFileForColortxtUrl(
  filePath: string,
): Promise<string | null> {
  const resolved = path.resolve(filePath.trim());
  try {
    const st = await stat(resolved);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  const key = pathKey(resolved);
  let ref = refByPathKey.get(key);
  if (!ref) {
    ref = randomUUID();
    refByPathKey.set(key, ref);
    pathByRef.set(ref, resolved);
  }
  return `colortxt-local://resource/${ref}`;
}

function resolveFsPathFromColortxtUrl(requestUrl: string): string | null {
  const m = requestUrl.match(/^colortxt-local:\/+resource\/([^/?#]+)/i);
  if (!m?.[1]) return null;
  return pathByRef.get(m[1]) ?? null;
}

function resolveRemoteCoverFromColortxtUrl(
  requestUrl: string,
): { body: Buffer; mime: string } | null {
  const m = requestUrl.match(/^colortxt-local:\/+cover\/([^/?#]+)/i);
  if (!m?.[1]) return null;
  return remoteCoverByRef.get(m[1]) ?? null;
}

export function registerColortxtLocalProtocol(): void {
  protocol.handle("colortxt-local", async (request) => {
    const cover = resolveRemoteCoverFromColortxtUrl(request.url);
    if (cover) {
      return new Response(new Uint8Array(cover.body), {
        status: 200,
        headers: {
          "Content-Type": cover.mime,
          "Cache-Control": "private, max-age=86400",
        },
      });
    }

    const fsPath = resolveFsPathFromColortxtUrl(request.url);
    if (!fsPath) {
      return new Response(null, { status: 404 });
    }
    try {
      const buf = await readFile(fsPath);
      const ext = path.extname(fsPath).toLowerCase();
      const ct =
        IMAGE_MIME[ext] ?? FONT_MIME[ext] ?? "application/octet-stream";
      return new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": ct,
          // @font-face 跨协议加载需要；图片有也不影响
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "private, max-age=86400",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
