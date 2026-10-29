import type { WebContents } from "electron";
import { smartFormatCompletionMaxTokens } from "@shared/aiSmartFormatChunkLimits";
import type {
  AISmartFormatCleanupPayload,
  AISmartFormatCleanupResult,
  AiSmartFormatUnifyDialogueQuotes,
} from "@shared/aiSmartFormatTypes";
import { resolveSmartFormatSkillPrompt } from "@shared/aiSkills";
import { readActiveChatEndpoint } from "@shared/aiEndpointProfiles";
import type { AIConfig } from "@shared/aiTypes";
import { chatCompletionOnce } from "./chat";
import { withAiRequestRetries } from "./requestRetry";

const TASK_LABELS = {
  mergeHardWrap: "硬换行合并",
  fixPunctuation: "标点修正",
  unifyDialogueQuotes: "统一对话符号",
  removePromotionalContent: "移除广告/引流",
  removePiracyWatermarks: "移除盗版水印",
  restoreGarbledChars: "乱码恢复",
  restoreAsteriskMasks: "还原 * 屏蔽",
} as const;

function buildRestoreAsteriskSection(enabled: boolean): string[] {
  if (!enabled) return [];
  return [
    "【还原 * 屏蔽】",
    "正文中因审核/和谐用 * 代替的字或词（如 某*、**、打*、*人），在上下文足够明确时尽量还原为合理汉字。",
    "勿处理整行或接近整行仅由 * 构成的分隔线（通常连续 8 个及以上 *，如 *****************）。",
    "勿改 Markdown 强调、数学乘号、列表符号等正当 * 用法；不确定时保留 *，不要编造。",
  ];
}

function buildRemovePiracyWatermarkSection(enabled: boolean): string[] {
  if (!enabled) return [];
  return [
    "【移除盗版水印】",
    "删除句中或段内插入的防盗版/反采集杂符（非编码乱码、非站名引流）：中英数字与符号胡乱混排、生僻字夹符号、圈号㊀-㊿/①-⑳、〖〗〈〉、斜杠/反斜杠、○◆●等孤立符号串。",
    "示例形态：揪○…②〉玑、1ling…⑧、- 月*漪/泣②sa/…、〆（九）卅～⑦… 等插入正文的噪声片段。",
    "仅删明显水印片段，勿删正文汉字、对话、标点与章节分隔线（整行 ***************** 等）；勿尝试「还原」水印含义；不确定时保留。",
  ];
}

function buildRemovePromotionalSection(enabled: boolean): string[] {
  if (!enabled) return [];
  return [
    "【移除广告/引流】",
    "删除明显属于盗版站/聚合站的推广、水印或引流信息（如「发布于：www.xxx.com」「看免费小说，就来 xxx 网」、整行域名、求收藏/求点击站外链接等）。",
    "仅删站宣行或片段，勿删正文剧情、作者后记、版权声明；文内正当出现的网址若属于情节须保留。不确定时保留。",
  ];
}

function buildMergeHardWrapSection(enabled: boolean): string[] {
  if (!enabled) return [];
  return [
    "【硬换行合并】",
    "将同一自然段内因排版产生的句中强行换行合并为一行（中文相邻行之间不加空格）。保留章节/ATX 标题行本身、诗歌/歌词、列表、作者刻意单独成行的短句。",
    "`# 作者简介`、`# 内容简介` 等标题**下一行起**，若为连贯叙述（非诗歌、非逐条列表），**仍须**合并句中硬换行。",
    "「保持原样」仅指站点转载头、作品信息卡（书名/作者/状态等字段堆砌），**不**适用于标题下的正文段落；勿因标题含「简介」「作者」等字样而跳过合并。",
  ];
}

function buildDialogueQuoteUnifySection(
  mode: AiSmartFormatUnifyDialogueQuotes,
): string[] {
  if (mode === "none") return [];
  const style =
    mode === "double"
      ? "弯引号 “”（左 U+201C、右 U+201D）"
      : "「」";
  const example =
    mode === "double"
      ? "示例：「你是谁啊？」→ “你是谁啊？”"
      : "示例：“你是谁啊？”→ 「你是谁啊？」";
  return [
    "【统一对话符号】",
    `仅对**真正的角色对白**统一引号为 ${style}；与目标不一致的「」、『』、“” 等须替换。`,
    example,
    "**禁止**对非对白文本改引号，包括但不限于：书名/作者/状态/简介等元信息块（如整段『书名…/作者：…』『内容简介：…』）、章节标题、旁白叙述、标注/说明性括注、书名号《》内标题。",
    "若一行或一段是站点转载头、作品信息卡、版权说明等（常由成对『』或「」整体包裹且内含「作者」「简介」「更新到」等字段），勿把外层括号当作对白引号替换；**仅指引号**，不禁止硬换行合并标题下的连贯叙述。",
    "不确定某处是否为角色开口说话时，**保持原引号不变**；勿改英文对白里的半角引号。",
  ];
}

function buildPreserveHtmlStructureSection(preserveHtml: boolean): string[] {
  if (!preserveHtml) return [];
  return [
    "【保留 HTML 结构】",
    "用户已关闭「清理 HTML 残留」：正文中的 HTML 标签与节点须**原样保留**（如 `<span id=\"…\">`、`<br>`、`<div>` 等），不得删除、合并、改写 tag 名或属性，不得把仅含 HTML 的行当作空行去掉。",
    "Markdown 语法（`![](…)`、`[文字](#fragment)` 等）须一并保留。",
    "与其它已启用子任务冲突时，以保留 HTML/Markdown 结构为准。",
  ];
}

function buildSmartFormatSystemPrompt(
  opts: {
    mergeHardWrap: boolean;
    fixPunctuation: boolean;
    unifyDialogueQuotes: AiSmartFormatUnifyDialogueQuotes;
    removePromotionalContent: boolean;
    removePiracyWatermarks: boolean;
    restoreGarbledChars: boolean;
    restoreAsteriskMasks: boolean;
    /** false 表示用户关闭「清理 HTML 残留」，须向模型强调保留 HTML */
    cleanHtmlRemnants: boolean;
  },
  skillPrompt: string,
): string {
  const enabled: string[] = [];
  if (opts.mergeHardWrap) enabled.push(TASK_LABELS.mergeHardWrap);
  if (opts.fixPunctuation) enabled.push(TASK_LABELS.fixPunctuation);
  if (opts.unifyDialogueQuotes !== "none") {
    enabled.push(TASK_LABELS.unifyDialogueQuotes);
  }
  if (opts.removePromotionalContent) {
    enabled.push(TASK_LABELS.removePromotionalContent);
  }
  if (opts.removePiracyWatermarks) {
    enabled.push(TASK_LABELS.removePiracyWatermarks);
  }
  if (opts.restoreGarbledChars) enabled.push(TASK_LABELS.restoreGarbledChars);
  if (opts.restoreAsteriskMasks) enabled.push(TASK_LABELS.restoreAsteriskMasks);

  const scope =
    enabled.length > 0
      ? [
          "【本次执行范围】仅执行以下子任务（未列出的不要执行）：",
          ...enabled.map((t) => `- ${t}`),
        ]
      : [];

  const allowsPunctuationEdits =
    opts.fixPunctuation || opts.unifyDialogueQuotes !== "none";
  const allowsContentDeletion =
    opts.removePromotionalContent || opts.removePiracyWatermarks;
  const allowsCoreSubstitution =
    opts.restoreGarbledChars || opts.restoreAsteriskMasks;

  const constraint4 = allowsContentDeletion
    ? allowsPunctuationEdits || allowsCoreSubstitution
      ? "4. 移除广告/引流/盗版水印时仅可删除站宣或句中杂符水印；标点/引号修正时仅可增删标点与多余空格；乱码/* 屏蔽还原时仅可替换明显错误或被 * 代替的字。正文须保持原有语序，不得改写剧情；行数与换行结构仅在合并硬换行或删除站宣行时允许减少。"
      : "4. 仅可删除明显站宣/引流行、句中盗版杂符水印或片段，正文汉字须保持原有顺序，不得改写剧情；行数可在删除站宣行时减少。"
    : allowsCoreSubstitution
      ? "4. 乱码/* 屏蔽还原时仅可替换被 * 或乱码占位的字，其余汉字须保持原有顺序与语序；标点修正时仅可增删标点与多余空格；行数与换行结构仅在合并硬换行时允许减少换行。"
      : allowsPunctuationEdits
        ? "4. 标点/对话引号修正时仅可增删标点与多余空格，汉字字序必须与输入一致（含禁止「的/地/得」互替）；行数与换行结构仅在合并硬换行时允许减少换行。"
        : "4. 输出必须与用户给出的正文段落一一对应，行数与换行结构仅在合并硬换行时允许减少换行。";

  const constraints = [
    "1. 禁止改写剧情、人名、数字、语序；禁止润色文风。",
    "2. 不要调整空行留白（段间保持与输入相同的空行结构；删除站宣行除外）。",
    "3. 只输出修正后的正文，不要解释、不要 Markdown 代码块。",
    constraint4,
    "5. 无法判断时保持原样。",
    "6. 只输出【待校对正文】范围内的文字；不得包含【上文参考】【下文参考】中的句子，不得续写或扩写。",
    "7. 禁止「的 / 地 / 得」语法互替（如「用力的攥」→「用力地攥」）；网络小说口语混用须原样保留，不得按语法规格改写。",
  ];

  return [
    skillPrompt.trim(),
    "",
    ...scope,
    "",
    ...buildMergeHardWrapSection(opts.mergeHardWrap),
    ...(opts.mergeHardWrap ? [""] : []),
    ...buildDialogueQuoteUnifySection(opts.unifyDialogueQuotes),
    ...(opts.unifyDialogueQuotes !== "none" ? [""] : []),
    ...buildRemovePromotionalSection(opts.removePromotionalContent),
    ...(opts.removePromotionalContent ? [""] : []),
    ...buildRemovePiracyWatermarkSection(opts.removePiracyWatermarks),
    ...(opts.removePiracyWatermarks ? [""] : []),
    ...buildRestoreAsteriskSection(opts.restoreAsteriskMasks),
    ...(opts.restoreAsteriskMasks ? [""] : []),
    ...buildPreserveHtmlStructureSection(!opts.cleanHtmlRemnants),
    ...(!opts.cleanHtmlRemnants ? [""] : []),
    "【硬性约束（本次）】",
    ...constraints,
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
}

function buildUserMessage(segment: {
  text: string;
  contextBefore?: string;
  contextAfter?: string;
}): string {
  const parts: string[] = [];
  const before = (segment.contextBefore ?? "").trim();
  const after = (segment.contextAfter ?? "").trim();
  if (before) {
    parts.push("【上文参考，勿修改】", before, "");
  }
  parts.push("【待校对正文】", segment.text);
  parts.push(
    "",
    "（只输出上方【待校对正文】的修正结果；上文/下文参考仅供理解，勿写入输出。）",
  );
  if (after) {
    parts.push("", "【下文参考，勿修改】", after);
  }
  return parts.join("\n");
}

function parseUnifyDialogueQuotes(
  raw: unknown,
): AiSmartFormatUnifyDialogueQuotes {
  if (raw === "none" || raw === "double" || raw === "corner") return raw;
  return "double";
}

export async function runSmartFormatCleanupSegment(opts: {
  payload: AISmartFormatCleanupPayload;
  config: AIConfig;
  webContents: WebContents;
  signal?: AbortSignal;
}): Promise<AISmartFormatCleanupResult> {
  const { payload, config, signal } = opts;
  const chat = readActiveChatEndpoint(config);
  if (!chat.model.trim()) {
    return {
      requestId: payload.requestId,
      text: payload.segment.text,
      error: "未配置对话模型",
    };
  }

  const unifyDialogueQuotes = parseUnifyDialogueQuotes(
    payload.unifyDialogueQuotes,
  );

  const needsLlm =
    payload.mergeHardWrap ||
    payload.fixPunctuation ||
    unifyDialogueQuotes !== "none" ||
    payload.removePromotionalContent ||
    payload.removePiracyWatermarks ||
    payload.restoreGarbledChars ||
    payload.restoreAsteriskMasks;
  if (!needsLlm) {
    return { requestId: payload.requestId, text: payload.segment.text };
  }

  const skillPrompt =
    payload.skillPrompt?.trim() || resolveSmartFormatSkillPrompt(undefined);
  const system = buildSmartFormatSystemPrompt(
    {
      mergeHardWrap: payload.mergeHardWrap,
      fixPunctuation: payload.fixPunctuation,
      unifyDialogueQuotes,
      removePromotionalContent: payload.removePromotionalContent,
      removePiracyWatermarks: payload.removePiracyWatermarks,
      restoreGarbledChars: payload.restoreGarbledChars,
      restoreAsteriskMasks: payload.restoreAsteriskMasks,
      cleanHtmlRemnants: payload.cleanHtmlRemnants !== false,
    },
    skillPrompt,
  );
  const user = buildUserMessage(payload.segment);

  try {
    const { text, usage } = await withAiRequestRetries({
      signal,
      onRetry: (attempt, maxRetries) => {
        opts.webContents.send("ai:text-format:progress", {
          requestId: payload.requestId,
          current: 0,
          total: 1,
          label: payload.segment.id,
          retryAttempt: attempt,
          maxRetries,
        });
      },
      run: () =>
        chatCompletionOnce({
          chat,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0,
          maxTokens: smartFormatCompletionMaxTokens(
            payload.segment.text.length,
            chat.maxTokens,
          ),
          signal,
        }),
    });
    const tokenFields =
      usage != null
        ? { tokenUsage: usage, tokenUsageAvailable: true as const }
        : {};
    const cleaned = text.trim();
    if (!cleaned) {
      return {
        requestId: payload.requestId,
        text: payload.segment.text,
        error: "模型未返回正文",
        ...tokenFields,
      };
    }
    return { requestId: payload.requestId, text: cleaned, ...tokenFields };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      requestId: payload.requestId,
      text: payload.segment.text,
      error: message,
    };
  }
}
