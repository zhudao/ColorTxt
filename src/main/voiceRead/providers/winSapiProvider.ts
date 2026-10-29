import { arrayBufferForIpc } from "@shared/voiceReadIpcSerialize";
import {
  isWinSapiNaturalVoiceLabel,
  listWinSapiVoices,
  pickDefaultWinSapiVoiceId,
  synthesizeWinSapiWav,
} from "../winSapi/voiceReadWinSapi";
import type { VoiceReadTtsProvider } from "./types";

export const winSapiTtsProvider: VoiceReadTtsProvider = {
  engineId: "winSapi",

  async synthesize(req, signal) {
    if (process.platform !== "win32") {
      throw new Error("讲述人自然语音仅支持 Windows");
    }
    const wav = await synthesizeWinSapiWav({
      text: req.text,
      voiceId: req.voiceId,
      rate: req.rate,
      signal,
    });
    if (signal.aborted) throw new Error("interrupted");
    return { format: "wav", data: arrayBufferForIpc(wav) };
  },

  async listVoices(_config, signal) {
    if (process.platform !== "win32") return [];
    return listWinSapiVoices(signal);
  },

  async healthCheck(_config, signal) {
    if (process.platform !== "win32") {
      return { ok: false, message: "仅支持 Windows 平台" };
    }
    try {
      const voices = await listWinSapiVoices(signal);
      if (voices.length === 0) {
        return {
          ok: false,
          message:
            "未检测到 SAPI5 音色。请安装 NaturalVoiceSAPIAdapter 与自然语音包后重试。",
        };
      }
      const naturalCount = voices.filter((v) =>
        isWinSapiNaturalVoiceLabel(v.label),
      ).length;
      const def = pickDefaultWinSapiVoiceId(voices);
      return {
        ok: true,
        message:
          naturalCount > 0
            ? `已检测到 ${voices.length} 个 SAPI5 音色（含 ${naturalCount} 个 Natural），默认：${def}`
            : `已检测到 ${voices.length} 个 SAPI5 音色（未发现 Natural 标记）。默认：${def}`,
      };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },
};
