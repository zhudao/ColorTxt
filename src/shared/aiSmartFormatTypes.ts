import type { AITokenUsageTotals } from "./aiTokenUsage";

/** 编辑模式「AI 智能排版」用户设置（持久化于 colorTxt.settings） */
export type AiSmartFormatUnifyDialogueQuotes = "none" | "double" | "corner";

export type AiSmartFormatSettings = {
  mergeHardWrap: boolean;
  /** 标点规范化：配对、半角转全角、补充缺失标点等 */
  fixPunctuation: boolean;
  /** 对白引号统一风格；`none` 表示不处理 */
  unifyDialogueQuotes: AiSmartFormatUnifyDialogueQuotes;
  /** 移除站点广告/引流水印等（默认关） */
  removePromotionalContent: boolean;
  /** 移除句中防盗版/反采集杂符水印（默认关） */
  removePiracyWatermarks: boolean;
  restoreGarbledChars: boolean;
  /** 尝试还原正文中的 * 敏感词屏蔽（默认关） */
  restoreAsteriskMasks: boolean;
  /** 本地解码 HTML 实体并去除 br 等标签（默认开） */
  cleanHtmlRemnants: boolean;
  /** 排版完成后自动压缩空行（默认开） */
  autoCompressBlank: boolean;
  /** 排版完成后自动行首缩进（默认开） */
  autoLeadIndent: boolean;
};

export const AI_SMART_FORMAT_DIALOGUE_QUOTE_OPTIONS: readonly {
  id: AiSmartFormatUnifyDialogueQuotes;
  label: string;
}[] = [
  { id: "none", label: "不处理" },
  { id: "double", label: "\u201C\u201D" },
  { id: "corner", label: "「」" },
];

export function aiSmartFormatDialogueQuoteLabel(
  id: AiSmartFormatUnifyDialogueQuotes,
): string {
  return (
    AI_SMART_FORMAT_DIALOGUE_QUOTE_OPTIONS.find((o) => o.id === id)?.label ??
    AI_SMART_FORMAT_DIALOGUE_QUOTE_OPTIONS[1]!.label
  );
}

export const defaultAiSmartFormatSettings: AiSmartFormatSettings = {
  mergeHardWrap: true,
  fixPunctuation: true,
  unifyDialogueQuotes: "double",
  removePromotionalContent: true,
  removePiracyWatermarks: true,
  restoreGarbledChars: true,
  restoreAsteriskMasks: true,
  cleanHtmlRemnants: true,
  autoCompressBlank: true,
  autoLeadIndent: true,
};

export function mergeAiSmartFormatSettings(
  raw: Partial<AiSmartFormatSettings> | undefined,
): AiSmartFormatSettings {
  const d = defaultAiSmartFormatSettings;
  if (!raw) return { ...d };
  return {
    mergeHardWrap:
      typeof raw.mergeHardWrap === "boolean" ? raw.mergeHardWrap : d.mergeHardWrap,
    fixPunctuation:
      typeof raw.fixPunctuation === "boolean"
        ? raw.fixPunctuation
        : typeof (raw as { fixQuotes?: boolean }).fixQuotes === "boolean"
          ? (raw as { fixQuotes: boolean }).fixQuotes
          : d.fixPunctuation,
    unifyDialogueQuotes:
      raw.unifyDialogueQuotes === "none" ||
      raw.unifyDialogueQuotes === "double" ||
      raw.unifyDialogueQuotes === "corner"
        ? raw.unifyDialogueQuotes
        : d.unifyDialogueQuotes,
    removePromotionalContent:
      typeof raw.removePromotionalContent === "boolean"
        ? raw.removePromotionalContent
        : d.removePromotionalContent,
    removePiracyWatermarks:
      typeof raw.removePiracyWatermarks === "boolean"
        ? raw.removePiracyWatermarks
        : d.removePiracyWatermarks,
    restoreGarbledChars:
      typeof raw.restoreGarbledChars === "boolean"
        ? raw.restoreGarbledChars
        : d.restoreGarbledChars,
    restoreAsteriskMasks:
      typeof raw.restoreAsteriskMasks === "boolean"
        ? raw.restoreAsteriskMasks
        : d.restoreAsteriskMasks,
    cleanHtmlRemnants:
      typeof raw.cleanHtmlRemnants === "boolean"
        ? raw.cleanHtmlRemnants
        : d.cleanHtmlRemnants,
    autoCompressBlank:
      typeof raw.autoCompressBlank === "boolean"
        ? raw.autoCompressBlank
        : d.autoCompressBlank,
    autoLeadIndent:
      typeof raw.autoLeadIndent === "boolean"
        ? raw.autoLeadIndent
        : d.autoLeadIndent,
  };
}

export function aiSmartFormatHasAnyTask(s: AiSmartFormatSettings): boolean {
  return (
    s.mergeHardWrap ||
    s.fixPunctuation ||
    s.unifyDialogueQuotes !== "none" ||
    s.removePromotionalContent ||
    s.removePiracyWatermarks ||
    s.restoreGarbledChars ||
    s.restoreAsteriskMasks ||
    s.cleanHtmlRemnants ||
    s.autoCompressBlank ||
    s.autoLeadIndent
  );
}

export function aiSmartFormatNeedsLlm(s: AiSmartFormatSettings): boolean {
  return (
    s.mergeHardWrap ||
    s.fixPunctuation ||
    s.unifyDialogueQuotes !== "none" ||
    s.removePromotionalContent ||
    s.removePiracyWatermarks ||
    s.restoreGarbledChars ||
    s.restoreAsteriskMasks
  );
}

export type AISmartFormatSegmentInput = {
  id: string;
  text: string;
  contextBefore?: string;
  contextAfter?: string;
};

export type AISmartFormatCleanupPayload = {
  requestId: number;
  segment: AISmartFormatSegmentInput;
  mergeHardWrap: boolean;
  fixPunctuation: boolean;
  unifyDialogueQuotes: AiSmartFormatUnifyDialogueQuotes;
  removePromotionalContent: boolean;
  removePiracyWatermarks: boolean;
  restoreGarbledChars: boolean;
  restoreAsteriskMasks: boolean;
  /** 是否已在本地清理 HTML 残留；false 时系统提示词强调保留 HTML 结构 */
  cleanHtmlRemnants?: boolean;
  /** 来自「技能 · 智能排版」的有效提示词；缺省时主进程用内置默认 */
  skillPrompt?: string;
};

export type AISmartFormatProgressEvent = {
  requestId: number;
  current: number;
  total: number;
  label: string;
  retryAttempt?: number;
  maxRetries?: number;
};

export type AISmartFormatCleanupResult = {
  requestId: number;
  text: string;
  error?: string;
  tokenUsage?: AITokenUsageTotals;
  tokenUsageAvailable?: boolean;
};
