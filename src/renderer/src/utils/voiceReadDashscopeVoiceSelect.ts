import type { CustomSelectItem } from "../components/AppCustomSelect.vue";
import {
  DASHSCOPE_TTS_VOICES,
  findDashscopeTtsVoice,
  groupDashscopeTtsVoices,
  type DashscopeTtsVoice,
} from "@shared/voiceReadDashscopeVoices";
import { voiceReadGenderPrefixHtml } from "./voiceReadGenderPrefixHtml";

export function dashscopeVoiceToSelectItem(
  voice: DashscopeTtsVoice,
): CustomSelectItem {
  return {
    kind: "item",
    id: voice.id,
    label: voice.label,
    description: voice.description,
    prefixHtml: voiceReadGenderPrefixHtml(voice.gender),
  };
}

export function dashscopeVoiceGroupsToSelectItems(
  groups: ReturnType<typeof groupDashscopeTtsVoices> = groupDashscopeTtsVoices(),
): CustomSelectItem[] {
  const items: CustomSelectItem[] = [];
  for (const [groupLabel, voices] of groups) {
    items.push({ kind: "groupLabel", label: groupLabel });
    for (const voice of voices) {
      items.push(dashscopeVoiceToSelectItem(voice));
    }
  }
  return items;
}

export function dashscopeFlatVoiceOptionsToSelectItems(
  options: readonly { id: string; label: string }[],
): CustomSelectItem[] {
  return options.map((opt) => {
    const voice = findDashscopeTtsVoice(opt.id);
    if (voice) return dashscopeVoiceToSelectItem(voice);
    return {
      kind: "item" as const,
      id: opt.id,
      label: opt.label,
      prefixHtml: voiceReadGenderPrefixHtml(),
    };
  });
}

export function dashscopeVoiceSelectItems(): CustomSelectItem[] {
  return DASHSCOPE_TTS_VOICES.map((voice) => dashscopeVoiceToSelectItem(voice));
}
