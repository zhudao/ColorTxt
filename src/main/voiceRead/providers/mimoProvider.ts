import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { VoiceReadEngineConfig } from "@shared/voiceReadEngineConfig";
import { resolveMimoApiBaseUrlFromApiKey } from "@shared/apiEndpointPresets";
import { defaultVoiceIdForEngine } from "@shared/voiceReadEngineDefaults";
import { mapEmotionForMimo } from "@shared/voiceReadEmotion";
import { arrayBufferForIpc } from "@shared/voiceReadIpcSerialize";
import {
  isMimoTtsPresetModel,
  isMimoTtsVoiceCloneModel,
  isMimoTtsVoiceDesignModel,
  normalizeMimoTtsModel,
} from "@shared/voiceReadMimoModels";
import { MIMO_TTS_VOICES } from "@shared/voiceReadMimoVoices";
import type {
  VoiceReadSynthesisRequest,
  VoiceReadVoiceOption,
} from "@shared/voiceReadSynthesis";
import type { VoiceReadTtsProvider } from "./types";

const MAX_REFERENCE_AUDIO_BYTES = 10 * 1024 * 1024;

function mimoApiRootFromKey(apiKey: string): string {
  return resolveMimoApiBaseUrlFromApiKey(apiKey).replace(/\/$/, "");
}

function mimoTtsUrl(apiKey: string): string {
  return `${mimoApiRootFromKey(apiKey)}/chat/completions`;
}

function mimoModelsUrl(apiKey: string): string {
  return `${mimoApiRootFromKey(apiKey)}/models`;
}

type ReferenceAudioDataUrlCacheEntry = {
  dataUrl: string;
  mtimeMs: number;
  size: number;
};

/** 按绝对路径缓存参考音 data URL；文件 mtime/size 变化时失效 */
const referenceAudioDataUrlCache = new Map<
  string,
  ReferenceAudioDataUrlCacheEntry
>();
const referenceAudioDataUrlInflight = new Map<string, Promise<string>>();

function requireMimoApiKey(config: VoiceReadEngineConfig): string {
  const apiKey = config.mimoApiKey?.trim();
  if (!apiKey) {
    throw new Error("请先在「语音朗读」设置中填写 MiMo API 密钥");
  }
  return apiKey;
}

function hasSpeakableText(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  return /[\p{L}\p{N}\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/u.test(t);
}

function buildMimoRateHint(rate: number): string | undefined {
  if (!Number.isFinite(rate) || Math.abs(rate - 1) < 0.08) return undefined;
  if (rate <= 0.75) return "语速较慢，节奏舒缓。";
  if (rate >= 1.25) return "语速较快，节奏紧凑。";
  return undefined;
}

function buildMimoUserContent(
  req: VoiceReadSynthesisRequest,
  model: string,
  config: VoiceReadEngineConfig,
): string {
  const parts: string[] = [];

  if (isMimoTtsVoiceDesignModel(model)) {
    const desc = config.mimoVoiceDescription?.trim();
    if (!desc) {
      throw new Error("请先在「语音朗读」设置中填写声音描述");
    }
    parts.push(desc);
  }

  const emotionHint = mapEmotionForMimo(req.emotion);
  if (emotionHint) parts.push(emotionHint);

  const rateHint = buildMimoRateHint(req.rate);
  if (rateHint) parts.push(rateHint);

  return parts.join("\n\n");
}

function mimeTypeForReferenceAudio(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  throw new Error("参考音频仅支持 mp3 或 wav 格式");
}

async function readReferenceAudioDataUrl(
  filePath: string,
): Promise<string> {
  const resolved = path.resolve(filePath.trim());

  let fileStat;
  try {
    fileStat = await stat(resolved);
  } catch {
    referenceAudioDataUrlCache.delete(resolved);
    throw new Error("无法读取参考音频文件");
  }

  const cached = referenceAudioDataUrlCache.get(resolved);
  if (
    cached &&
    cached.mtimeMs === fileStat.mtimeMs &&
    cached.size === fileStat.size
  ) {
    return cached.dataUrl;
  }

  const inflight = referenceAudioDataUrlInflight.get(resolved);
  if (inflight) return inflight;

  const request = (async () => {
    const buf = await readFile(resolved);
    if (buf.byteLength === 0) {
      throw new Error("参考音频文件为空");
    }
    if (buf.byteLength > MAX_REFERENCE_AUDIO_BYTES) {
      throw new Error("参考音频文件过大（Base64 编码后不得超过 10 MB）");
    }
    const mime = mimeTypeForReferenceAudio(resolved);
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    referenceAudioDataUrlCache.set(resolved, {
      dataUrl,
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
    });
    return dataUrl;
  })().finally(() => {
    referenceAudioDataUrlInflight.delete(resolved);
  });

  referenceAudioDataUrlInflight.set(resolved, request);
  return request;
}

function parseMimoAudio(body: unknown): ArrayBuffer | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const err = root.error as Record<string, unknown> | undefined;
  if (err) {
    const msg =
      typeof err.message === "string"
        ? err.message
        : typeof root.message === "string"
          ? root.message
          : "MiMo 语音合成失败";
    throw new Error(msg);
  }

  const choices = root.choices;
  if (!Array.isArray(choices) || !choices.length) return null;
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return null;
  const audio = (message as Record<string, unknown>).audio;
  if (!audio || typeof audio !== "object") return null;
  const data = (audio as Record<string, unknown>).data;
  if (typeof data !== "string" || !data.trim()) return null;
  return arrayBufferForIpc(Buffer.from(data.trim(), "base64").buffer);
}

async function buildMimoAudioPayload(
  req: VoiceReadSynthesisRequest,
  model: string,
  config: VoiceReadEngineConfig,
): Promise<Record<string, unknown>> {
  const audio: Record<string, unknown> = {
    format: "wav",
  };

  // VoiceDesign：optimize_text_preview 控制是否润色 assistant 原文
  if (isMimoTtsVoiceDesignModel(model)) {
    audio.optimize_text_preview = config.mimoOptimizeTextPreview === true;
  }

  if (isMimoTtsVoiceCloneModel(model)) {
    const refPath = config.mimoReferenceAudioPath?.trim();
    if (!refPath) {
      throw new Error("请先在「语音朗读」设置中选择参考音频");
    }
    audio.voice = await readReferenceAudioDataUrl(refPath);
    return audio;
  }

  if (isMimoTtsPresetModel(model)) {
    audio.voice =
      req.voiceId.trim() || defaultVoiceIdForEngine("mimo");
  }

  return audio;
}

export const mimoTtsProvider: VoiceReadTtsProvider = {
  engineId: "mimo",

  async synthesize(req: VoiceReadSynthesisRequest, signal: AbortSignal) {
    if (!hasSpeakableText(req.text)) {
      throw new Error("无可朗读内容");
    }

    const apiKey = requireMimoApiKey(req.engineConfig);
    const model = normalizeMimoTtsModel(req.engineConfig.mimoModel);
    const userContent = buildMimoUserContent(req, model, req.engineConfig);
    const messages: Array<{ role: string; content: string }> = [];

    if (
      userContent ||
      isMimoTtsVoiceCloneModel(model) ||
      isMimoTtsVoiceDesignModel(model)
    ) {
      messages.push({ role: "user", content: userContent });
    }

    messages.push({ role: "assistant", content: req.text });
    const audio = await buildMimoAudioPayload(req, model, req.engineConfig);

    const resp = await fetch(mimoTtsUrl(apiKey), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        messages,
        audio,
      }),
      signal,
    });

    if (!resp.ok) {
      let detail = "";
      try {
        const errJson = (await resp.json()) as unknown;
        if (errJson && typeof errJson === "object") {
          const o = errJson as Record<string, unknown>;
          const nested = o.error as Record<string, unknown> | undefined;
          detail =
            (typeof nested?.message === "string" ? nested.message : "") ||
            (typeof o.message === "string" ? o.message : "");
        }
      } catch {
        // ignore
      }
      throw new Error(
        detail
          ? `MiMo 语音合成 HTTP ${resp.status}：${detail}`
          : `MiMo 语音合成 HTTP ${resp.status}`,
      );
    }

    const json = (await resp.json()) as unknown;
    const audioBuf = parseMimoAudio(json);
    if (!audioBuf || audioBuf.byteLength === 0) {
      throw new Error("MiMo 未返回音频数据");
    }

    return { format: "wav", data: audioBuf };
  },

  async listVoices(config) {
    const model = normalizeMimoTtsModel(config.mimoModel);
    if (!isMimoTtsPresetModel(model)) return [];
    return MIMO_TTS_VOICES.map(
      (v): VoiceReadVoiceOption => ({
        id: v.id,
        label: v.label,
        locale: v.lang,
        gender: v.gender,
        description: v.description,
      }),
    );
  },

  async healthCheck(config, signal) {
    try {
      const apiKey = config.mimoApiKey?.trim();
      if (!apiKey) {
        return { ok: false, message: "请先填写 API 密钥" };
      }
      const base = resolveMimoApiBaseUrlFromApiKey(apiKey);
      const resp = await fetch(mimoModelsUrl(apiKey), {
        method: "GET",
        headers: { "api-key": apiKey },
        signal,
      });
      if (resp.ok) {
        return { ok: true, message: `连接成功（${base}）` };
      }
      if (resp.status === 401 || resp.status === 403) {
        return {
          ok: false,
          message: `API 密钥无效（已请求 ${base}；Token Plan 请使用 tp- 密钥，按量付费请使用 sk- 密钥）`,
        };
      }
      return { ok: false, message: `HTTP ${resp.status}（${base}）` };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },
};
