import type { VoiceReadEdgeTtsRequest } from "@shared/voiceReadEdgeIpc";
import { getVoiceReadEngineMeta } from "@shared/voiceReadEngines";
import { arrayBufferForIpc } from "@shared/voiceReadIpcSerialize";
import { synthesizeEdgeTtsMp3 } from "../../voiceReadEdgeTts";
import type { VoiceReadTtsProvider } from "./types";

function inferLangFromEdgeVoiceId(voiceId: string): string {
  const idx = voiceId.indexOf("-");
  if (idx <= 0) return "zh-CN";
  const second = voiceId.indexOf("-", idx + 1);
  if (second < 0) return "zh-CN";
  return voiceId.slice(0, second);
}

function toEdgeRequest(
  req: Parameters<VoiceReadTtsProvider["synthesize"]>[0],
): VoiceReadEdgeTtsRequest {
  const voice =
    req.voiceId.trim() || getVoiceReadEngineMeta("edge").defaultVoiceId;
  return {
    text: req.text,
    voice,
    lang: inferLangFromEdgeVoiceId(voice),
    rate: req.rate,
    pitch: req.pitch,
  };
}

export const edgeTtsProvider: VoiceReadTtsProvider = {
  engineId: "edge",
  async synthesize(req, signal) {
    if (signal.aborted) throw new Error("interrupted");
    const { data, pauses } = await synthesizeEdgeTtsMp3(toEdgeRequest(req));
    if (signal.aborted) throw new Error("interrupted");
    return { format: "mp3", data: arrayBufferForIpc(data), pauses };
  },
};
