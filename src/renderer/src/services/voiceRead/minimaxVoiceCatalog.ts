import { ref, shallowRef } from "vue";
import type { VoiceReadEngineConfig } from "@shared/voiceReadEngineConfig";
import type { VoiceReadVoiceOption } from "@shared/voiceReadSynthesis";
import { listVoiceReadVoicesViaIpc } from "./voiceReadSynthesisClient";

/** 从 MiniMax API 拉取的音色目录（设置页 / 角色卡共用） */
export const minimaxVoiceCatalog = shallowRef<VoiceReadVoiceOption[] | null>(
  null,
);
export const minimaxVoiceCatalogLoading = ref(false);
export const minimaxVoiceCatalogError = ref("");

let catalogCacheKey = "";

function catalogCacheKeyFor(config: VoiceReadEngineConfig): string {
  const key = config.minimaxApiKey?.trim() ?? "";
  return key ? `#${key.length}:${key.slice(-4)}` : "";
}

export async function fetchMinimaxVoiceCatalog(
  config: VoiceReadEngineConfig,
  options?: { force?: boolean },
): Promise<VoiceReadVoiceOption[]> {
  const key = catalogCacheKeyFor(config);
  if (!key) {
    minimaxVoiceCatalog.value = null;
    catalogCacheKey = "";
    minimaxVoiceCatalogError.value = "";
    return [];
  }
  if (
    !options?.force &&
    key === catalogCacheKey &&
    minimaxVoiceCatalog.value &&
    minimaxVoiceCatalog.value.length > 0
  ) {
    return minimaxVoiceCatalog.value;
  }

  minimaxVoiceCatalogLoading.value = true;
  minimaxVoiceCatalogError.value = "";
  try {
    const r = await listVoiceReadVoicesViaIpc("minimax", config);
    if (!r.ok) {
      throw new Error(r.error);
    }
    minimaxVoiceCatalog.value = r.voices;
    catalogCacheKey = key;
    return r.voices;
  } catch (e) {
    minimaxVoiceCatalogError.value =
      e instanceof Error ? e.message : String(e);
    return minimaxVoiceCatalog.value ?? [];
  } finally {
    minimaxVoiceCatalogLoading.value = false;
  }
}
