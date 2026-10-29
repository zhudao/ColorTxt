import type { AITxt2ImgConfig } from "@shared/aiTypes";
import { txt2ImgRequiresApiKey } from "@shared/txt2ImgBackend";
import { fetchA1111ImageBuffer } from "./a1111";
import { fetchAgnesImagesBuffer } from "./agnes";
import { fetchComfyUIImageBuffer } from "./comfy";
import { fetchDashScopeWanxImageBuffer } from "./dashScope";
import { fetchMinimaxImagesBuffer } from "./minimax";
import { fetchOpenAiImagesBuffer } from "./openAI";
import { fetchStabilityImageBuffer } from "./stability";
import { requireTxt2ImgApiKey } from "./shared";

/** 从配置的后端拉取一张 PNG 位图 */
export async function fetchTxt2ImgImageBuffer(
  txt2img: AITxt2ImgConfig,
  prompt: string,
  negativePrompt: string,
  signal?: AbortSignal,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const backend = txt2img.backend ?? "a1111";

  if (txt2ImgRequiresApiKey(backend)) {
    const label =
      backend === "dashscope_wanx"
        ? "通义万相"
        : backend === "stability"
          ? "Stability"
          : backend === "agnes_images"
          ? "Agnes"
          : backend === "minimax_images"
            ? "MiniMax"
          : backend === "openai_compat_images"
            ? "文生图"
            : "OpenAI";
    const keyR = requireTxt2ImgApiKey(txt2img.apiKey, label);
    if (!keyR.ok) return keyR;
  }

  const p = prompt.trim();
  const neg = negativePrompt.trim();

  switch (backend) {
    case "comfyui":
      return fetchComfyUIImageBuffer(txt2img, p, neg, signal);
    case "openai_images":
    case "openai_compat_images":
      return fetchOpenAiImagesBuffer(txt2img, p, signal);
    case "agnes_images":
      return fetchAgnesImagesBuffer(txt2img, p, signal);
    case "dashscope_wanx":
      return fetchDashScopeWanxImageBuffer(txt2img, p, signal);
    case "minimax_images":
      return fetchMinimaxImagesBuffer(txt2img, p, signal);
    case "stability":
      return fetchStabilityImageBuffer(txt2img, p, neg, signal);
    case "a1111":
    default:
      return fetchA1111ImageBuffer(txt2img, p, neg, signal);
  }
}
