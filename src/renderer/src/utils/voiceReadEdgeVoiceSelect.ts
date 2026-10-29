import type { CustomSelectItem } from "../components/AppCustomSelect.vue";
import {
  EDGE_TTS_VOICES,
  findEdgeTtsVoice,
  type EdgeTtsVoice,
} from "@shared/voiceReadEdgeTtsVoices";
import { voiceReadGenderPrefixHtml } from "./voiceReadGenderPrefixHtml";

export function edgeVoiceToSelectItem(voice: EdgeTtsVoice): CustomSelectItem {
  return {
    kind: "item",
    id: voice.id,
    label: voice.label,
    description: voice.description,
    prefixHtml: voiceReadGenderPrefixHtml(voice.gender),
  };
}

export function edgeFlatVoiceOptionsToSelectItems(
  options: readonly { id: string; label: string }[],
): CustomSelectItem[] {
  return options.map((opt) => {
    const voice = findEdgeTtsVoice(opt.id);
    if (voice) return edgeVoiceToSelectItem(voice);
    return {
      kind: "item" as const,
      id: opt.id,
      label: opt.label,
      prefixHtml: voiceReadGenderPrefixHtml(),
    };
  });
}

export function edgeVoiceGroupsToSelectItems(
  groups: ReadonlyArray<readonly [string, readonly EdgeTtsVoice[]]>,
  localeLabel: (locale: string) => string,
): CustomSelectItem[] {
  const items: CustomSelectItem[] = [];
  for (const [locale, voices] of groups) {
    items.push({ kind: "groupLabel", label: localeLabel(locale) });
    for (const voice of voices) {
      items.push(edgeVoiceToSelectItem(voice));
    }
  }
  return items;
}

export function edgeVoiceSelectItemsFromVoices(
  voices: readonly EdgeTtsVoice[] = EDGE_TTS_VOICES,
): CustomSelectItem[] {
  return voices.map((voice) => edgeVoiceToSelectItem(voice));
}
