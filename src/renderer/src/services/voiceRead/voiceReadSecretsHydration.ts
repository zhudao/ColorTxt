import { parseProfileKeysBlob } from "@shared/aiEndpointProfiles";
import { DEPRECATED_SECRET_SLOT_VOICE_READ_DASHSCOPE_API_KEY } from "@shared/secretSlots";
import type { VoiceReadProfile } from "@shared/voiceReadProfiles";
import { hydrateVoiceReadProfilesApiKeys } from "@shared/voiceReadProfiles";
import {
  mergeVoiceReadSettings,
  type VoiceReadSettings,
} from "../../constants/voiceRead";

/** 从系统密钥库注入语音朗读 API 密钥（localStorage 落盘时会剥离密钥明文） */
export async function hydrateVoiceReadProfilesWithSecrets(
  profiles: VoiceReadProfile[],
  activeProfileId: string,
): Promise<VoiceReadSettings | null> {
  try {
    const profileKeysRes =
      await window.colorTxt.secrets.getVoiceReadProfileKeys();
    const profileKeysBlob = profileKeysRes.keys ?? "";
    const profileKeys = parseProfileKeysBlob(profileKeysBlob);
    const activeId = activeProfileId.trim();

    hydrateVoiceReadProfilesApiKeys(
      profiles,
      profileKeys,
      profileKeysBlob,
      activeId,
    );

    const legacyRes = await window.colorTxt.secrets.getDeprecated(
      DEPRECATED_SECRET_SLOT_VOICE_READ_DASHSCOPE_API_KEY,
    );
    const legacyKey = legacyRes.ok ? legacyRes.value.trim() : "";
    const activeProfile =
      profiles.find((p) => p.id === activeId) ?? profiles[0];
    if (
      legacyKey &&
      activeProfile &&
      !activeProfile.settings.dashscopeApiKey.trim()
    ) {
      activeProfile.settings.dashscopeApiKey = legacyKey;
      if (!activeProfile.settings.engineConfig.dashscopeApiKey?.trim()) {
        activeProfile.settings.engineConfig.dashscopeApiKey = legacyKey;
      }
    }

    if (activeProfile) {
      return mergeVoiceReadSettings(activeProfile.settings);
    }
  } catch {
    // ignore
  }
  return null;
}
