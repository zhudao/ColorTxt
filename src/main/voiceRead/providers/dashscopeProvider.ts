import { arrayBufferForIpc } from "@shared/voiceReadIpcSerialize";
import {
  dashscopeTtsModelSupportsInstructions,
  normalizeDashscopeTtsModel,
} from "@shared/voiceReadDashscopeModels";
import { defaultSingleVoiceIdForEngine } from "@shared/voiceReadEngineDefaults";
import { mapEmotionForDashScope } from "@shared/voiceReadEmotion";
import type { VoiceReadSynthesisRequest } from "@shared/voiceReadSynthesis";
import type { VoiceReadTtsProvider } from "./types";
import { fetchDashScopeTts } from "./dashscopeSynthQueue";

const DASHSCOPE_API_ROOT = "https://dashscope.aliyuncs.com";
const DASHSCOPE_MODELS_URLS = [
  `${DASHSCOPE_API_ROOT}/api/v1/models`,
  `${DASHSCOPE_API_ROOT}/compatible-mode/v1/models`,
] as const;

const DASH_PCM_SAMPLE_RATE = 24000;

function hasSpeakableText(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  return /[\p{L}\p{N}\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/u.test(t);
}

export const dashscopeTtsProvider: VoiceReadTtsProvider = {
  engineId: "dashscope",
  async synthesize(req: VoiceReadSynthesisRequest, signal: AbortSignal) {
    if (!hasSpeakableText(req.text)) {
      throw new Error("无可朗读内容");
    }
    const key = req.engineConfig.dashscopeApiKey?.trim();
    if (!key) {
      throw new Error(
        "请先在「语音朗读」设置中填写阿里云通义（DashScope）API 密钥",
      );
    }
    const voice = req.voiceId.trim() || defaultSingleVoiceIdForEngine("dashscope");
    const model = normalizeDashscopeTtsModel(req.engineConfig.dashscopeModel);
    const instructions = dashscopeTtsModelSupportsInstructions(model)
      ? mapEmotionForDashScope(req.emotion)
      : undefined;
    const input: Record<string, string> = { text: req.text, voice };
    if (instructions) {
      input.instructions = instructions;
    }

    const resp = await fetchDashScopeTts(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "X-DashScope-SSE": "enable",
        },
        body: JSON.stringify({
          model,
          input,
        }),
      },
      signal,
    );
    if (!resp.ok) {
      throw new Error(`通义语音合成 HTTP ${resp.status}`);
    }    const reader = resp.body?.getReader();
    if (!reader) throw new Error("无响应体");

    const chunks: Uint8Array[] = [];
    const dec = new TextDecoder();
    let buf = "";
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;
        try {
          const evt = JSON.parse(jsonStr) as {
            output?: { audio?: { data?: string } };
          };
          const b64 = evt?.output?.audio?.data;
          if (b64 && typeof b64 === "string") {
            const bin = Buffer.from(b64, "base64");
            chunks.push(bin);
          }
        } catch {
          // skip
        }
      }
    }
    if (signal.aborted) throw new Error("interrupted");

    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    if (totalLen === 0) {
      throw new Error("通义语音合成未返回音频数据");
    }
    const pcm = new Uint8Array(totalLen);
    let off = 0;
    for (const c of chunks) {
      pcm.set(c, off);
      off += c.length;
    }
    return {
      format: "pcm_s16le" as const,
      data: arrayBufferForIpc(
        pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
      ),
      sampleRate: DASH_PCM_SAMPLE_RATE,
    };
  },

  async healthCheck(config, signal) {
    try {
      const apiKey = config.dashscopeApiKey?.trim();
      if (!apiKey) {
        return { ok: false, message: "请先填写 API 密钥" };
      }
      let lastErr = "";
      for (const url of DASHSCOPE_MODELS_URLS) {
        try {
          const resp = await fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
            signal,
          });
          if (resp.ok) {
            return { ok: true, message: "连接成功" };
          }
          const raw = await resp.text().catch(() => "");
          lastErr =
            resp.status === 401 || resp.status === 403
              ? "API 密钥无效"
              : `HTTP ${resp.status}${raw ? `: ${raw.slice(0, 200)}` : ""}`;
          if (resp.status === 404) continue;
          return { ok: false, message: lastErr };
        } catch (e) {
          if (signal?.aborted) {
            return { ok: false, message: "已取消" };
          }
          lastErr = e instanceof Error ? e.message : String(e);
        }
      }
      return { ok: false, message: lastErr || "连接失败" };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },
};
