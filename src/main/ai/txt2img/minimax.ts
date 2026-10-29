import type { AITxt2ImgConfig } from "@shared/aiTypes";
import { resolveMinimaxImageApiBase } from "@shared/apiEndpointPresets";
import {
  minimaxAspectRatio,
  TXT2IMG_DEFAULT_CLOUD_MODEL,
} from "@shared/txt2ImgBackend";
import {
  bufferFromImageUrl,
  errorFromTxt2ImgCatch,
  requireTxt2ImgApiKey,
} from "./shared";

function resolveMinimaxModel(txt2img: AITxt2ImgConfig): string {
  const m = txt2img.cloudModel.trim();
  return m || TXT2IMG_DEFAULT_CLOUD_MODEL.minimax_images;
}

function parseMiniMaxBaseResp(body: Record<string, unknown>): void {
  const baseResp = body.base_resp as Record<string, unknown> | undefined;
  if (
    baseResp &&
    baseResp.status_code !== 0 &&
    baseResp.status_code !== undefined
  ) {
    const msg =
      typeof baseResp.status_msg === "string"
        ? baseResp.status_msg
        : `MiniMax 错误 ${String(baseResp.status_code)}`;
    throw new Error(msg);
  }
}

function decodeMinimaxBase64Image(
  value: string,
): { ok: true; buffer: Buffer } | null {
  try {
    const buf = Buffer.from(value.trim(), "base64");
    if (buf.length >= 32) return { ok: true, buffer: buf };
  } catch {
    /* ignore */
  }
  return null;
}

function firstMinimaxImageUrl(data: Record<string, unknown>): string {
  const urls = data.image_urls ?? data.images;
  if (!Array.isArray(urls)) return "";
  for (const item of urls) {
    if (typeof item === "string" && item.trim()) return item.trim();
    if (item && typeof item === "object") {
      const url = (item as Record<string, unknown>).url;
      if (typeof url === "string" && url.trim()) return url.trim();
    }
  }
  return "";
}

/** MiniMax Image：`POST {baseUrl}/image_generation`（baseUrl 含 `/v1`） */
export async function fetchMinimaxImagesBuffer(
  txt2img: AITxt2ImgConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const keyR = requireTxt2ImgApiKey(txt2img.apiKey, "MiniMax");
  if (!keyR.ok) return keyR;

  const base = resolveMinimaxImageApiBase(txt2img.apiBaseUrl);
  const model = resolveMinimaxModel(txt2img);
  const aspectRatio = minimaxAspectRatio({
    width: txt2img.width,
    height: txt2img.height,
  });

  const url = `${base}/image_generation`;
  const body = {
    model,
    prompt: prompt.trim(),
    aspect_ratio: aspectRatio,
    response_format: "base64",
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${keyR.key}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    const raw = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        ok: false,
        error: `MiniMax 文生图 HTTP ${res.status}: ${raw.slice(0, 400)}`,
      };
    }
    let json: unknown;
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, error: "MiniMax 文生图返回非 JSON" };
    }
    if (!json || typeof json !== "object") {
      return { ok: false, error: "MiniMax 文生图响应无效" };
    }
    const rootObj = json as Record<string, unknown>;
    parseMiniMaxBaseResp(rootObj);

    const data = rootObj.data;
    if (!data || typeof data !== "object") {
      return { ok: false, error: "MiniMax 文生图响应中缺少 data" };
    }
    const dataRec = data as Record<string, unknown>;

    const images = dataRec.image_base64;
    if (Array.isArray(images)) {
      for (const item of images) {
        if (typeof item !== "string") continue;
        const decoded = decodeMinimaxBase64Image(item);
        if (decoded) return decoded;
      }
    }

    const imgUrl = firstMinimaxImageUrl(dataRec);
    if (imgUrl) {
      const dl = await bufferFromImageUrl(imgUrl, signal);
      if (!dl.ok) return { ok: false, error: `MiniMax 文生图：${dl.error}` };
      return dl;
    }

    return {
      ok: false,
      error: "MiniMax 文生图响应中无 image_base64 或 url",
    };
  } catch (e) {
    return { ok: false, error: errorFromTxt2ImgCatch(e) };
  }
}
