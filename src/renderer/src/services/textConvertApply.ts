import {
  convertDigitsWidth,
  convertLettersWidth,
} from "@shared/textWidthConvert";
import type { HighlightWordsByIndex } from "../stores/fileMetaStore";
import {
  resolveOpenCcConfig,
  type TextConvertWidthMode,
  type TextConvertZhMode,
} from "@shared/textConvertTypes";

export type TextDisplayConvertOptions = {
  zh: TextConvertZhMode;
  letter: TextConvertWidthMode;
  digit: TextConvertWidthMode;
};

export async function applyTextDisplayConverts(
  text: string,
  options: TextDisplayConvertOptions,
): Promise<string> {
  let result = text;
  const openCcConfig = resolveOpenCcConfig(options.zh);
  if (openCcConfig) {
    result = await window.colorTxt.convertTextOpenCc(result, openCcConfig);
  }
  if (options.letter !== "off") {
    result = convertLettersWidth(result, options.letter);
  }
  if (options.digit !== "off") {
    result = convertDigitsWidth(result, options.digit);
  }
  return result;
}

export async function applyTextConvertZh(
  text: string,
  mode: TextConvertZhMode,
): Promise<string> {
  const config = resolveOpenCcConfig(mode);
  if (!config) return text;
  return window.colorTxt.convertTextOpenCc(text, config);
}

export function applyTextConvertLetters(
  text: string,
  mode: TextConvertWidthMode,
): string {
  return convertLettersWidth(text, mode);
}

export function applyTextConvertDigits(
  text: string,
  mode: TextConvertWidthMode,
): string {
  return convertDigitsWidth(text, mode);
}

/** 只读展示层：将高亮词表各词条经与正文相同的转换规则处理 */
export async function applyTextDisplayConvertsToHighlightWordsByIndex(
  map: HighlightWordsByIndex | undefined,
  options: TextDisplayConvertOptions,
): Promise<HighlightWordsByIndex | undefined> {
  if (!map) return undefined;
  const out: HighlightWordsByIndex = {};
  for (const [key, groups] of Object.entries(map)) {
    const convertedGroups: string[][] = [];
    for (const group of groups) {
      const converted: string[] = [];
      for (const word of group) {
        if (!word) continue;
        converted.push(await applyTextDisplayConverts(word, options));
      }
      if (converted.length > 0) convertedGroups.push(converted);
    }
    if (convertedGroups.length > 0) out[key] = convertedGroups;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
