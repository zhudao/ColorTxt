import { icons } from "../icons";

export type VoiceReadGender = "male" | "female";

export function voiceReadGenderPrefixHtml(
  gender?: VoiceReadGender | null,
): string {
  let icon: string;
  let toneClass: string;
  if (gender === "male") {
    icon = icons.genderMale;
    toneClass = "voiceReadGenderPrefix--male";
  } else if (gender === "female") {
    icon = icons.genderFemale;
    toneClass = "voiceReadGenderPrefix--female";
  } else {
    icon = icons.genderUnknown;
    toneClass = "voiceReadGenderPrefix--unknown";
  }
  return `<span class="voiceReadGenderPrefix ${toneClass}" aria-hidden="true">${icon}</span>`;
}
