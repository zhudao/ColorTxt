import type { AITxt2ImgConfig } from "@shared/aiTypes";
import {
  openAiImagesSizeString,
  resolveTxt2ImgSize,
  TXT2IMG_DEFAULT_CLOUD_MODEL,
} from "@shared/txt2ImgBackend";
import {
  bufferFromImageUrl,
  errorFromTxt2ImgCatch,
  normalizeTxt2ImgBase,
  requireTxt2ImgApiKey,
} from "./shared";

function resolveAgnesModel(txt2img: AITxt2ImgConfig): string {
  const m = txt2img.cloudModel.trim();
  return m || TXT2IMG_DEFAULT_CLOUD_MODEL.agnes_images;
}

/** Agnes Image：`/v1/images/generations`，文生图 Base64 用 `return_base64`（非顶层 `response_format`） */
export async function fetchAgnesImagesBuffer(
  txt2img: AITxt2ImgConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const keyR = requireTxt2ImgApiKey(txt2img.apiKey, "Agnes");
  if (!keyR.ok) return keyR;

  const base = normalizeTxt2ImgBase(txt2img.apiBaseUrl.trim());
  if (!base) {
    return {
      ok: false,
      error: "请填写 Agnes 接口地址（如 https://apihub.agnes-ai.com/v1）",
    };
  }

  const size = resolveTxt2ImgSize("agnes_images", txt2img.width, txt2img.height);
  const model = resolveAgnesModel(txt2img);

  const body: Record<string, unknown> = {
    model,
    prompt: prompt.trim(),
    size: openAiImagesSizeString(size),
    return_base64: true,
  };

  const url = `${base}/images/generations`;

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
        error: `Agnes Images HTTP ${res.status}: ${raw.slice(0, 400)}`,
      };
    }
    let json: unknown;
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, error: "Agnes Images 返回非 JSON" };
    }
    if (!json || typeof json !== "object") {
      return { ok: false, error: "Agnes Images 响应无效" };
    }
    const data = (json as Record<string, unknown>).data;
    if (!Array.isArray(data) || !data[0] || typeof data[0] !== "object") {
      return { ok: false, error: "Agnes Images 响应中缺少 data[0]" };
    }
    const item = data[0] as Record<string, unknown>;
    const b64 = item.b64_json;
    if (typeof b64 === "string" && b64.trim()) {
      try {
        const buf = Buffer.from(b64, "base64");
        if (buf.length < 32) return { ok: false, error: "Agnes 解码图片过小" };
        return { ok: true, buffer: buf };
      } catch {
        return { ok: false, error: "无法解码 Agnes 返回的 base64" };
      }
    }
    const imgUrl = item.url;
    if (typeof imgUrl === "string" && imgUrl.trim()) {
      const dl = await bufferFromImageUrl(imgUrl.trim(), signal);
      if (!dl.ok) {
        return { ok: false, error: `Agnes Images：${dl.error}` };
      }
      return dl;
    }
    return { ok: false, error: "Agnes Images 响应中无 b64_json 或 url" };
  } catch (e) {
    return { ok: false, error: errorFromTxt2ImgCatch(e) };
  }
}
