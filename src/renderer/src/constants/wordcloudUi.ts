import { getPresetCssStack } from "../utils/presetFontDefinitions";

export type WordcloudAngleMode = "horizontal" | "mixed" | "random";

export const WORDCLOUD_DEFAULT_FONT_FAMILY = getPresetCssStack("kinghwa");

export const WORDCLOUD_DEFAULT_ANGLE_MODE: WordcloudAngleMode = "horizontal";

export const WORDCLOUD_ANGLE_OPTIONS: ReadonlyArray<{
  value: WordcloudAngleMode;
  label: string;
}> = [
  { value: "horizontal", label: "横排" },
  { value: "mixed", label: "横竖混排" },
  { value: "random", label: "随机" },
] as const;

export function parseWordcloudAngleMode(value: unknown): WordcloudAngleMode | null {
  if (value === "horizontal" || value === "mixed" || value === "random") {
    return value;
  }
  return null;
}

export function wordcloudAngleModeLabel(mode: WordcloudAngleMode): string {
  return WORDCLOUD_ANGLE_OPTIONS.find((o) => o.value === mode)?.label ?? "横排";
}
