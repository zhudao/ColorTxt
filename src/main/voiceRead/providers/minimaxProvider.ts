import type { VoiceReadEngineConfig } from "@shared/voiceReadEngineConfig";

import { defaultVoiceIdForEngine } from "@shared/voiceReadEngineDefaults";
import { normalizeMinimaxTtsModel } from "@shared/voiceReadMinimaxModels";

import { mapEmotionForMiniMax } from "@shared/voiceReadEmotion";

import { inferMinimaxVoiceGender } from "@shared/voiceReadMinimaxVoiceGender";

import { arrayBufferForIpc } from "@shared/voiceReadIpcSerialize";

import type {

  VoiceReadSynthesisRequest,

  VoiceReadVoiceOption,

} from "@shared/voiceReadSynthesis";

import type { VoiceReadTtsProvider } from "./types";



const MINIMAX_TTS_URL = "https://api.minimaxi.com/v1/t2a_v2";
const MINIMAX_GET_VOICE_URL = "https://api.minimaxi.com/v1/get_voice";
const MINIMAX_MODELS_URL = "https://api.minimaxi.com/v1/models";



const MINIMAX_VOICE_LOCALE = {

  system: "minimax-system",

  voice_cloning: "minimax-voice_cloning",

  voice_generation: "minimax-voice_generation",

} as const;



function requireMiniMaxApiKey(config: VoiceReadEngineConfig): string {

  const apiKey = config.minimaxApiKey?.trim();

  if (!apiKey) {

    throw new Error("请先在「语音朗读」设置中填写 MiniMax API 密钥");

  }

  return apiKey;

}



function parseMiniMaxBaseResp(body: Record<string, unknown>): void {

  const baseResp = body.base_resp as Record<string, unknown> | undefined;

  if (baseResp && baseResp.status_code !== 0 && baseResp.status_code !== undefined) {

    const msg =

      typeof baseResp.status_msg === "string"

        ? baseResp.status_msg

        : `MiniMax 错误 ${String(baseResp.status_code)}`;

    throw new Error(msg);

  }

}



function parseMiniMaxAudio(body: unknown): ArrayBuffer | null {

  if (!body || typeof body !== "object") return null;

  const o = body as Record<string, unknown>;

  parseMiniMaxBaseResp(o);

  const data = o.data as Record<string, unknown> | undefined;

  const audioStr =

    (typeof data?.audio === "string" ? data.audio : null) ??

    (typeof o.audio === "string" ? o.audio : null);

  if (!audioStr) return null;

  const hex = audioStr.trim();

  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {

    return arrayBufferForIpc(Buffer.from(hex, "hex").buffer);

  }

  return arrayBufferForIpc(Buffer.from(hex, "base64").buffer);

}



function firstDescription(desc: unknown): string | undefined {

  if (!Array.isArray(desc)) return undefined;

  for (const item of desc) {

    if (typeof item === "string" && item.trim()) return item.trim();

  }

  return undefined;

}



function mapMiniMaxVoices(body: Record<string, unknown>): VoiceReadVoiceOption[] {

  const out: VoiceReadVoiceOption[] = [];

  const seen = new Set<string>();



  const push = (opt: VoiceReadVoiceOption) => {

    if (!opt.id || seen.has(opt.id)) return;

    seen.add(opt.id);

    out.push(opt);

  };



  const systemVoice = body.system_voice;

  if (Array.isArray(systemVoice)) {

    for (const raw of systemVoice) {

      if (!raw || typeof raw !== "object") continue;

      const v = raw as Record<string, unknown>;

      const id = typeof v.voice_id === "string" ? v.voice_id.trim() : "";

      if (!id) continue;

      const name =

        typeof v.voice_name === "string" ? v.voice_name.trim() : "";

      const desc = firstDescription(v.description);

      push({

        id,

        label: name || id,

        locale: MINIMAX_VOICE_LOCALE.system,

        description: desc,

        gender: inferMinimaxVoiceGender(id, name || undefined, desc),

      });

    }

  }



  const voiceCloning = body.voice_cloning;

  if (Array.isArray(voiceCloning)) {

    for (const raw of voiceCloning) {

      if (!raw || typeof raw !== "object") continue;

      const v = raw as Record<string, unknown>;

      const id = typeof v.voice_id === "string" ? v.voice_id.trim() : "";

      if (!id) continue;

      const desc = firstDescription(v.description);

      push({

        id,

        label: desc ? `${id}（${desc}）` : id,

        locale: MINIMAX_VOICE_LOCALE.voice_cloning,

        description: desc,

        gender: inferMinimaxVoiceGender(id, undefined, desc),

      });

    }

  }



  const voiceGeneration = body.voice_generation;

  if (Array.isArray(voiceGeneration)) {

    for (const raw of voiceGeneration) {

      if (!raw || typeof raw !== "object") continue;

      const v = raw as Record<string, unknown>;

      const id = typeof v.voice_id === "string" ? v.voice_id.trim() : "";

      if (!id) continue;

      const desc = firstDescription(v.description);

      push({

        id,

        label: desc ? `${id}（${desc}）` : id,

        locale: MINIMAX_VOICE_LOCALE.voice_generation,

        description: desc,

        gender: inferMinimaxVoiceGender(id, undefined, desc),

      });

    }

  }



  return out;

}



export const minimaxTtsProvider: VoiceReadTtsProvider = {

  engineId: "minimax",

  async synthesize(req: VoiceReadSynthesisRequest, signal: AbortSignal) {

    const apiKey = requireMiniMaxApiKey(req.engineConfig);

    const voiceId = req.voiceId.trim() || defaultVoiceIdForEngine("minimax");

    const speed = Math.max(0.5, Math.min(2, req.rate));

    const model = normalizeMinimaxTtsModel(req.engineConfig.minimaxModel);

    const minimaxEmotion = mapEmotionForMiniMax(req.emotion, model);

    const voiceSetting: Record<string, unknown> = {

          voice_id: voiceId,

          speed,

          vol: 1,

          pitch: 0,

        };

    if (minimaxEmotion) voiceSetting.emotion = minimaxEmotion;

    const resp = await fetch(MINIMAX_TTS_URL, {

      method: "POST",

      headers: {

        "Content-Type": "application/json",

        Authorization: `Bearer ${apiKey}`,

      },

      body: JSON.stringify({

        model,

        text: req.text,

        stream: false,

        voice_setting: voiceSetting,

        audio_setting: {

          sample_rate: 32000,

          format: "mp3",

        },

      }),

      signal,

    });

    if (!resp.ok) {

      throw new Error(`MiniMax 语音合成 HTTP ${resp.status}`);

    }

    const json = (await resp.json()) as unknown;

    const audio = parseMiniMaxAudio(json);

    if (!audio || audio.byteLength === 0) {

      throw new Error("MiniMax 未返回音频数据");

    }

    return { format: "mp3", data: audio };

  },

  async listVoices(config, signal) {

    const apiKey = requireMiniMaxApiKey(config);

    const resp = await fetch(MINIMAX_GET_VOICE_URL, {

      method: "POST",

      headers: {

        "Content-Type": "application/json",

        Authorization: `Bearer ${apiKey}`,

      },

      body: JSON.stringify({ voice_type: "all" }),

      signal,

    });

    if (!resp.ok) {

      throw new Error(`MiniMax 查询音色 HTTP ${resp.status}`);

    }

    const json = (await resp.json()) as unknown;

    if (!json || typeof json !== "object") {

      throw new Error("MiniMax 音色列表响应无效");

    }

    const body = json as Record<string, unknown>;

    parseMiniMaxBaseResp(body);

    return mapMiniMaxVoices(body);

  },

  async healthCheck(config, signal) {
    try {
      const apiKey = config.minimaxApiKey?.trim();
      if (!apiKey) {
        return { ok: false, message: "请先填写 API 密钥" };
      }
      const resp = await fetch(MINIMAX_MODELS_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });
      if (resp.ok) {
        return { ok: true, message: "连接成功" };
      }
      if (resp.status === 401 || resp.status === 403) {
        return { ok: false, message: "API 密钥无效" };
      }
      return { ok: false, message: `HTTP ${resp.status}` };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },

};


