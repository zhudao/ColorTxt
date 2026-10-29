import type { CustomSelectItem } from "../components/AppCustomSelect.vue";
import {
  inferMinimaxVoiceGender,
} from "@shared/voiceReadMinimaxVoiceGender";
import type { VoiceReadVoiceOption } from "@shared/voiceReadSynthesis";
import { voiceReadGenderPrefixHtml } from "./voiceReadGenderPrefixHtml";

export function minimaxVoiceToSelectItem(
  voice: VoiceReadVoiceOption,
): CustomSelectItem {
  const gender =
    voice.gender ??
    inferMinimaxVoiceGender(voice.id, voice.label, voice.description);
  return {
    kind: "item",
    id: voice.id,
    label: voice.label,
    description: voice.description,
    prefixHtml: voiceReadGenderPrefixHtml(gender),
  };
}

export function minimaxFlatVoiceOptionsToSelectItems(
  voices: readonly VoiceReadVoiceOption[],
): CustomSelectItem[] {
  return voices.map((voice) => minimaxVoiceToSelectItem(voice));
}

export function minimaxVoiceGroupsToSelectItems(
  groups: ReadonlyArray<readonly [string, readonly VoiceReadVoiceOption[]]>,
  localeLabel: (locale: string) => string,
): CustomSelectItem[] {
  const items: CustomSelectItem[] = [];
  for (const [locale, voices] of groups) {
    items.push({ kind: "groupLabel", label: localeLabel(locale) });
    for (const voice of voices) {
      items.push(minimaxVoiceToSelectItem(voice));
    }
  }
  return items;
}
