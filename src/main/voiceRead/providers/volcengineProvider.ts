import { randomUUID } from "node:crypto";

import type { VoiceReadEngineConfig } from "@shared/voiceReadEngineConfig";
import { defaultSingleVoiceIdForEngine } from "@shared/voiceReadEngineDefaults";
import { mapEmotionForVolcengine } from "@shared/voiceReadEmotion";
import { arrayBufferForIpc } from "@shared/voiceReadIpcSerialize";
import type { VoiceReadSynthesisRequest } from "@shared/voiceReadSynthesis";
import {
  normalizeVolcengineTtsSampleRate,
  resolveVolcengineSpeechMode,
  storedVolcengineSlotSpeechMode,
  normalizeVolcenginePitch,
  volcengineSpeechRateFromPlaybackRate,
} from "@shared/voiceReadVolcengineAudio";
import { findVolcengineTtsVoice } from "@shared/voiceReadVolcengineVoices";
import type { VoiceReadTtsProvider } from "./types";
import { fetchVolcengineTts } from "./volcengineSynthQueue";

const VOLCENGINE_TTS_URL =
  "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const VOLCENGINE_RESOURCE_ID = "seed-tts-2.0";
/** 健康检查无更轻鉴权接口，用最低采样率减小下行体积 */
const HEALTH_CHECK_SAMPLE_RATE = 8000;

const VOLCENGINE_AUDIO_EVENT_CODE = 0;
const VOLCENGINE_COMPLETE_EVENT_CODE = 20000000;

const MAX_AUDIO_BYTES = 128 * 1024 * 1024;
const MAX_STREAM_BYTES = 192 * 1024 * 1024;
const MAX_EVENT_LINE_CHARS = 16 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 64 * 1024;
const MAX_SERVER_MESSAGE_CHARS = 500;

const HEALTH_CHECK_TEXT = "好";
const HEALTH_CHECK_USAGE_NOTICE =
  "健康检查会合成 1 个汉字，产生极少量用量";

type VolcengineErrorDetails = {
  status?: number;
  code?: number;
  logId?: string;
  authFailure?: boolean;
};

class VolcengineTtsError extends Error {
  readonly status?: number;
  readonly code?: number;
  readonly logId?: string;
  readonly authFailure: boolean;

  constructor(message: string, details: VolcengineErrorDetails = {}) {
    super(message);
    this.name = "VolcengineTtsError";
    this.status = details.status;
    this.code = details.code;
    this.logId = details.logId;
    this.authFailure = details.authFailure === true;
  }
}

function interruptedError(): Error {
  return new Error("interrupted");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw interruptedError();
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message === "interrupted")
  );
}

function hasSpeakableText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return /[\p{L}\p{N}\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/u.test(
    normalized,
  );
}

function requireVolcengineApiKey(config: VoiceReadEngineConfig): string {
  const apiKey = config.volcengineApiKey?.trim();
  if (!apiKey) {
    throw new Error("请先在「语音朗读」设置中填写火山引擎 API Key");
  }
  return apiKey;
}

function boundedServerMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.slice(0, MAX_SERVER_MESSAGE_CHARS);
}

function messageFromJson(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const body = value as Record<string, unknown>;
  for (const key of ["message", "error_message", "error_msg", "msg"]) {
    const message = boundedServerMessage(body[key]);
    if (message) return message;
  }
  if (body.error && typeof body.error === "object") {
    return messageFromJson(body.error);
  }
  return boundedServerMessage(body.error);
}

function extractServerMessage(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  try {
    const message = messageFromJson(JSON.parse(trimmed) as unknown);
    if (message) return message;
  } catch {
    // HTTP errors can also use newline-delimited JSON or plain text.
  }

  for (const line of trimmed.split(/\r?\n/)) {
    try {
      const message = messageFromJson(JSON.parse(line) as unknown);
      if (message) return message;
    } catch {
      // Continue to the bounded plain-text fallback.
    }
  }
  return boundedServerMessage(trimmed);
}

function looksLikeAuthFailure(message: string | undefined): boolean {
  if (!message) return false;
  return /api[ _-]?key|unauthori[sz]ed|forbidden|authentication|authorization|access denied|permission denied|not granted|not permitted|credential|鉴权|认证|授权|密钥|权限|未开通/i.test(
    message,
  );
}

function formatErrorSuffix(details: {
  status?: number;
  code?: number;
  logId?: string;
}): string {
  const parts: string[] = [];
  if (details.status !== undefined) parts.push(`HTTP ${details.status}`);
  if (details.code !== undefined) parts.push(`错误码 ${details.code}`);
  if (details.logId) parts.push(`logid ${details.logId}`);
  return parts.length ? `（${parts.join("；")}）` : "";
}

async function readBoundedErrorBody(
  response: Response,
  signal?: AbortSignal,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let text = "";
  let byteCount = 0;
  let reachedEnd = false;

  try {
    while (byteCount < MAX_ERROR_BODY_BYTES) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) {
        reachedEnd = true;
        break;
      }

      const remaining = MAX_ERROR_BODY_BYTES - byteCount;
      const accepted = value.subarray(0, remaining);
      byteCount += accepted.byteLength;
      text += decoder.decode(accepted, { stream: true });
      if (accepted.byteLength < value.byteLength) break;
    }
    text += decoder.decode();
    return text;
  } finally {
    if (!reachedEnd) await reader.cancel().catch(() => undefined);
  }
}

async function errorForHttpResponse(
  response: Response,
  signal?: AbortSignal,
): Promise<VolcengineTtsError> {
  const logId = response.headers.get("x-tt-logid")?.trim() || undefined;
  const raw = await readBoundedErrorBody(response, signal);
  const serverMessage = extractServerMessage(raw);
  const authFailure =
    response.status === 401 ||
    response.status === 403 ||
    looksLikeAuthFailure(serverMessage);
  const summary = authFailure
    ? "API Key 无效、已过期，或无权使用 seed-tts-2.0"
    : response.status === 429
      ? "请求过于频繁或账户配额受限"
      : serverMessage || "服务端拒绝了请求";
  const detail =
    serverMessage && serverMessage !== summary ? `：${serverMessage}` : "";

  return new VolcengineTtsError(
    `火山引擎语音合成失败：${summary}${detail}${formatErrorSuffix({
      status: response.status,
      logId,
    })}`,
    { status: response.status, logId, authFailure },
  );
}

function eventCode(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function decodeAudioChunk(data: unknown, logId?: string): Uint8Array {
  if (typeof data !== "string" || !data.trim()) {
    throw new VolcengineTtsError(
      `火山引擎返回了空的音频分片${formatErrorSuffix({ logId })}`,
      { logId },
    );
  }

  const base64 = data.trim();
  if (
    base64.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) {
    throw new VolcengineTtsError(
      `火山引擎返回了无效的 Base64 音频${formatErrorSuffix({ logId })}`,
      { logId },
    );
  }

  const decoded = Buffer.from(base64, "base64");
  if (!decoded.byteLength) {
    throw new VolcengineTtsError(
      `火山引擎返回了空的音频分片${formatErrorSuffix({ logId })}`,
      { logId },
    );
  }
  return decoded;
}

async function readPcmStream(
  response: Response,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("火山引擎语音合成无响应体");

  const logId = response.headers.get("x-tt-logid")?.trim() || undefined;
  const decoder = new TextDecoder();
  const audioChunks: Uint8Array[] = [];
  let audioBytes = 0;
  let streamBytes = 0;
  let pending = "";
  let completed = false;
  let reachedEnd = false;

  const processLine = (rawLine: string): void => {
    const line = rawLine.endsWith("\r")
      ? rawLine.slice(0, -1).trim()
      : rawLine.trim();
    if (!line) return;

    let event: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      event = parsed as Record<string, unknown>;
    } catch {
      throw new VolcengineTtsError(
        `火山引擎返回了无效的流式 JSON${formatErrorSuffix({ logId })}`,
        { logId },
      );
    }

    const code = eventCode(event.code);
    if (code === undefined) {
      throw new VolcengineTtsError(
        `火山引擎响应缺少有效状态码${formatErrorSuffix({ logId })}`,
        { logId },
      );
    }
    if (code === VOLCENGINE_COMPLETE_EVENT_CODE) {
      completed = true;
      return;
    }
    if (code !== VOLCENGINE_AUDIO_EVENT_CODE) {
      const serverMessage = messageFromJson(event);
      const authFailure = looksLikeAuthFailure(serverMessage);
      throw new VolcengineTtsError(
        `火山引擎语音合成失败：${
          serverMessage || "服务端返回业务错误"
        }${formatErrorSuffix({ code, logId })}`,
        { code, logId, authFailure },
      );
    }

    const data = event.data;
    if (
      data === null ||
      data === undefined ||
      (typeof data === "string" && !data.trim())
    ) {
      // code=0 may carry sentence/timestamp metadata without an audio chunk.
      return;
    }

    const chunk = decodeAudioChunk(data, logId);
    if (audioBytes + chunk.byteLength > MAX_AUDIO_BYTES) {
      throw new VolcengineTtsError("火山引擎返回的音频过大，已停止接收", {
        logId,
      });
    }
    audioChunks.push(chunk);
    audioBytes += chunk.byteLength;
  };

  const drainCompleteLines = (): void => {
    let start = 0;
    let newline = pending.indexOf("\n", start);
    while (newline !== -1) {
      processLine(pending.slice(start, newline));
      start = newline + 1;
      if (completed) break;
      newline = pending.indexOf("\n", start);
    }
    pending = completed ? "" : pending.slice(start);
    if (pending.length > MAX_EVENT_LINE_CHARS) {
      throw new VolcengineTtsError("火山引擎返回的单个流式事件过大", {
        logId,
      });
    }
  };

  try {
    while (!completed) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) {
        reachedEnd = true;
        pending += decoder.decode();
        if (pending.length > MAX_EVENT_LINE_CHARS) {
          throw new VolcengineTtsError(
            "火山引擎返回的单个流式事件过大",
            { logId },
          );
        }
        if (pending) processLine(pending);
        pending = "";
        break;
      }

      streamBytes += value.byteLength;
      if (streamBytes > MAX_STREAM_BYTES) {
        throw new VolcengineTtsError("火山引擎流式响应过大，已停止接收", {
          logId,
        });
      }
      pending += decoder.decode(value, { stream: true });
      drainCompleteLines();
    }
    throwIfAborted(signal);

    if (!completed) {
      throw new VolcengineTtsError(
        `火山引擎流式响应提前结束${formatErrorSuffix({ logId })}`,
        { logId },
      );
    }
    if (!audioBytes) {
      throw new VolcengineTtsError(
        `火山引擎未返回音频数据${formatErrorSuffix({ logId })}`,
        { logId },
      );
    }
    if (audioBytes % 2 !== 0) {
      throw new VolcengineTtsError(
        `火山引擎返回的 PCM 音频长度无效${formatErrorSuffix({ logId })}`,
        { logId },
      );
    }

    const pcm = new Uint8Array(audioBytes);
    let offset = 0;
    for (const chunk of audioChunks) {
      pcm.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return pcm.buffer;
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw interruptedError();
    throw error;
  } finally {
    if (!reachedEnd) await reader.cancel().catch(() => undefined);
  }
}

async function synthesizeVolcenginePcm(options: {
  config: VoiceReadEngineConfig;
  text: string;
  voiceId: string;
  emotion?: VoiceReadSynthesisRequest["emotion"];
  speechSlot?: VoiceReadSynthesisRequest["volcengineSpeechSlot"];
  language?: string;
  dialect?: string;
  rate?: number;
  sampleRate?: number;
  signal?: AbortSignal;
}): Promise<ArrayBuffer> {
  throwIfAborted(options.signal);
  if (!hasSpeakableText(options.text)) throw new Error("无可朗读内容");

  const apiKey = requireVolcengineApiKey(options.config);
  const speaker =
    options.voiceId.trim() || defaultSingleVoiceIdForEngine("volcengine");
  if (!speaker) throw new Error("火山引擎音色 ID 不能为空");

  const sampleRate = normalizeVolcengineTtsSampleRate(options.sampleRate);
  const speechRate = volcengineSpeechRateFromPlaybackRate(options.rate ?? 1);
  const pitch = normalizeVolcenginePitch(options.config.volcenginePitch);
  const reqParams: Record<string, unknown> = {
    text: options.text,
    speaker,
    audio_params: {
      format: "pcm",
      sample_rate: sampleRate,
      speech_rate: speechRate,
    },
  };
  const voice = findVolcengineTtsVoice(speaker);
  const storedMode = storedVolcengineSlotSpeechMode(
    options.config,
    options.speechSlot,
  );
  const requestedLanguage =
    options.language !== undefined ? options.language : storedMode.language;
  const requestedDialect =
    options.dialect !== undefined ? options.dialect : storedMode.dialect;
  const speechMode = resolveVolcengineSpeechMode({
    voiceLanguages: voice?.languages ?? [],
    voiceDialects: voice?.dialects ?? [],
    requestedLanguage,
    requestedDialect,
  });
  const additions: Record<string, unknown> = {};
  if (speechMode.explicitLanguage) {
    additions.explicit_language = speechMode.explicitLanguage;
  }
  if (speechMode.explicitDialect) {
    additions.explicit_dialect = speechMode.explicitDialect;
  }
  if (pitch !== 0) {
    additions.post_process = { pitch };
  }
  const emotionInstruction = mapEmotionForVolcengine(options.emotion);
  if (emotionInstruction) {
    additions.context_texts = [emotionInstruction];
  }
  if (Object.keys(additions).length > 0) {
    reqParams.additions = JSON.stringify(additions);
  }

  let response: Response;
  try {
    response = await fetchVolcengineTts(
      VOLCENGINE_TTS_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": apiKey,
          "X-Api-Resource-Id": VOLCENGINE_RESOURCE_ID,
          "X-Api-Request-Id": randomUUID(),
        },
        body: JSON.stringify({ req_params: reqParams }),
      },
      options.signal,
    );
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) {
      throw interruptedError();
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法连接火山引擎语音合成服务：${message}`);
  }

  if (!response.ok) {
    try {
      throw await errorForHttpResponse(response, options.signal);
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) {
        throw interruptedError();
      }
      throw error;
    }
  }
  return readPcmStream(response, options.signal);
}

export const volcengineTtsProvider: VoiceReadTtsProvider = {
  engineId: "volcengine",

  async synthesize(req, signal) {
    const sampleRate = normalizeVolcengineTtsSampleRate(
      req.engineConfig.volcengineSampleRate,
    );
    const pcm = await synthesizeVolcenginePcm({
      config: req.engineConfig,
      text: req.text,
      voiceId: req.voiceId,
      emotion: req.emotion,
      speechSlot: req.volcengineSpeechSlot,
      language: req.volcengineLanguage,
      dialect: req.volcengineDialect,
      rate: req.rate,
      sampleRate,
      signal,
    });
    return {
      format: "pcm_s16le",
      data: arrayBufferForIpc(pcm),
      sampleRate,
    };
  },

  async healthCheck(config, signal) {
    if (!config.volcengineApiKey?.trim()) {
      return {
        ok: false,
        message: `请先填写 API Key；${HEALTH_CHECK_USAGE_NOTICE}`,
      };
    }

    try {
      await synthesizeVolcenginePcm({
        config,
        text: HEALTH_CHECK_TEXT,
        voiceId: defaultSingleVoiceIdForEngine("volcengine"),
        rate: 1,
        sampleRate: HEALTH_CHECK_SAMPLE_RATE,
        signal,
      });
      return { ok: true, message: `连接成功；${HEALTH_CHECK_USAGE_NOTICE}` };
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        return { ok: false, message: "已取消" };
      }
      if (error instanceof VolcengineTtsError && error.authFailure) {
        return {
          ok: false,
          message: `API Key 无效、已过期，或无权使用 seed-tts-2.0；${HEALTH_CHECK_USAGE_NOTICE}`,
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message: `${message}；${HEALTH_CHECK_USAGE_NOTICE}`,
      };
    }
  },
};
