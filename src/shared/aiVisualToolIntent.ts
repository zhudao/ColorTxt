import { resolveMindmapInjectHintForTurn } from "./aiMindmapIntent";
import {
  detectWordcloudIntent,
  resolveWordcloudInjectHintForTurn,
} from "./aiWordcloudIntent";

/** 与词云同句出现、表示用户同时要思维导图/关系类可视化时判定为「双工具」 */
const MINDMAP_CUE_FOR_BOTH = [
  /思维导图/u,
  /心智图/u,
  /知识图/u,
  /概念图/u,
  /结构图/u,
  /mind\s*map/i,
  /(?:人物)?关系图/u,
  /人物关系(?!词云)/u,
  /人际关系(?!词云)/u,
  /导图/u,
] as const;

/** 用户是否在同一轮里显式同时要词云 + 思维导图（或关系图/人物关系等） */
export function userExplicitlyWantsBothVisualTools(userText: string): boolean {
  if (!detectWordcloudIntent(userText)) return false;
  const t = userText.trim();
  return MINDMAP_CUE_FOR_BOTH.some((p) => p.test(t));
}

export function resolveVisualToolInjectHintsForTurn(opts: {
  userText: string;
  autoMindmapOnSummaryAndCharacters: boolean;
  chapterMatchRuleOnlyTurn: boolean;
}): {
  mindmapInjectHint: string | null;
  wordcloudInjectHint: string | null;
} {
  const mindmapInjectHint = resolveMindmapInjectHintForTurn({
    userText: opts.userText,
    autoMindmapOnSummaryAndCharacters: opts.autoMindmapOnSummaryAndCharacters,
    chapterMatchRuleOnlyTurn: opts.chapterMatchRuleOnlyTurn,
  });
  const wordcloudInjectHint = resolveWordcloudInjectHintForTurn({
    userText: opts.userText,
    chapterMatchRuleOnlyTurn: opts.chapterMatchRuleOnlyTurn,
  });

  if (!mindmapInjectHint || !wordcloudInjectHint) {
    return { mindmapInjectHint, wordcloudInjectHint };
  }

  if (userExplicitlyWantsBothVisualTools(opts.userText)) {
    return { mindmapInjectHint, wordcloudInjectHint };
  }

  /** 默认互斥：用户提到词云时优先词云，避免「生成角色词云」等同时触发人物类思维导图 */
  return { mindmapInjectHint: null, wordcloudInjectHint };
}
