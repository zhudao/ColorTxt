import { mimoApiLikely } from "./apiEndpointPresets";

function isMimoNonChatModel(id: string): boolean {
  const m = id.trim().toLowerCase();
  return m.includes("-tts") || m.includes("-asr");
}

/** 从 `mimo-v2.5-pro` / `mimo-v3.0-flash` 等解析版本；无法识别则 0 */
function parseMimoModelVersion(id: string): number {
  const m = id.trim().toLowerCase();
  const hit = m.match(/v(\d+)(?:\.(\d+))?/);
  if (!hit) return 0;
  const major = Number(hit[1]) || 0;
  const minor = hit[2] !== undefined ? Number(hit[2]) : 0;
  return major * 100 + minor;
}

/** 同版本内 tier 越小越靠前 */
function mimoChatModelTier(id: string): number {
  const m = id.trim().toLowerCase();
  if (m.includes("-pro")) return 0;
  if (/mimo-v\d+(?:\.\d+)?$/.test(m)) return 5;
  if (m.includes("-omni")) return 10;
  if (m.includes("-flash")) return 30;
  return 40;
}

function mimoChatModelSortKey(id: string): number {
  return parseMimoModelVersion(id) * 1000 - mimoChatModelTier(id);
}

function compareMimoChatModelIds(a: string, b: string): number {
  const ka = mimoChatModelSortKey(a);
  const kb = mimoChatModelSortKey(b);
  if (ka !== kb) return kb - ka;
  return a.localeCompare(b);
}

/** MiMo：过滤 TTS/ASR，并按版本新→旧、同版本 pro → 标准 → omni → flash 排序 */
export function sortChatModelsForBaseUrl(
  baseUrl: string,
  models: readonly string[],
): string[] {
  if (!mimoApiLikely(baseUrl)) return [...models];
  const chatModels = models.filter((id) => !isMimoNonChatModel(id));
  return [...chatModels].sort(compareMimoChatModelIds);
}
