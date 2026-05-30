export type MindmapIntentKind = "explicit" | "auto" | "none";

const EXCLUDE_PATTERNS = [
  /不要图/u,
  /别画/u,
  /无需图/u,
  /不用图/u,
  /不要导图/u,
  /简短/u,
  /一句话/u,
  /用文字/u,
  /纯文字/u,
  /文字回答/u,
  /只要文字/u,
];

const EXPLICIT_PATTERNS = [
  /思维导图/u,
  /心智图/u,
  /导图/u,
  /知识图/u,
  /概念图/u,
  /可视化/u,
  /结构图/u,
  /mind\s*map/i,
];

/** 用户只想定位章节/时间点，不是要概括或导图（须在 auto 判定之前排除） */
const LOCATOR_PATTERNS = [
  /是在哪[一這这]?章/u,
  /在哪[一這这]?章/u,
  /哪[一這这]?章[？?。,\s]*$/u,
  /第几[回章]/u,
  /哪[一這这]?回/u,
  /什么时候/u,
  /何时/u,
  /(?:情节|剧情).{0,28}在哪[一這这]?章/u,
  /在哪[一這这]?章.{0,28}(?:情节|剧情)/u,
];

/** 单点事实查询，不适合自动导图（如「杨过是谁」） */
const SIMPLE_LOOKUP_PATTERNS = [
  /是谁[？?]?$/u,
  /是什么[？?]?$/u,
  /是哪位[？?]?$/u,
  /哪一位[？?]?$/u,
];

/**
 * 开放型 / 结构化问题形态（不预设具体主题：人物、家庭、装备、势力等均可）。
 * 用于「自动生成思维导图」开关开启时的宽松触发。
 */
const OPEN_QUESTION_SHAPE_PATTERNS = [
  /[吗？?]$/u,
  /什么/u,
  /哪些/u,
  /有哪些/u,
  /都有谁/u,
  /如何/u,
  /怎样/u,
  /怎么/u,
  /为什么/u,
  /概括/u,
  /总结/u,
  /梳理/u,
  /讲了什么/u,
  /讲了啥/u,
  /概要/u,
  /脉络/u,
  /主线/u,
  /剧情线/u,
  /关系/u,
  /结构/u,
  /体系/u,
  /网络/u,
  /层次/u,
  /分类/u,
  /成员/u,
  /家庭/u,
  /人际/u,
  /本章/u,
  /这章/u,
  /这一章/u,
  /全书/u,
  /本书/u,
  /整本书/u,
];

/** 是否为「定位章节/时间点」类问题（不应自动出思维导图） */
export function isMindmapLocatorQuestion(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  if (/讲了(?:什么|啥)/u.test(t)) return false;
  return LOCATOR_PATTERNS.some((p) => p.test(t));
}

function isSimpleLookupQuestion(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  return SIMPLE_LOOKUP_PATTERNS.some((p) => p.test(t));
}

/** 开放型问题：适合在开启自动导图时用用户原话引导 Agent 判断是否出图 */
export function isOpenStructuredQuestion(userText: string): boolean {
  const t = userText.trim();
  if (t.length < 4) return false;
  if (isSimpleLookupQuestion(t)) return false;
  return OPEN_QUESTION_SHAPE_PATTERNS.some((p) => p.test(t));
}

export function detectMindmapIntent(userText: string): MindmapIntentKind {
  const t = userText.trim();
  if (!t) return "none";

  for (const p of EXCLUDE_PATTERNS) {
    if (p.test(t)) return "none";
  }

  if (isMindmapLocatorQuestion(t)) return "none";

  for (const p of EXPLICIT_PATTERNS) {
    if (p.test(t)) return "explicit";
  }

  if (isOpenStructuredQuestion(t)) return "auto";

  return "none";
}

export function shouldInjectMindmapHint(
  intent: MindmapIntentKind,
  autoMindmapOnSummaryAndCharacters: boolean,
): boolean {
  if (intent === "none") return false;
  if (intent === "explicit") return true;
  return autoMindmapOnSummaryAndCharacters;
}

/** 本轮 system 附加段：引导检索后调用 mindmap（由用户原话驱动，不套用固定主题模板） */
export function buildMindmapInjectHint(
  userText: string,
  intent: "explicit" | "auto",
): string {
  const q = userText.trim().slice(0, 240);
  const mustCall =
    intent === "explicit"
      ? "检索充分后**必须**调用 **mindmap**"
      : "若用户问题适合用层级结构展示，检索充分后**应**调用 **mindmap**";

  return [
    "## 本轮：思维导图",
    `用户问题：「${q}」`,
    "- 须先通过 **ragSearch** / **ragContext** 依据本书检索组织内容；检索不足时如实说明，可省略出图。",
    "- 导图须**紧扣上述用户问题**组织主干（可能是人物关系、家庭成员、情节脉络、概念体系等，由问题语义决定，勿套用固定「概括/人物关系」模板）。",
    "- **全书级概括**（仅当用户明确提到全书/本书/整书时）：以 **ragSearch** 多关键词跨章检索；勿因顺带提到「剧情」就拉成全书面貌导图。",
    "- **本章概括**：用户问「本章 / 这章讲了什么」时须 **ragContext(当前章 chapterIndex)**。",
    "- **定点情节**（未要求全书概括时）：导图须紧扣所问情节或当前章，勿生成全书脉络图。",
    `- ${mustCall}（参数 title、markdown 为 \`#\`/\`##\`/\`###\`/\`-\` 层级，**禁止** Mermaid mindmap 语法）；**禁止**仅用长篇 Markdown 代替 mindmap 工具。`,
    "- 出图后用 **不超过 3 条** bullet 简要概括导图结构；主枝建议 4–7 条，避免堆砌过多节点。",
  ].join("\n");
}

/** 本轮 Agent 循环中：已检索、尚未出图时插入的 user 追问（仅 API，不写库） */
export const MINDMAP_AFTER_RAG_NUDGE =
  "【系统】用户需要思维导图。请**立即**调用 **mindmap** 工具（参数 title、markdown 为 #/##/###/- 层级，勿用 Mermaid mindmap）。出图后，再用**不超过 3 条** bullet 简要概括导图主干；勿用长篇 Markdown 代替 mindmap。";

type AgentHistoryMsg = { role: string; name?: string };

function historyTailSinceLastUser(msgs: AgentHistoryMsg[]): AgentHistoryMsg[] {
  let idx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") {
      idx = i;
      break;
    }
  }
  return idx >= 0 ? msgs.slice(idx + 1) : msgs;
}

/** 当前用户轮次是否已 rag 检索且尚未调用 mindmap */
export function shouldRequireMindmapAfterRag(
  history: AgentHistoryMsg[],
): boolean {
  const tail = historyTailSinceLastUser(history);
  const hasRetrieval = tail.some(
    (m) =>
      m.role === "tool" &&
      (m.name === "ragContext" || m.name === "ragSearch"),
  );
  const hasMindmap = tail.some((m) => m.role === "tool" && m.name === "mindmap");
  return hasRetrieval && !hasMindmap;
}

/** ragContext 完成后优先追问出图（避免模型先输出长文摘要） */
export function shouldProactiveMindmapNudgeAfterToolRound(
  toolNames: string[],
  history: AgentHistoryMsg[],
): boolean {
  if (!toolNames.includes("ragContext")) return false;
  return shouldRequireMindmapAfterRag(history);
}

export function resolveMindmapInjectHintForTurn(opts: {
  userText: string;
  autoMindmapOnSummaryAndCharacters: boolean;
  chapterMatchRuleOnlyTurn: boolean;
}): string | null {
  if (opts.chapterMatchRuleOnlyTurn) return null;
  const intent = detectMindmapIntent(opts.userText);
  if (!shouldInjectMindmapHint(intent, opts.autoMindmapOnSummaryAndCharacters)) {
    return null;
  }
  if (intent === "none") return null;
  return buildMindmapInjectHint(opts.userText, intent);
}
