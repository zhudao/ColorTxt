import type { CustomSelectItem } from "../components/AppCustomSelect.vue";
import {
  VOLCENGINE_TTS_VOICE_GROUPS,
  type VolcengineTtsVoice,
} from "@shared/voiceReadVolcengineVoices";
import { voiceReadGenderPrefixHtml } from "./voiceReadGenderPrefixHtml";

export function volcengineVoiceToSelectItem(
  voice: VolcengineTtsVoice,
): CustomSelectItem {
  return {
    kind: "item",
    id: voice.id,
    label: voice.label,
    description: voice.description,
    tags: voice.tags,
    prefixHtml: voiceReadGenderPrefixHtml(voice.gender),
  };
}

function buildVolcengineVoiceSelectItems(
  groups: typeof VOLCENGINE_TTS_VOICE_GROUPS,
): CustomSelectItem[] {
  const items: CustomSelectItem[] = [];
  for (const [groupLabel, voices] of groups) {
    items.push({ kind: "groupLabel", label: groupLabel });
    for (const voice of voices) {
      items.push(volcengineVoiceToSelectItem(voice));
    }
  }
  return items;
}

/** 444 项下拉数据只构建一次；AppCustomSelect 按只读列表过滤，不会改这份数组 */
export const VOLCENGINE_VOICE_SELECT_ITEMS: readonly CustomSelectItem[] =
  buildVolcengineVoiceSelectItems(VOLCENGINE_TTS_VOICE_GROUPS);

export function volcengineVoiceGroupsToSelectItems(
  groups: typeof VOLCENGINE_TTS_VOICE_GROUPS = VOLCENGINE_TTS_VOICE_GROUPS,
): CustomSelectItem[] {
  if (groups === VOLCENGINE_TTS_VOICE_GROUPS) {
    return VOLCENGINE_VOICE_SELECT_ITEMS as CustomSelectItem[];
  }
  return buildVolcengineVoiceSelectItems(groups);
}
