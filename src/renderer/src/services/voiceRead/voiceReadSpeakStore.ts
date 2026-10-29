import {
  cloneVoiceReadSpeakSettings,
  defaultVoiceReadSpeakSettings,
  mergeVoiceReadSpeakSettings,
  VOICE_READ_SPEAK_CHANGED_EVENT,
  VOICE_READ_SPEAK_STORAGE_KEY,
  type VoiceReadSpeakSettings,
} from "../../constants/voiceReadSpeak";

let memory: VoiceReadSpeakSettings | null = null;

function notifyChanged(): void {
  window.dispatchEvent(new Event(VOICE_READ_SPEAK_CHANGED_EVENT));
}

function readFromStorage(): VoiceReadSpeakSettings | null {
  try {
    const raw = localStorage.getItem(VOICE_READ_SPEAK_STORAGE_KEY);
    if (raw == null || !raw.trim()) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return mergeVoiceReadSpeakSettings(parsed as Partial<VoiceReadSpeakSettings>);
  } catch {
    return null;
  }
}

function writeToStorage(settings: VoiceReadSpeakSettings): void {
  localStorage.setItem(VOICE_READ_SPEAK_STORAGE_KEY, JSON.stringify(settings));
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== VOICE_READ_SPEAK_STORAGE_KEY) return;
    memory = null;
    notifyChanged();
  });
}

function ensureLoaded(): VoiceReadSpeakSettings {
  if (memory != null) return memory;
  const stored = readFromStorage();
  memory = stored ?? defaultVoiceReadSpeakSettings();
  return memory;
}

export function getVoiceReadSpeakSettings(): VoiceReadSpeakSettings {
  return cloneVoiceReadSpeakSettings(ensureLoaded());
}

export function commitVoiceReadSpeakSettings(
  settings: VoiceReadSpeakSettings,
): VoiceReadSpeakSettings {
  const next = mergeVoiceReadSpeakSettings({
    ...settings,
    filterRules: settings.filterRules.map((r, i) => ({
      ...r,
      order: i,
    })),
  });
  memory = next;
  writeToStorage(next);
  notifyChanged();
  return cloneVoiceReadSpeakSettings(next);
}
