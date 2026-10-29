import { randomBytes } from "node:crypto";
import WebSocket from "ws";
import type { VoiceReadEdgeTtsRequest } from "@shared/voiceReadEdgeIpc";
import {
  computePausePoints,
  type EdgeTtsWordBoundary,
} from "@shared/voiceReadPunctuationPauses";
import type { VoiceReadPausePoint } from "@shared/voiceReadSynthesis";
import { getVoiceReadEngineMeta } from "@shared/voiceReadEngines";
import {
  adjustClockSkewFromDateHeader,
  EDGE_TTS_CHROMIUM_MAJOR_VERSION,
  EDGE_TTS_SEC_MS_GEC_VERSION,
  EDGE_TTS_TRUSTED_CLIENT_TOKEN,
  generateSecMsGec,
} from "./voiceReadEdgeTtsDrm";

const EDGE_SPEECH_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function generateMuid(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}

function randomHex(len: number): string {
  return randomBytes(len).toString("hex");
}

function hasSpeakableTtsContent(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  return /[\p{L}\p{N}\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/u.test(t);
}

/** Edge 不接受的控制字符（与 edge-tts 一致，避免合成失败） */
function removeIncompatibleCharacters(text: string): string {
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i]!.charCodeAt(0);
    if ((code >= 0 && code <= 8) || (code >= 11 && code <= 12) || (code >= 14 && code <= 31)) {
      chars[i] = " ";
    }
  }
  return chars.join("");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 解析 audio.metadata 帧中的 WordBoundary 列表（按音频顺序） */
function parseWordBoundaries(body: string): EdgeTtsWordBoundary[] | null {
  try {
    const json: unknown = JSON.parse(body);
    const metas =
      json && typeof json === "object"
        ? (json as { Metadata?: unknown[] }).Metadata
        : undefined;
    if (!Array.isArray(metas)) return null;
    const words: EdgeTtsWordBoundary[] = [];
    for (const m of metas) {
      if (!m || typeof m !== "object") continue;
      const meta = m as { Type?: unknown; Data?: unknown };
      if (meta.Type !== "WordBoundary") continue;
      const d = meta.Data as
        | { text?: { Text?: unknown }; Offset?: unknown; Duration?: unknown }
        | null
        | undefined;
      if (!d || typeof d.text?.Text !== "string") continue;
      words.push({
        text: d.text.Text,
        offsetNs: typeof d.Offset === "number" ? d.Offset : 0,
        durationNs: typeof d.Duration === "number" ? d.Duration : 0,
      });
    }
    return words.length > 0 ? words : null;
  } catch {
    return null;
  }
}

function genSSML(
  lang: string,
  text: string,
  voice: string,
  rate: number,
  pitch: number,
): string {
  const rateStr = `${rate >= 1 ? "+" : ""}${Math.round((rate - 1) * 100)}%`;
  const pitchStr = `${pitch >= 1 ? "+" : ""}${Math.round((pitch - 1) * 50)}Hz`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}"><prosody rate="${rateStr}" pitch="${pitchStr}">${escapeXml(text)}</prosody></voice></speak>`;
}

function genMessage(headers: Record<string, string>, content: string): string {
  let header = "";
  for (const key of Object.keys(headers)) {
    header += `${key}: ${headers[key]}\r\n`;
  }
  return `${header}\r\n${content}`;
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (typeof data === "string") return Buffer.from(data, "utf8");
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data as ArrayBuffer);
}

function parseTextFrame(buf: Buffer): { path: string; body: string } {
  const text = buf.toString("utf8");
  const sep = text.indexOf("\r\n\r\n");
  if (sep < 0) return { path: "", body: text };
  const headerBlock = text.slice(0, sep);
  const body = text.slice(sep + 4);
  let path = "";
  for (const line of headerBlock.split("\r\n")) {
    const m = line.match(/^Path:\s*(.+)$/i);
    if (m) path = m[1]!.trim().toLowerCase();
  }
  return { path, body };
}

function parseBinaryAudioFrame(buf: Buffer): Buffer | null {
  if (buf.length < 2) return null;
  const headerLength = buf.readUInt16BE(0);
  if (headerLength <= 0 || headerLength > buf.length - 2) return null;

  const headerBytes = buf.subarray(2, 2 + headerLength);
  const body = buf.subarray(2 + headerLength);
  const headers: Record<string, string> = {};
  for (const line of headerBytes.toString("utf8").split("\r\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      headers[line.slice(0, idx).trim().toLowerCase()] = line
        .slice(idx + 1)
        .trim()
        .toLowerCase();
    }
  }

  if (headers.path !== "audio") return null;

  const contentType = headers["content-type"] ?? "";
  if (contentType && contentType !== "audio/mpeg") return null;
  if (body.length === 0) return null;

  return body;
}

function appendAudioChunk(target: ArrayBuffer, chunk: Buffer): ArrayBuffer {
  if (chunk.length === 0) return target;
  const merged = new Uint8Array(target.byteLength + chunk.length);
  merged.set(new Uint8Array(target), 0);
  merged.set(chunk, target.byteLength);
  return merged.buffer;
}

export type EdgeTtsMp3Result = {
  data: ArrayBuffer;
  /** 标点停顿点（音频内 ms），播放端据此插入静音 */
  pauses: VoiceReadPausePoint[];
};

async function synthesizeEdgeTtsMp3Once(
  req: VoiceReadEdgeTtsRequest,
): Promise<EdgeTtsMp3Result> {
  const text = removeIncompatibleCharacters(req.text?.trim() ?? "");
  if (!text) {
    throw new Error("Edge TTS：文本为空");
  }
  if (!hasSpeakableTtsContent(text)) {
    throw new Error("Edge TTS：无可朗读内容");
  }
  const voice =
    req.voice?.trim() || getVoiceReadEngineMeta("edge").defaultVoiceId;
  const lang = req.lang?.trim() || "zh-CN";
  const rate = Number.isFinite(req.rate) ? req.rate : 1;
  const pitch = Number.isFinite(req.pitch) ? req.pitch : 1;

  const connectId = randomHex(16);
  const secMsGec = generateSecMsGec();
  const params = new URLSearchParams({
    ConnectionId: connectId,
    TrustedClientToken: EDGE_TTS_TRUSTED_CLIENT_TOKEN,
    "Sec-MS-GEC": secMsGec,
    "Sec-MS-GEC-Version": EDGE_TTS_SEC_MS_GEC_VERSION,
  });
  const url = `${EDGE_SPEECH_URL}?${params.toString()}`;

  const headers: Record<string, string> = {
    "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_TTS_CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${EDGE_TTS_CHROMIUM_MAJOR_VERSION}.0.0.0`,
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    Cookie: `muid=${generateMuid()};`,
  };

  const date = new Date().toString();
  const ssml = genSSML(lang, text, voice, rate, pitch);

  const configMsg = genMessage(
    {
      "Content-Type": "application/json; charset=utf-8",
      Path: "speech.config",
      "X-Timestamp": date,
    },
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: {
              sentenceBoundaryEnabled: false,
              wordBoundaryEnabled: true,
            },
            outputFormat: "audio-24khz-48kbitrate-mono-mp3",
          },
        },
      },
    }),
  );

  const ssmlMsg = genMessage(
    {
      "Content-Type": "application/ssml+xml",
      Path: "ssml",
      "X-RequestId": connectId,
      "X-Timestamp": date,
    },
    ssml,
  );

  return new Promise((resolve, reject) => {
    let audioData = new ArrayBuffer(0);
    const words: EdgeTtsWordBoundary[] = [];
    let settled = false;
    let lastResponseBody = "";

    const ws = new WebSocket(url, { headers });

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error("Edge TTS 超时（30s）"));
      }
    }, 30_000);

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    const finishTurn = () => {
      try {
        ws.close();
      } catch {
        // ignore
      }
      if (!audioData.byteLength) {
        settle(() =>
          reject(
            new Error(
              `Edge TTS 无音频数据${lastResponseBody ? `：${lastResponseBody.slice(0, 200)}` : ""}`,
            ),
          ),
        );
      } else {
        settle(() =>
          resolve({
            data: audioData,
            pauses: computePausePoints(text, words),
          }),
        );
      }
    };

    ws.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
      try {
        const buf = toBuffer(data);

        if (isBinary) {
          const audioChunk = parseBinaryAudioFrame(buf);
          if (audioChunk) {
            audioData = appendAudioChunk(audioData, audioChunk);
          }
          return;
        }

        const { path, body } = parseTextFrame(buf);
        if (path === "response") {
          lastResponseBody = body.trim();
          return;
        }
        if (path === "audio.metadata") {
          const parsed = parseWordBoundaries(body);
          if (parsed) words.push(...parsed);
          return;
        }
        if (path === "turn.end") {
          finishTurn();
        }
      } catch {
        // ignore frame errors
      }
    });

    ws.on("unexpected-response", (_req, res) => {
      const status = res.statusCode;
      const dateHeader = res.headers.date;
      res.resume();
      if (status === 403) {
        adjustClockSkewFromDateHeader(
          typeof dateHeader === "string" ? dateHeader : undefined,
        );
        settle(() =>
          reject(new Error("Edge TTS WebSocket 错误：Unexpected server response: 403")),
        );
        return;
      }
      settle(() =>
        reject(
          new Error(
            `Edge TTS WebSocket 错误：Unexpected server response: ${status ?? "unknown"}`,
          ),
        ),
      );
    });

    ws.on("error", (err) => {
      settle(() =>
        reject(
          new Error(
            `Edge TTS WebSocket 错误：${err instanceof Error ? err.message : String(err)}`,
          ),
        ),
      );
    });

    ws.on("close", () => {
      if (settled) return;
      if (!audioData.byteLength) {
        settle(() =>
          reject(
            new Error(
              `Edge TTS 连接关闭且无音频${lastResponseBody ? `：${lastResponseBody.slice(0, 200)}` : ""}`,
            ),
          ),
        );
      } else {
        settle(() =>
          resolve({
            data: audioData,
            pauses: computePausePoints(text, words),
          }),
        );
      }
    });

    ws.on("open", () => {
      ws.send(configMsg);
      ws.send(ssmlMsg);
    });
  });
}

/**
 * 返回单段 MP3（24kHz mono），供渲染进程播放。
 * 无音频/403 时自动重试（常见于 Sec-MS-GEC 时钟偏差或瞬时断连）。
 */
export async function synthesizeEdgeTtsMp3(
  req: VoiceReadEdgeTtsRequest,
): Promise<EdgeTtsMp3Result> {
  const maxAttempts = 3;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await synthesizeEdgeTtsMp3Once(req);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const retryable =
        /无音频|连接关闭且无音频|WebSocket|超时|403/i.test(lastErr.message) &&
        !/无可朗读内容/.test(lastErr.message);
      if (!retryable || attempt >= maxAttempts - 1) break;
      await sleepMs(250 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error("Edge TTS 合成失败");
}
