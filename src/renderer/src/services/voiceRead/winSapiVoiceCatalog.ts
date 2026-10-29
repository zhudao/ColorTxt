import { ref, shallowRef } from "vue";
import type { VoiceReadEngineConfig } from "@shared/voiceReadEngineConfig";
import type { VoiceReadVoiceOption } from "@shared/voiceReadSynthesis";
import { listVoiceReadVoicesViaIpc } from "./voiceReadSynthesisClient";

/** Windows SAPI5 音色目录（设置页 / 角色卡共用） */
export const winSapiVoiceCatalog = shallowRef<VoiceReadVoiceOption[] | null>(
  null,
);
export const winSapiVoiceCatalogLoading = ref(false);
export const winSapiVoiceCatalogError = ref("");
/** 至少成功拉取过一次（含空列表） */
export const winSapiVoiceCatalogFetched = ref(false);

export async function fetchWinSapiVoiceCatalog(
  config: VoiceReadEngineConfig,
  options?: { force?: boolean },
): Promise<VoiceReadVoiceOption[]> {
  if (
    !options?.force &&
    winSapiVoiceCatalogFetched.value &&
    winSapiVoiceCatalog.value &&
    winSapiVoiceCatalog.value.length > 0
  ) {
    return winSapiVoiceCatalog.value;
  }

  winSapiVoiceCatalogLoading.value = true;
  winSapiVoiceCatalogError.value = "";
  try {
    const r = await listVoiceReadVoicesViaIpc("winSapi", config);
    if (!r.ok) {
      throw new Error(r.error);
    }
    winSapiVoiceCatalog.value = r.voices;
    winSapiVoiceCatalogFetched.value = true;
    return r.voices;
  } catch (e) {
    winSapiVoiceCatalogError.value =
      e instanceof Error ? e.message : String(e);
    return winSapiVoiceCatalog.value ?? [];
  } finally {
    winSapiVoiceCatalogLoading.value = false;
  }
}
