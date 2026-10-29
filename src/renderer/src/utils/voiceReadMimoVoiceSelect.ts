import type { CustomSelectItem } from "../components/AppCustomSelect.vue";
import {
  findMimoTtsVoice,
  groupMimoTtsVoices,
  MIMO_TTS_VOICES,
  type MimoTtsVoice,
} from "@shared/voiceReadMimoVoices";
import { voiceReadGenderPrefixHtml } from "./voiceReadGenderPrefixHtml";

export function mimoVoiceToSelectItem(voice: MimoTtsVoice): CustomSelectItem {
  return {
    kind: "item",
    id: voice.id,
    label: voice.label,
    description: voice.description,
    prefixHtml: voiceReadGenderPrefixHtml(voice.gender),
  };
}

export function mimoVoiceGroupsToSelectItems(
  groups: ReturnType<typeof groupMimoTtsVoices> = groupMimoTtsVoices(),
): CustomSelectItem[] {
  const items: CustomSelectItem[] = [];
  for (const [groupLabel, voices] of groups) {
    items.push({ kind: "groupLabel", label: groupLabel });
    for (const voice of voices) {
      items.push(mimoVoiceToSelectItem(voice));
    }
  }
  return items;
}

export function mimoFlatVoiceOptionsToSelectItems(
  options: readonly { id: string; label: string }[],
): CustomSelectItem[] {
  return options.map((opt) => {
    const voice = findMimoTtsVoice(opt.id);
    if (voice) return mimoVoiceToSelectItem(voice);
    return {
      kind: "item" as const,
      id: opt.id,
      label: opt.label,
      prefixHtml: voiceReadGenderPrefixHtml(),
    };
  });
}

export function mimoVoiceSelectItems(): CustomSelectItem[] {
  return MIMO_TTS_VOICES.map((voice) => mimoVoiceToSelectItem(voice));
}
