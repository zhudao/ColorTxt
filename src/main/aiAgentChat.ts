import type { WebContents } from "electron";
import { fetchChapterPlainTextFromRenderer } from "./aiChapterPlainTextBridge";
import type {
  AIAgentBookMeta,
  AIAgentEnabledSkill,
  AIAgentRendererEvent,
  AIAgentStartPayload,
  AIChatEndpoint,
  AIChatToolCall,
  AIConfig,
  AIEmbeddingEndpoint,
} from "@shared/aiTypes";
import {
  AI_USER_VISIBLE_CH_REF_RULE,
  formatAiToolChapterHeading,
} from "@shared/aiChapterRefPrompt";
import { CHAPTER_MATCH_RULES_SKILL_ID } from "@shared/aiAgentSkillToolNames";
import { isChapterMatchRuleAgentTurn } from "@shared/chapterMatchAgentTurn";
import {
  agentSkillToolFunctionName,
  buildAgentToolsWithSkills,
  findAgentSkillByToolName,
  runGetSkillsTool,
  runSkillInvokeTool,
} from "./aiAgentTools";
import { embedTexts } from "./aiEmbedding";
import {
  appendAgentMessageRow,
  listChunksForChapter,
  listMessages,
  searchChunks,
} from "./aiVectorDb";
import {
  extractNextDoubleNewline,
  extractSseErrorMessage,
  parseOneSseEventBlock,
  parseSseFrameJson,
  registerChatAbortController,
  releaseChatAbortController,
} from "./aiChat";
import { runCharacterPortraitExtract } from "./aiCharacterPortrait";
import { runMindmapTool } from "./aiMindmapTool";
import {
  MINDMAP_AFTER_RAG_NUDGE,
  resolveMindmapInjectHintForTurn,
  shouldProactiveMindmapNudgeAfterToolRound,
  shouldRequireMindmapAfterRag,
} from "@shared/aiMindmapIntent";
import { inferToolResultOk } from "@shared/aiToolResult";
import { summarizeToolArgumentsJson } from "@shared/toolArgumentsDisplay";
import {
  ZERO_TOKEN_USAGE,
  addTokenUsage,
  extractUsageFromChatJson,
  type AITokenUsageTotals,
} from "@shared/aiTokenUsage";
import {
  RAG_CHAPTER_DIGEST_MAX_CHARS,
  RAG_CHAPTER_NO_COMPRESS_CHARS,
  chapterDigestProgressUi,
  compressChapterToDigest,
  mergeChapterChunkRows,
} from "./aiRagChapterDigest";
import {
  extractReasoningFromStreamDelta,
  resolveAgentDeepThinkingParams,
  shouldAttachReasoningContentOnToolCalls,
} from "./aiChatThinking";

function normalizeBase(u: string): string {
  return u.replace(/\/+$/, "");
}

/** 向渲染进程索取章节原文时的上限（与 currentChapterPlainText HARD_CAP 一致） */
const RAG_CHAPTER_PLAIN_FETCH_MAX = 512_000;

const MAX_SNIPPET_PER_HIT = 900;
const MAX_TOOL_JSON_CHARS = 14_000;
const DEFAULT_MAX_TOOL_ROUNDS = 8;

type MutableToolPart = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

/** 归一化工具参数 JSON，用于判断是否与上一轮完全相同的工具请求（防止模型死循环重复 ragSearch）。 */
function normalizeToolArgumentsJson(args: string): string {
  const t = args.trim() || "{}";
  try {
    return JSON.stringify(JSON.parse(t));
  } catch {
    return t;
  }
}

function fingerprintToolCalls(calls: AIChatToolCall[]): string {
  const parts = [...calls]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) =>
      JSON.stringify({
        name: c.function.name,
        args: normalizeToolArgumentsJson(c.function.arguments),
      }),
    );
  return parts.join("|");
}

function buildAgentSystemPrompt(
  bookMeta: AIAgentBookMeta,
  deepThinking: boolean,
  spoilerSafe: boolean | undefined,
  configExtra: string,
  enabledSkills: AIAgentEnabledSkill[],
  ragEnabled: boolean,
  /** 已启用「章节匹配规则」技能：RAG 不按防剧透截断章节（仅用于标题行格式） */
  chapterMatchSkillRagUnrestricted: boolean,
  /** 本轮以生成章节匹配规则为主：禁止 ragContext */
  chapterMatchRuleOnlyTurn: boolean,
  /** 本轮用户意图触发的 mindmap 附加说明；null 表示不注入 */
  mindmapInjectHint: string | null,
): string {
  const lines: string[] = [
    "你是资深中文小说阅读助手，正在与用户讨论一部长篇作品。",
    "**重要**：预训练知识中**不包含**当前打开这本书的可靠全文，也不要凭书名、作者或对其它版本（如改编、译本）的笼统印象冒充读过原文。",
  ];

  if (ragEnabled && chapterMatchRuleOnlyTurn) {
    lines.push(
      "## 本轮任务：章节匹配规则（优先于其它检索纪律）",
      "用户需要的是应用「章节匹配规则」中的 **一行 JavaScript RegExp 参数字符串**（匹配独占一行的章节标题），**不是**阅读、概括或讨论章节剧情。",
      "**禁止**为本轮调用 **ragContext**（不要读取章节原文或整章提要）。",
      "若用户消息中已有完整章节标题示例行（如「第三十九回 …」「第一章 …」），**必须先**在**对用户的可见回复**中给出 **一个** fenced 代码块（块内仅一行匹配规则）；可调用 **skill_chapter-match-rules** 获取体裁说明。**不得**以「须先检索」为由省略该 fenced 单行。",
      "仅当需要对照全书其它章节的**标题行格式**时，可**可选**调用 **ragSearch**（query 侧重章节标题、回目名等），且**只**用返回片段中的标题行作格式参考；**禁止**据正文情节写规则或剧透。",
      "可调用 **skill_chapter-match-rules**；**不要**为写规则而调用 getSkills 以外的无关技能。",
      AI_USER_VISIBLE_CH_REF_RULE,
      "",
    );
  } else if (ragEnabled) {
    lines.push(
      "你必须使用 ragSearch、ragContext 检索本书正文后再作答；涉及情节、对白、人名与设定时只能依据工具返回的原文；不得在未检索到相关内容时编造，检索不到时应如实说明。",
      "回答时请引用检索结果中的事实。",
      AI_USER_VISIBLE_CH_REF_RULE,
      "## 「本章」类问题（与全书语义检索的配合）",
      "- 下方「当前阅读章节」索引由阅读视口探针推导，与「阅读位置周边」一致；勿仅凭侧栏记忆或对话历史假定章节号。",
      "- 用户提到「本章」「这一章」「当前章」，或要求**总结 / 概括 / 梳理**当前阅读进度下的这一章且索引 ≥0 时：**必须先**调用 ragContext，参数 chapterIndex **等于**该索引（从 0 起），以加载该章正文；**禁止**仅用 ragSearch 代替（检索片段可能来自其它章或不完整）。",
      "- 其它开放式检索可再用 ragSearch；若 ragSearch 返回的章节号与「当前阅读章节」不一致且用户明显在问当前章，以 ragContext(当前索引) 为准。",
      "- ragSearch 在全书范围内按语义取片段，同一问句在不同阅读位置仍可能命中相似块；用户已换章时应优先用 ragContext(当前章索引) 校准，或改写检索关键词并关注返回结果中的章节号。",
      "## 工具使用纪律（避免无效循环）",
      "- 一旦 ragSearch 已返回结果，请阅读其中的 chapterIndex、chapterTitle 与片段正文：chapterIndex 从 0 起，**仅供** ragContext 参数与 `（ch=N）` 的 N；**对用户叙述章节时只写 chapterTitle**，勿写 chapterIndex 或「第 N 章」式换算。",
      "- 若需展开同一章更多原文，应改用 ragContext(chapterIndex)，参数与检索结果中的 chapterIndex 相同（从 0 起），或换用不同的检索关键词。",
      "- ragContext 对**全章**：优先从阅读器取章节原文（与侧栏字数一致）；原文 ≤1 万字时返回完整 mergedMarkdown；超过 1 万字则按每 1 万字一段压缩为全章提要（约 1 万字，`compressed: true`）。向量索引主要用于 ragSearch。",
      "- 信息已足够时，必须结束工具调用，直接输出最终自然语言答案，不要反复检索同一问题。",
      "- 当用户需要**角色外貌**、全身/衣着描写摘要或 **Stable Diffusion 中文 prompt** 草案（侧栏提交 SD 时会自动译英）时，调用 **extractCharacterAppearance**，参数 `characterName` 为角色名；返回 JSON（含 `excerpts`、`appearance_zh`、`sd_prompt_zh`、`negative_zh`、`confidence_note` 及 `gender`、`age_text`、`identity_zh`、`bio_zh`、`relations_zh` 等）与侧栏「角色」同源。用户开启防剧透时工具结果仅含当前阅读章节及之前的片段。",
      "## 思维导图（mindmap 工具）",
      "- 可用 **mindmap** 将章节/全书概括、人物关系、概念结构可视化为导图；须先 **ragSearch** / **ragContext** 再调用；内容概括/人物关系类问题在检索后**必须**调用 mindmap，勿仅用长文代替。",
      "- **全书概括**（如「概括本书内容」）：以 **ragSearch** 多轮/多关键词为主，勿仅用当前章 ragContext。",
      "- `markdown` 使用 `#` / `##` / `###` / `-` 层级；**禁止**在回答正文或工具参数中使用 Mermaid `mindmap` 语法。",
      "",
    );
  } else {
    lines.push(
      "**向量语义检索已在应用中关闭**：当前会话**不提供** ragSearch / ragContext，无法检索全书正文分块。",
      "涉及本书具体情节、对白、人名与设定时：若用户消息或对话历史中**没有**给出相应原文摘录，请如实说明当前无法检索全书，并建议用户在 **设置 → 向量模型** 中启用向量模型、配置嵌入接口并等待索引构建完成后再提问。",
      "不得编造本书细节；可基于用户已粘贴或引用的文字作答。",
      AI_USER_VISIBLE_CH_REF_RULE,
      "",
    );
  }

  lines.push(
    "## 书籍信息（不含正文）",
    `- 书名：${bookMeta.fileTitle}`,
    `- 总章节数：${bookMeta.chapterCount}`,
    `- 当前阅读章节：${bookMeta.currentChapterTitle?.trim() || "（未能解析章节）"}${
      bookMeta.currentChapterIndex >= 0
        ? `（内部 chapterIndex=${bookMeta.currentChapterIndex}，勿写入用户可见回复）`
        : ""
    }`,
    "",
  );

  const surrounding = (bookMeta.surroundingText ?? "").trim();
  if (surrounding) {
    const quoted = surrounding
      .split("\n")
      .map((ln) => (ln.length === 0 ? ">" : `> ${ln}`))
      .join("\n");
    const surroundingNote =
      ragEnabled && chapterMatchRuleOnlyTurn
        ? "下列内容来自用户当前选中文本（若有）与阅读视窗附近，仅用于判断阅读位置；**不等于**章节标题样例。本轮为章节匹配规则任务，**不要**据此调用 ragContext。"
        : ragEnabled
          ? "下列内容来自用户当前选中文本（若有）与阅读视窗附近，仅用于判断阅读位置；**不等于**整章正文。涉及本章全貌或全书细节仍须使用 ragSearch / ragContext（向量检索开启时），勿仅凭本节臆测。"
          : "下列内容来自用户当前选中文本（若有）与阅读视窗附近，仅用于判断阅读位置；**不等于**整章正文。";
    lines.push("## 阅读位置周边（节选）", surroundingNote, quoted, "");
  }

  if (ragEnabled && !chapterMatchRuleOnlyTurn) {
    lines.push(
      "说明：「本章」「当前章」指下方「当前阅读章节」；正文须通过 ragContext 或 ragSearch 获取，不要臆测。",
      "",
    );
  } else if (!ragEnabled) {
    lines.push(
      surrounding
        ? "说明：「本章」「当前章」指上方书籍信息与周边节选所对应位置；未启用向量检索时除上述节选与用户粘贴外勿编造正文。"
        : "说明：「本章」「当前章」指用户阅读光标所在章节（见上）；在未启用向量检索时，勿臆测正文内容。",
      "",
    );
  }

  if (deepThinking) {
    if (ragEnabled && chapterMatchRuleOnlyTurn) {
      lines.push(
        "深度思考模式下可先归纳用户样例行的格式特征，再给出匹配规则；**仍禁止** ragContext 与剧情叙述。",
        "",
      );
    } else if (ragEnabled) {
      lines.push(
        "请先简要列出检索到的关键依据，再给出结论。",
        "在深度思考模式下允许更充分的推理，但最终回答仍须基于工具检索结果，不得臆造情节。",
        "",
      );
    } else {
      lines.push(
        "在深度思考模式下允许更充分的推理，但若缺乏原文依据，不得编造本书情节。",
        "",
      );
    }
  }

  if (spoilerSafe) {
    const cur = bookMeta.currentChapterIndex;
    const hasChapterCap = typeof cur === "number" && cur >= 0;
    lines.push("## 防剧透模式（已开启）", "");
    if (hasChapterCap) {
      const titleBit = bookMeta.currentChapterTitle?.trim()
        ? ` · ${bookMeta.currentChapterTitle.trim()}`
        : "";
      const spoilerToolRule =
        ragEnabled && chapterMatchRuleOnlyTurn
          ? "2. **本轮为章节匹配规则任务**：**禁止** `ragContext`。若使用 `ragSearch`，**不按防剧透截断章节**，但**仅**用于归纳标题行格式；**不得**叙述、总结或暗示剧情。"
          : ragEnabled && chapterMatchSkillRagUnrestricted
            ? "2. **例外（本轮已启用「章节匹配规则」技能）**：`ragSearch` / `ragContext` **不按防剧透截断章节**，以便从全书抽取章节标题行样本。你**只能**将这些结果用于归纳正则与行格式；**最终回答仍不得**叙述、总结或暗示当前阅读进度之后的剧情。"
          : ragEnabled
            ? "2. **工具层已限制**：`ragSearch` 仅返回当前章及之前的索引片段；`ragContext` 无法拉取当前章之后的原文。勿尝试绕过（例如臆造检索结果）。"
            : "2. 未启用全书检索时，请自律勿透露明显超出用户阅读进度的剧情；不确定是否属于后文时请不写或明确说明无法确认。";
      lines.push(
        `读者当前进度：**第 ${cur + 1} 章**（全书 ${bookMeta.chapterCount} 章）${titleBit}。`,
        "**严格意义下当前章之后的全部正文均属「后文」，不得主动泄露。**",
        "",
        "**必须遵守：**",
        "1. 不得讲述、暗示或总结当前章节之后的剧情、伏笔回收、人物结局或设定揭露。",
        spoilerToolRule,
        "3. 用户明确要求讨论后文或结局时，礼貌拒绝并建议继续阅读；可说明原因是为保护首次阅读体验。",
        "4. 不确定某信息是否来自后文时，宁可不写或明确说明无法在当前模式下确认。",
        "",
        "**仍可讨论：**当前进度及之前的已检索事实、写作手法与主题、与剧情无直接关联的背景知识等。",
        "",
      );
    } else {
      lines.push(
        "当前阅读章节未能可靠解析，无法在工具层过滤后文；请务必自律：**不得透露明显属于用户进度之后的剧情**，亦勿臆测后文。",
        "",
      );
    }
  } else if (ragEnabled) {
    lines.push(
      "## 检索与作答范围",
      "本轮**未**启用防剧透：可使用 ragSearch / ragContext 检索**全书任意章节**原文并作答。",
      "对话历史中若曾有助手自称「仅限前几章」「当前进度之前」等，仅为**当时**开启了防剧透；**本轮不得继续沿用那些自我限制**，除非用户再次开启防剧透。",
      "",
    );
  } else {
    lines.push(
      "## 作答范围",
      "向量检索已关闭，本轮无法按章节拉取全书正文；请勿臆测情节。",
      "",
    );
  }

  if (enabledSkills.length > 0) {
    const skillFactLine =
      ragEnabled && chapterMatchRuleOnlyTurn
        ? "工具返回中的 **skillPrompt** 与 **instruction** 必须遵守；**本轮禁止 ragContext**；用户已给的标题样例优先，须在对用户的回复中交付 fenced 单行匹配规则。"
        : ragEnabled
          ? "工具返回中的 **skillPrompt** 与 **instruction** 必须遵守；**事实内容仍须来自本书**：若尚未检索，请先 **ragSearch** / **ragContext** 再作答，不得臆造情节。"
          : "工具返回中的 **skillPrompt** 与 **instruction** 必须遵守；向量检索未启用时**不得编造本书情节**，只能基于用户已给出的原文或通用阅读方法作答。";
    lines.push(
      "## 技能（可选）",
      "当用户需要特定作答体裁（如章节摘要、概念解释、论证梳理、翻译等）时，可先调用 **getSkills**（参数 `task` 填简短关键词），或直接调用以 **`skill_` 开头的技能工具**（每项对应下方列表）。",
      skillFactLine,
      "",
      "当前已启用的技能工具：",
      ...enabledSkills.map(
        (s) =>
          `- **${agentSkillToolFunctionName(s.id)}**（${s.title}）：${s.description}`,
      ),
      "",
    );
  } else {
    lines.push(
      "## 技能",
      "当前会话未传入已启用技能。用户可在设置 → 技能中启用内置或自定义技能后重试。",
      "",
    );
  }

  lines.push(
    "## 工具返回含 instruction 时",
    ragEnabled
      ? "若某工具结果 JSON 中含 **instruction** 字段（含 getSkills 匹配到的 skillPrompt、或技能工具返回）：请阅读并遵循该 instruction，将其与本书检索结果结合后写出最终回答，避免忽略体裁要求。"
      : "若某工具结果 JSON 中含 **instruction** 字段：请阅读并遵循该 instruction；若无本书原文依据，勿编造情节。",
    "",
  );

  const extra = configExtra.trim();
  if (extra) {
    lines.push("## 用户在设置中附加的说明", extra, "");
  }

  if (mindmapInjectHint?.trim()) {
    lines.push(mindmapInjectHint.trim(), "");
  }

  return lines.join("\n");
}

type ApiMsg =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: AIChatToolCall[];
      /** DeepSeek thinking 模式 + tool_calls 时须原样回传 */
      reasoning_content?: string;
    }
  | { role: "tool"; tool_call_id: string; content: string; name?: string };

function parseReasoningFromPayload(payload: string | null | undefined): string {
  if (!payload?.trim()) return "";
  try {
    const o = JSON.parse(payload) as { reasoning?: string };
    return typeof o.reasoning === "string" ? o.reasoning : "";
  } catch {
    return "";
  }
}

function buildAssistantApiMsg(
  opts: {
    content: string;
    reasoning: string;
    toolCalls?: AIChatToolCall[];
  },
  chatBaseUrl: string,
): Extract<ApiMsg, { role: "assistant" }> {
  const m: Extract<ApiMsg, { role: "assistant" }> = {
    role: "assistant",
    content: opts.content.trim() === "" ? null : opts.content,
  };
  if (opts.toolCalls?.length) {
    m.tool_calls = opts.toolCalls;
    if (shouldAttachReasoningContentOnToolCalls(chatBaseUrl)) {
      m.reasoning_content = opts.reasoning;
    }
  }
  return m;
}

function dbRowsToApiMessages(
  rows: ReturnType<typeof listMessages>,
  chatBaseUrl: string,
): ApiMsg[] {
  const out: ApiMsg[] = [];
  for (const r of rows) {
    if (r.role === "user") {
      out.push({ role: "user", content: r.content });
    } else if (r.role === "assistant") {
      let toolCalls: AIChatToolCall[] | undefined;
      if (r.toolCallsJson?.trim()) {
        try {
          toolCalls = JSON.parse(r.toolCallsJson) as AIChatToolCall[];
        } catch {
          /* ignore */
        }
      }
      out.push(
        buildAssistantApiMsg(
          {
            content: r.content,
            reasoning: parseReasoningFromPayload(r.payload),
            toolCalls,
          },
          chatBaseUrl,
        ),
      );
    } else if (r.role === "tool" && r.toolCallId) {
      out.push({
        role: "tool",
        tool_call_id: r.toolCallId,
        content: r.content,
        ...(r.toolName ? { name: r.toolName } : {}),
      });
    }
  }
  return out;
}

function trimApiTail(msgs: ApiMsg[], slidingWindowSize: number): ApiMsg[] {
  if (slidingWindowSize <= 0) return msgs;
  const cap = Math.max(16, slidingWindowSize * 6);
  return msgs.length <= cap ? msgs : msgs.slice(-cap);
}

/**
 * 每条用户提问时刻的阅读位置（仅注入 API，不写库）。
 * 避免对话历史中上一轮 ragContext/摘要仍在上下文中时，模型误以为「本章」仍指旧章。
 */
function formatReadingAnchorForTurn(
  bookMeta: AIAgentBookMeta,
  ragEnabled: boolean,
  chapterMatchRuleOnlyTurn: boolean,
): string {
  const idx = bookMeta.currentChapterIndex;
  if (typeof idx !== "number" || idx < 0) {
    return "【本轮阅读位置】未能解析章节索引；若用户问「本章」，请如实说明无法定位正文。";
  }
  const title = (bookMeta.currentChapterTitle ?? "").trim() || "（无标题）";
  if (ragEnabled && chapterMatchRuleOnlyTurn) {
    return (
      `【本轮阅读位置｜仅供参考】${title}（内部 chapterIndex=${idx}，勿写入用户可见回复）。` +
      `本轮为**章节匹配规则**任务：**不要**因阅读位置或消息中的回目名调用 ragContext 读取章节原文；优先使用用户消息中的标题样例直接写匹配规则。`
    );
  }
  if (ragEnabled) {
    return (
      `【本轮阅读位置｜须与此对齐】${title}（内部 chapterIndex=${idx}，仅供 ragContext/（ch=N），勿写入用户可见回复）。` +
      `用户刚发起本轮提问时的阅读位置以上为准；若对话历史中仍有其它章节的摘要或工具结果，**不得**据此回答本轮「本章 / 这一章 / 总结本章」类问题，必须重新调用 ragContext(${idx}) 后再作答。`
    );
  }
  return (
    `【本轮阅读位置】${title}。向量检索未启用，无法 ragContext；请勿编造本章情节，可依据系统提示中的节选与用户原文。`
  );
}

function augmentLatestUserWithReadingAnchor(
  msgs: ApiMsg[],
  bookMeta: AIAgentBookMeta,
  ragEnabled: boolean,
  chapterMatchRuleOnlyTurn: boolean,
): ApiMsg[] {
  let idx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]!.role === "user") {
      idx = i;
      break;
    }
  }
  if (idx < 0) return msgs;
  const m = msgs[idx]!;
  if (typeof m.content !== "string") return msgs;
  const anchor = formatReadingAnchorForTurn(
    bookMeta,
    ragEnabled,
    chapterMatchRuleOnlyTurn,
  );
  const next = msgs.slice();
  next[idx] = { role: "user", content: `${anchor}\n\n${m.content}` };
  return next;
}

function mergeToolCallDelta(
  map: Map<number, MutableToolPart>,
  raw: unknown,
): void {
  if (!raw || typeof raw !== "object") return;
  const arr = (raw as Record<string, unknown>).tool_calls;
  if (!Array.isArray(arr)) return;
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const idx =
      typeof o.index === "number" && Number.isFinite(o.index) ? o.index : 0;
    let cur = map.get(idx) ?? {};
    if (typeof o.id === "string") cur = { ...cur, id: o.id };
    if (typeof o.type === "string") cur = { ...cur, type: o.type };
    const fn = o.function;
    if (fn && typeof fn === "object") {
      const f = fn as Record<string, unknown>;
      const prevFn = cur.function ?? {};
      let name = prevFn.name;
      let args = prevFn.arguments ?? "";
      if (typeof f.name === "string") name = f.name;
      if (typeof f.arguments === "string") args += f.arguments;
      cur = {
        ...cur,
        function: { ...prevFn, name, arguments: args },
      };
    }
    map.set(idx, cur);
  }
}

function finalizeToolCalls(
  map: Map<number, MutableToolPart>,
): AIChatToolCall[] {
  const keys = [...map.keys()].sort((a, b) => a - b);
  return keys.map((k, i) => {
    const t = map.get(k)!;
    const id =
      typeof t.id === "string" && t.id.trim() ? t.id : `colortxt_tc_${k}_${i}`;
    const name = t.function?.name?.trim() || "ragSearch";
    const args = t.function?.arguments?.trim() || "{}";
    return {
      id,
      type: "function",
      function: { name, arguments: args },
    };
  });
}

function extractDelta(json: unknown): {
  content?: string;
  reasoning?: string;
  toolCalls?: unknown;
  finishReason?: string;
} {
  if (!json || typeof json !== "object") return {};
  const err = extractSseErrorMessage(json);
  if (err) throw new Error(err);
  const o = json as Record<string, unknown>;
  const ch0 = Array.isArray(o.choices) ? o.choices[0] : undefined;
  if (!ch0 || typeof ch0 !== "object") return {};
  const c = ch0 as Record<string, unknown>;
  const fr = c.finish_reason;
  const delta =
    c.delta && typeof c.delta === "object"
      ? (c.delta as Record<string, unknown>)
      : undefined;
  const content =
    typeof delta?.content === "string" ? delta.content : undefined;
  const reasoning = extractReasoningFromStreamDelta(delta);
  return {
    content,
    reasoning,
    toolCalls: delta?.tool_calls,
    finishReason: typeof fr === "string" ? fr : undefined,
  };
}

async function streamOneRound(opts: {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal: AbortSignal;
  requestId: number;
  emit: (ev: AIAgentRendererEvent) => void;
}): Promise<{
  content: string;
  reasoning: string;
  toolCalls: AIChatToolCall[];
  sawDone: boolean;
  usage: AITokenUsageTotals | null;
}> {
  const { url, headers, body, signal, emit } = opts;
  const res = await fetch(url, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const raw = !res.body ? "" : await res.text().catch(() => "");
    let message = !res.body
      ? `HTTP ${res.status}：响应无正文`
      : `HTTP ${res.status}: ${raw.slice(0, 600)}`;
    if (!res.ok && raw.trim()) {
      try {
        const extracted = extractSseErrorMessage(JSON.parse(raw) as unknown);
        if (extracted) message = extracted;
      } catch {
        /* keep */
      }
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let contentAcc = "";
  let reasoningAcc = "";
  const toolMap = new Map<number, MutableToolPart>();
  let sawDone = false;
  let roundUsage: AITokenUsageTotals | null = null;

  const handleFrame = (frame: string): boolean => {
    const simple = parseOneSseEventBlock(frame);
    if (simple.kind === "done") {
      sawDone = true;
      return true;
    }
    if (simple.kind === "error") {
      throw new Error(simple.message);
    }
    const json = parseSseFrameJson(frame);
    if (!json) return false;
    const usage = extractUsageFromChatJson(json);
    if (usage) roundUsage = usage;
    const d = extractDelta(json);
    if (d.content) {
      contentAcc += d.content;
      emit({
        type: "content_delta",
        requestId: opts.requestId,
        delta: d.content,
      });
    }
    if (d.reasoning) {
      reasoningAcc += d.reasoning;
      emit({
        type: "reasoning_delta",
        requestId: opts.requestId,
        delta: d.reasoning,
      });
    }
    if (d.toolCalls) mergeToolCallDelta(toolMap, { tool_calls: d.toolCalls });
    return false;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nx: ReturnType<typeof extractNextDoubleNewline>;
    while ((nx = extractNextDoubleNewline(buf)).frame !== null) {
      const frame = nx.frame;
      buf = nx.rest;
      if (handleFrame(frame)) {
        return {
          content: contentAcc,
          reasoning: reasoningAcc,
          toolCalls: finalizeToolCalls(toolMap),
          sawDone,
          usage: roundUsage,
        };
      }
    }
  }

  if (buf.trim()) {
    if (handleFrame(buf.trim())) {
      return {
        content: contentAcc,
        reasoning: reasoningAcc,
        toolCalls: finalizeToolCalls(toolMap),
        sawDone,
        usage: roundUsage,
      };
    }
  }

  const toolCalls = finalizeToolCalls(toolMap);
  if (
    !sawDone &&
    toolCalls.length === 0 &&
    contentAcc.trim() === "" &&
    reasoningAcc.trim() === ""
  ) {
    throw new Error("EMPTY_STREAM");
  }

  return {
    content: contentAcc,
    reasoning: reasoningAcc,
    toolCalls,
    sawDone,
    usage: roundUsage,
  };
}

function buildAssistantPayloadJson(opts: {
  reasoning: string;
  tokenUsage: AITokenUsageTotals;
  usageAvailable: boolean;
}): string | null {
  const o: Record<string, unknown> = {};
  if (opts.reasoning.trim()) o.reasoning = opts.reasoning.trim();
  if (opts.usageAvailable || opts.tokenUsage.totalTokens > 0) {
    o.tokenUsage = opts.tokenUsage;
    o.tokenUsageAvailable = opts.usageAvailable;
  }
  return Object.keys(o).length > 0 ? JSON.stringify(o) : null;
}

function previewJson(obj: unknown, max = 280): string {
  try {
    const s = JSON.stringify(obj);
    return s.length <= max ? s : `${s.slice(0, max)}…`;
  } catch {
    return "";
  }
}

async function runRagSearch(
  bookHash: string,
  embedding: AIEmbeddingEndpoint,
  query: string,
  topK: number,
  spoilerMaxChapterIndex: number | null,
  aiConfig: AIConfig,
): Promise<{ preview: string; full: string }> {
  const k = Math.min(12, Math.max(1, topK));
  const vectors = await embedTexts(
    embedding,
    [query.trim() || "."],
    undefined,
    aiConfig,
  );
  const q = vectors[0];
  if (!q) throw new Error("嵌入失败");
  /** 防剧透过滤会丢掉部分命中，先多取候选再筛选 */
  const fetchN =
    spoilerMaxChapterIndex != null ? Math.min(200, Math.max(k * 12, 48)) : k;
  const hits = searchChunks(bookHash, q, fetchN);
  let usable = hits;
  if (spoilerMaxChapterIndex != null) {
    usable = hits.filter((h) => h.chapterIndex <= spoilerMaxChapterIndex);
  }
  const picked = usable.slice(0, k);
  const trimmed = picked.map((h) => ({
    chunkId: h.chunkId,
    chapterIndex: h.chapterIndex,
    chapterTitle: h.chapterTitle,
    content:
      h.content.length > MAX_SNIPPET_PER_HIT
        ? `${h.content.slice(0, MAX_SNIPPET_PER_HIT)}…`
        : h.content,
    charStart: h.charStart,
    charEnd: h.charEnd,
    distance: h.distance,
  }));

  const fullObj: Record<string, unknown> = {
    results: trimmed,
    totalResults: trimmed.length,
  };
  if (spoilerMaxChapterIndex != null) {
    fullObj.spoilerSafe = true;
    fullObj.maxChapterIndexInclusive = spoilerMaxChapterIndex;
    if (trimmed.length === 0 && hits.length > 0) {
      fullObj.notice =
        "防剧透：向量检索到的片段均位于当前阅读章节之后，已全部过滤。请改用已读范围内的具体问题，或关闭防剧透。";
    }
  }
  let full = JSON.stringify(fullObj);
  if (full.length > MAX_TOOL_JSON_CHARS) {
    full = `${full.slice(0, MAX_TOOL_JSON_CHARS)}\n…（结果已截断）`;
  }
  return { preview: previewJson(fullObj), full };
}

async function runRagContext(
  bookHash: string,
  chapterIndex: number,
  maxChars: number,
  range: number | undefined,
  chat: AIChatEndpoint,
  webContents: WebContents,
  onToolProgress?: (progress: { title: string; detail: string }) => void,
  onTokenUsage?: (usage: AITokenUsageTotals) => void,
  signal?: AbortSignal,
): Promise<{ preview: string; full: string }> {
  const rows = listChunksForChapter(bookHash, chapterIndex);

  /** 带 range 的抽样：仍走向量分块节选 */
  if (typeof range === "number" && range >= 0) {
    if (rows.length === 0) {
      const o = { error: "该章无索引分块", chapterIndex };
      const full = JSON.stringify(o);
      return { preview: full, full };
    }
    let selected = rows;
    if (rows.length > 2 * range + 1) {
      const mid = Math.floor(rows.length / 2);
      const start = Math.max(0, mid - range);
      const end = Math.min(rows.length, mid + range + 1);
      selected = rows.slice(start, end);
    }
    const cap = Math.min(24_000, Math.max(2000, maxChars || 12_000));
    let text = "";
    for (const r of selected) {
      const piece = `\n\n---\n${formatAiToolChapterHeading(r.chapterIndex, r.chapterTitle)}\n${r.content}`;
      if (text.length + piece.length > cap) break;
      text += piece;
    }
    const fullObj = {
      chapterIndex,
      mergedMarkdown: text.trim(),
      source: "vector",
      compressed: false,
      truncated: text.length >= cap,
      chunkCount: selected.length,
    };
    let full = JSON.stringify(fullObj);
    if (full.length > MAX_TOOL_JSON_CHARS) {
      full = `${full.slice(0, MAX_TOOL_JSON_CHARS)}\n…（已截断）`;
    }
    return { preview: previewJson(fullObj), full };
  }

  let chapterPlain =
    (await fetchChapterPlainTextFromRenderer(
      webContents,
      chapterIndex,
      RAG_CHAPTER_PLAIN_FETCH_MAX,
    ))?.trim() ?? "";

  let source: "reader" | "vector" = "reader";
  if (!chapterPlain) {
    if (rows.length === 0) {
      const o = { error: "无法获取该章正文（阅读器无内容且向量库无分块）", chapterIndex };
      const full = JSON.stringify(o);
      return { preview: full, full };
    }
    chapterPlain = mergeChapterChunkRows(rows);
    source = "vector";
  }

  const sourceChars = chapterPlain.length;

  if (sourceChars <= RAG_CHAPTER_NO_COMPRESS_CHARS) {
    const fullObj = {
      chapterIndex,
      mergedMarkdown: chapterPlain,
      source,
      compressed: false,
      sourceCharCount: sourceChars,
      truncated: false,
    };
    let full = JSON.stringify(fullObj);
    if (full.length > MAX_TOOL_JSON_CHARS) {
      full = `${full.slice(0, MAX_TOOL_JSON_CHARS)}\n…（已截断）`;
    }
    return { preview: previewJson(fullObj), full };
  }

  let digest: string;
  let compressError: string | undefined;
  try {
    const compressed = await compressChapterToDigest({
      chat,
      fullText: chapterPlain,
      maxDigestChars: RAG_CHAPTER_DIGEST_MAX_CHARS,
      signal,
      onSegmentProgress: (m, n) =>
        onToolProgress?.(chapterDigestProgressUi(m, n)),
    });
    digest = compressed.digest;
    onTokenUsage?.(compressed.usage);
  } catch (e) {
    compressError = e instanceof Error ? e.message : String(e);
    digest = chapterPlain.slice(0, RAG_CHAPTER_DIGEST_MAX_CHARS);
    if (chapterPlain.length > RAG_CHAPTER_DIGEST_MAX_CHARS) {
      digest += "…";
    }
  }

  const fullObj: Record<string, unknown> = {
    chapterIndex,
    mergedMarkdown: digest,
    source,
    compressed: true,
    sourceCharCount: sourceChars,
    digestCharCount: digest.length,
    truncated: false,
    notice:
      "本章超过 1 万字，已按每 1 万字一段压缩为全章提要。写概要请依据此提要；具体对白可再用 ragSearch。",
  };
  if (compressError) {
    fullObj.compressFallback = compressError;
    fullObj.notice =
      "本章超长；压缩调用失败，已退回章首节选。可重试或检查对话模型配置。";
  }
  if (source === "vector") {
    fullObj.vectorFallback = true;
    fullObj.notice =
      "未能从阅读器取得章节原文，已退回向量分块拼接（字数可能偏大）。建议保持阅读器已加载该书。";
  }

  let full = JSON.stringify(fullObj);
  if (full.length > MAX_TOOL_JSON_CHARS) {
    full = `${full.slice(0, MAX_TOOL_JSON_CHARS)}\n…（已截断）`;
  }
  return { preview: previewJson(fullObj), full };
}

async function dispatchTool(
  name: string,
  argsJson: string,
  ctx: {
    bookHash: string;
    embedding: AIEmbeddingEndpoint;
    ragEnabled: boolean;
    defaultTopK: number;
    requestId: number;
    toolCallId: string;
    emit: (ev: AIAgentRendererEvent) => void;
    /** 防剧透：仅允许 chapterIndex ≤ 该值；null 表示不限制 */
    spoilerMaxChapterIndex: number | null;
    enabledSkills: AIAgentEnabledSkill[];
    aiConfig: AIConfig;
    /** extractCharacterAppearance：与 payload.spoilerSafe 一致 */
    portraitSpoilerSafe: boolean;
    /** extractCharacterAppearance：currentChapterIndex，可能为 -1 */
    portraitActiveChapterIdx: number;
    chat: AIChatEndpoint;
    webContents: WebContents;
    onTokenUsage?: (usage: AITokenUsageTotals) => void;
    signal?: AbortSignal;
    chapterMatchRuleOnlyTurn: boolean;
  },
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
  } catch {
    args = {};
  }

  ctx.emit({
    type: "tool_executing",
    requestId: ctx.requestId,
    toolCallId: ctx.toolCallId,
    name,
    argsPreview: summarizeToolArgumentsJson(argsJson),
    argsJson: argsJson.trim() || "{}",
  });

  try {
    if (name === "ragSearch" || name === "ragContext") {
      if (!ctx.ragEnabled) {
        throw new Error(
          "向量模型未启用（请在设置 → 向量模型中开启并构建索引）。",
        );
      }
    }
    if (name === "ragSearch") {
      const query = String(args.query ?? "").trim();
      const topK =
        typeof args.topK === "number" && Number.isFinite(args.topK)
          ? args.topK
          : ctx.defaultTopK;
      const { preview, full } = await runRagSearch(
        ctx.bookHash,
        ctx.embedding,
        query,
        topK,
        ctx.spoilerMaxChapterIndex,
        ctx.aiConfig,
      );
      ctx.emit({
        type: "tool_result",
        requestId: ctx.requestId,
        toolCallId: ctx.toolCallId,
        name,
        ok: inferToolResultOk(full),
        preview,
        full,
      });
      return full;
    }
    if (name === "extractCharacterAppearance") {
      if (!ctx.ragEnabled) {
        throw new Error(
          "向量模型未启用（请在设置 → 向量模型中开启并构建索引）。",
        );
      }
      const characterName = String(args.characterName ?? "").trim();
      if (!characterName) throw new Error("缺少有效的 characterName");
      const result = await runCharacterPortraitExtract(ctx.aiConfig, {
        bookHash: ctx.bookHash,
        characterName,
        spoilerSafe: ctx.portraitSpoilerSafe,
        activeChapterIdx: ctx.portraitActiveChapterIdx,
      });
      const full = JSON.stringify(result);
      let preview: string;
      try {
        preview = previewJson(JSON.parse(full) as Record<string, unknown>);
      } catch {
        preview = full.slice(0, 400);
      }
      ctx.emit({
        type: "tool_result",
        requestId: ctx.requestId,
        toolCallId: ctx.toolCallId,
        name,
        ok: !("error" in result && typeof result.error === "string"),
        preview,
        full,
      });
      return full;
    }
    if (name === "mindmap") {
      const result = runMindmapTool(args);
      const full = JSON.stringify(result);
      const preview = `${result.title}\n${result.markdown.slice(0, 280)}${
        result.markdown.length > 280 ? "…" : ""
      }`;
      ctx.emit({
        type: "tool_result",
        requestId: ctx.requestId,
        toolCallId: ctx.toolCallId,
        name,
        ok: true,
        preview,
        full,
      });
      return full;
    }
    if (name === "ragContext" && ctx.chapterMatchRuleOnlyTurn) {
      const blocked = JSON.stringify({
        ok: false,
        error:
          "本轮为章节匹配规则任务，已禁止 ragContext（读取章节原文）。请用用户消息中的标题样例直接写 fenced 单行匹配规则；仅当需要时可 ragSearch 抽样章节标题行。",
      });
      ctx.emit({
        type: "tool_result",
        requestId: ctx.requestId,
        toolCallId: ctx.toolCallId,
        name,
        ok: false,
        preview: "已禁止读取章节原文（章节匹配规则专轮）",
        full: blocked,
      });
      return blocked;
    }
    if (name === "ragContext") {
      const ch = typeof args.chapterIndex === "number" ? args.chapterIndex : -1;
      if (!Number.isFinite(ch) || ch < 0)
        throw new Error("无效的 chapterIndex");
      if (
        ctx.spoilerMaxChapterIndex != null &&
        ch > ctx.spoilerMaxChapterIndex
      ) {
        throw new Error(
          `防剧透：不可拉取第 ${ch + 1} 章原文（当前阅读进度允许的最大章节索引为 ${ctx.spoilerMaxChapterIndex}，即第 ${ctx.spoilerMaxChapterIndex + 1} 章及之前）。`,
        );
      }
      const maxChars =
        typeof args.maxChars === "number" ? args.maxChars : 12_000;
      const range = typeof args.range === "number" ? args.range : undefined;
      const { preview, full } = await runRagContext(
        ctx.bookHash,
        ch,
        maxChars,
        range,
        ctx.chat,
        ctx.webContents,
        (progress) => {
          ctx.emit({
            type: "tool_progress",
            requestId: ctx.requestId,
            toolCallId: ctx.toolCallId,
            title: progress.title,
            detail: progress.detail,
          });
        },
        (usage) => {
          ctx.onTokenUsage?.(usage);
        },
        ctx.signal,
      );
      ctx.emit({
        type: "tool_result",
        requestId: ctx.requestId,
        toolCallId: ctx.toolCallId,
        name,
        ok: true,
        preview,
        full,
      });
      return full;
    }
    if (name === "getSkills") {
      const task = String(args.task ?? "").trim();
      const full = runGetSkillsTool(task, ctx.enabledSkills);
      const preview = previewJson(JSON.parse(full) as Record<string, unknown>);
      ctx.emit({
        type: "tool_result",
        requestId: ctx.requestId,
        toolCallId: ctx.toolCallId,
        name,
        ok: true,
        preview,
        full,
      });
      return full;
    }
    const skillHit = findAgentSkillByToolName(name, ctx.enabledSkills);
    if (skillHit) {
      const full = runSkillInvokeTool(skillHit);
      const preview = previewJson(JSON.parse(full) as Record<string, unknown>);
      ctx.emit({
        type: "tool_result",
        requestId: ctx.requestId,
        toolCallId: ctx.toolCallId,
        name,
        ok: true,
        preview,
        full,
      });
      return full;
    }
    throw new Error(`未知工具：${name}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const full = JSON.stringify({ error: msg });
    ctx.emit({
      type: "tool_result",
      requestId: ctx.requestId,
      toolCallId: ctx.toolCallId,
      name,
      ok: false,
      preview: msg,
      full,
    });
    return full;
  }
}

export async function runAgentChat(opts: {
  chat: AIChatEndpoint;
  embedding: AIEmbeddingEndpoint;
  /** false 时不注册 RAG 工具，系统提示改为「检索已关闭」 */
  embeddingEnabled: boolean;
  /** 完整 AI 配置（角色外貌工具等） */
  aiConfig: AIConfig;
  payload: AIAgentStartPayload;
  configSystemPromptExtra: string;
  webContents: WebContents;
  ragTopKDefault: number;
}): Promise<void> {
  const {
    chat,
    embedding,
    embeddingEnabled,
    aiConfig,
    payload,
    configSystemPromptExtra,
    webContents,
    ragTopKDefault,
  } = opts;
  const ragEnabled = embeddingEnabled;
  const requestId = payload.requestId;
  const url = `${normalizeBase(chat.baseUrl)}/chat/completions`;
  const resolvedModel =
    (payload.chatModelOverride ?? "").trim() || chat.model.trim();

  const emit = (ev: AIAgentRendererEvent) => {
    webContents.send("ai:agent:event", ev);
  };

  const ac = registerChatAbortController(requestId);
  const enabledSkills = payload.enabledSkills ?? [];
  const chapterMatchSkillRagUnrestricted = enabledSkills.some(
    (s) => s.id === CHAPTER_MATCH_RULES_SKILL_ID,
  );
  const chapterMatchRuleOnlyTurn = isChapterMatchRuleAgentTurn(
    payload.userText,
    chapterMatchSkillRagUnrestricted,
  );
  const spoilerMaxChapterIndex =
    payload.spoilerSafe &&
    typeof payload.bookMeta.currentChapterIndex === "number" &&
    payload.bookMeta.currentChapterIndex >= 0
      ? payload.bookMeta.currentChapterIndex
      : null;
  const ragSpoilerMaxChapterIndex = chapterMatchSkillRagUnrestricted
    ? null
    : spoilerMaxChapterIndex;

  const portraitActiveChapterIdx =
    typeof payload.bookMeta.currentChapterIndex === "number" &&
    Number.isFinite(payload.bookMeta.currentChapterIndex)
      ? Math.trunc(payload.bookMeta.currentChapterIndex)
      : -1;

  const sliding =
    typeof payload.slidingWindowSize === "number"
      ? payload.slidingWindowSize
      : chat.slidingWindowSize;
  const maxRounds =
    typeof payload.maxToolRounds === "number"
      ? payload.maxToolRounds
      : DEFAULT_MAX_TOOL_ROUNDS;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (chat.apiKey.trim()) {
    headers.Authorization = `Bearer ${chat.apiKey.trim()}`;
  }

  let usageAcc: AITokenUsageTotals = { ...ZERO_TOKEN_USAGE };
  let usageAvailable = false;

  try {
    const rows = listMessages(payload.threadId).filter(
      (r) => r.role !== "system",
    );
    let history: ApiMsg[] = trimApiTail(
      dbRowsToApiMessages(rows, chat.baseUrl),
      sliding,
    );
    history = augmentLatestUserWithReadingAnchor(
      history,
      payload.bookMeta,
      ragEnabled,
      chapterMatchRuleOnlyTurn,
    );
    const mindmapInjectHint = resolveMindmapInjectHintForTurn({
      userText: payload.userText,
      autoMindmapOnSummaryAndCharacters:
        aiConfig.autoMindmapOnSummaryAndCharacters !== false,
      chapterMatchRuleOnlyTurn,
    });
    const systemContent = buildAgentSystemPrompt(
      payload.bookMeta,
      payload.deepThinking,
      payload.spoilerSafe,
      configSystemPromptExtra,
      enabledSkills,
      ragEnabled,
      chapterMatchSkillRagUnrestricted,
      chapterMatchRuleOnlyTurn,
      mindmapInjectHint,
    );

    const absorbTokenUsage = (part: AITokenUsageTotals | null | undefined) => {
      if (!part) return;
      usageAcc = addTokenUsage(usageAcc, part);
      if (part.totalTokens > 0 || part.promptTokens > 0 || part.completionTokens > 0) {
        usageAvailable = true;
      }
    };
    const emitUsageFinal = () => {
      emit({
        type: "token_usage_final",
        requestId,
        promptTokens: usageAcc.promptTokens,
        completionTokens: usageAcc.completionTokens,
        totalTokens: usageAcc.totalTokens,
        ...(usageAcc.promptCacheHitTokens != null &&
        usageAcc.promptCacheHitTokens > 0
          ? { promptCacheHitTokens: usageAcc.promptCacheHitTokens }
          : {}),
        available: usageAvailable,
      });
    };

    /** 上一轮**实际执行**过的工具指纹；重复指纹则跳过嵌入/检索以打破死循环 */
    let lastExecutedToolFingerprint: string | null = null;
    let consecutiveDuplicateToolRounds = 0;
    /**
     * 重复工具被跳过后的下一轮：插入**仅用于本次请求**的 user 提示（不写库），且不发送 tools，
     * 以兼容未实现 tool_choice 的本地推理服务，迫使输出最终自然语言。
     */
    let pendingFinalizeNudge: string | null = null;
    /** 检索后追问出图（与 finalize 不同：仍保留 tools） */
    let pendingMindmapNudge: string | null = null;
    let mindmapAfterRagNudgeUsed = false;

    let round = 0;
    while (round < maxRounds) {
      round += 1;
      const finalizeMetaRound = pendingFinalizeNudge;
      pendingFinalizeNudge = null;
      const mindmapMetaRound = pendingMindmapNudge;
      pendingMindmapNudge = null;

      const messages: unknown[] = [
        { role: "system", content: systemContent },
        ...history,
      ];
      if (finalizeMetaRound) {
        messages.push({ role: "user", content: finalizeMetaRound });
      } else if (mindmapMetaRound) {
        messages.push({ role: "user", content: mindmapMetaRound });
      }

      const { temperature, extraBody } = resolveAgentDeepThinkingParams({
        deepThinking: payload.deepThinking,
        configuredTemperature: chat.temperature,
        baseUrl: chat.baseUrl,
      });

      const body: Record<string, unknown> = {
        model: resolvedModel,
        messages,
        temperature,
        max_tokens: chat.maxTokens,
        stream: true,
        ...extraBody,
      };
      if (!finalizeMetaRound) {
        body.tools = buildAgentToolsWithSkills(enabledSkills, ragEnabled, {
          includeRagContext: !chapterMatchRuleOnlyTurn,
        });
        body.stream_options = { include_usage: true };
      }

      let roundResult: Awaited<ReturnType<typeof streamOneRound>>;
      try {
        roundResult = await streamOneRound({
          url,
          headers,
          body,
          signal: ac.signal,
          requestId,
          emit,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.toLowerCase().includes("abort")) {
          emitUsageFinal();
          emit({ type: "done", requestId });
          return;
        }
        if (msg === "EMPTY_STREAM") {
          emitUsageFinal();
          emit({
            type: "error",
            requestId,
            message:
              "对话服务已关闭连接且本轮无有效输出。若上下文不足请缩短对话历史或增大服务端 n_ctx。",
          });
          return;
        }
        emitUsageFinal();
        emit({ type: "error", requestId, message: msg });
        return;
      }

      absorbTokenUsage(roundResult.usage);

      let { content, reasoning, toolCalls } = roundResult;
      if (finalizeMetaRound && toolCalls.length > 0) {
        toolCalls = [];
      }

      if (toolCalls.length > 0) {
        const toolFp = fingerprintToolCalls(toolCalls);
        const isDuplicateToolRound =
          lastExecutedToolFingerprint !== null &&
          toolFp === lastExecutedToolFingerprint;

        if (isDuplicateToolRound) consecutiveDuplicateToolRounds += 1;
        else consecutiveDuplicateToolRounds = 0;

        if (isDuplicateToolRound && consecutiveDuplicateToolRounds >= 3) {
          emitUsageFinal();
          emit({
            type: "error",
            requestId,
            message:
              "模型连续多轮使用完全相同的工具参数（常见于重复 ragSearch）。请新开一轮对话，或换一种问法；若已有检索结果，应直接根据片段中的章节信息作答。",
          });
          return;
        }

        appendAgentMessageRow({
          threadId: payload.threadId,
          role: "assistant",
          content: content ?? "",
          toolCallsJson: JSON.stringify(toolCalls),
          payload:
            reasoning.trim() !== ""
              ? JSON.stringify({ reasoning } satisfies Record<string, string>)
              : null,
        });

        history.push(
          buildAssistantApiMsg(
            {
              content: content ?? "",
              reasoning,
              toolCalls,
            },
            chat.baseUrl,
          ),
        );

        const dupNotice = JSON.stringify({
          notice:
            "本轮工具调用与上一轮参数完全相同，未重复执行检索。请直接阅读对话中已有 tool 消息里的 JSON 结果作答；`（ch=N）` 中的 N 须为 **chapterIndex（从 0 起）**。需要更多原文时请使用 ragContext(chapterIndex) 或更换 ragSearch 的 query。",
        });

        for (const tc of toolCalls) {
          let raw: string;
          if (isDuplicateToolRound) {
            emit({
              type: "tool_executing",
              requestId,
              toolCallId: tc.id,
              name: tc.function.name,
              argsPreview: "（与上一轮相同，已跳过执行）",
              argsJson: tc.function.arguments.trim() || "{}",
            });
            raw = dupNotice;
            emit({
              type: "tool_result",
              requestId,
              toolCallId: tc.id,
              name: tc.function.name,
              ok: true,
              preview: "重复请求已跳过，请基于已有检索结果作答",
              full: raw,
            });
          } else {
            raw = await dispatchTool(tc.function.name, tc.function.arguments, {
              bookHash: payload.bookHash,
              embedding,
              ragEnabled,
              defaultTopK: ragTopKDefault,
              requestId,
              toolCallId: tc.id,
              emit,
              spoilerMaxChapterIndex: ragSpoilerMaxChapterIndex,
              enabledSkills,
              aiConfig,
              portraitSpoilerSafe: payload.spoilerSafe === true,
              portraitActiveChapterIdx,
              chat,
              webContents,
              onTokenUsage: absorbTokenUsage,
              signal: ac.signal,
              chapterMatchRuleOnlyTurn,
            });
          }
          appendAgentMessageRow({
            threadId: payload.threadId,
            role: "tool",
            toolCallId: tc.id,
            toolName: tc.function.name,
            content: raw,
          });
          history.push({
            role: "tool",
            tool_call_id: tc.id,
            content: raw,
            name: tc.function.name,
          });
        }

        if (!isDuplicateToolRound) lastExecutedToolFingerprint = toolFp;
        if (isDuplicateToolRound) {
          pendingFinalizeNudge =
            "【系统】上一轮工具请求与之前完全相同，未重复执行检索。请只根据当前对话里已经出现的 tool 消息（含 ragSearch 返回的 chapterIndex、chapterTitle、正文片段等），用简体中文直接回答用户**最后一个问题**。用户可见的章节跳转**只能**写 `（ch=N）`（全角括号），且 **N = chapterIndex（从 0 起）**。不要再次发起工具调用，也不要只写思考过程。";
        } else if (
          mindmapInjectHint &&
          !mindmapAfterRagNudgeUsed &&
          shouldProactiveMindmapNudgeAfterToolRound(
            toolCalls.map((tc) => tc.function.name),
            history,
          )
        ) {
          mindmapAfterRagNudgeUsed = true;
          pendingMindmapNudge = MINDMAP_AFTER_RAG_NUDGE;
        }

        emit({ type: "round_end", requestId });
        continue;
      }

      let answerText = content ?? "";
      if (finalizeMetaRound && !answerText.trim() && reasoning.trim()) {
        answerText = reasoning.trim();
      }

      if (
        !finalizeMetaRound &&
        mindmapInjectHint &&
        !mindmapAfterRagNudgeUsed &&
        answerText.trim() &&
        shouldRequireMindmapAfterRag(history)
      ) {
        mindmapAfterRagNudgeUsed = true;
        pendingMindmapNudge = MINDMAP_AFTER_RAG_NUDGE;
        emit({ type: "round_end", requestId });
        continue;
      }

      appendAgentMessageRow({
        threadId: payload.threadId,
        role: "assistant",
        content: answerText,
        payload: buildAssistantPayloadJson({
          reasoning,
          tokenUsage: usageAcc,
          usageAvailable,
        }),
      });

      if (finalizeMetaRound && !answerText.trim()) {
        emitUsageFinal();
        emit({
          type: "error",
          requestId,
          message:
            "已强制结束工具循环并要求直接作答，但模型未返回正文。请重试、换模型，或新开对话追问「请根据上文 ragSearch 结果说明在第几回」。",
        });
        return;
      }

      emitUsageFinal();
      emit({ type: "done", requestId });
      return;
    }

    emitUsageFinal();
    emit({
      type: "error",
      requestId,
      message: `已达到工具调用轮数上限（${maxRounds}），请缩短问题或新开对话。`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emit({
      type: "token_usage_final",
      requestId,
      promptTokens: usageAcc.promptTokens,
      completionTokens: usageAcc.completionTokens,
      totalTokens: usageAcc.totalTokens,
      ...(usageAcc.promptCacheHitTokens != null &&
      usageAcc.promptCacheHitTokens > 0
        ? { promptCacheHitTokens: usageAcc.promptCacheHitTokens }
        : {}),
      available: usageAvailable,
    });
    if (msg.toLowerCase().includes("abort")) {
      emit({ type: "done", requestId });
      return;
    }
    emit({ type: "error", requestId, message: msg });
  } finally {
    releaseChatAbortController(requestId);
  }
}
