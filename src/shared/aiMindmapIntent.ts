export type MindmapIntentKind = "explicit" | "summary" | "characters" | "none";

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

/** 用户只想定位章节/时间点，不是要概括或导图（须在 summary 关键词之前判定） */
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

const SUMMARY_PATTERNS = [
  /概括/u,
  /总结/u,
  /梳理/u,
  /讲了什么/u,
  /讲了啥/u,
  /剧情线/u,
  /剧情脉络/u,
  /梳理.{0,6}剧情/u,
  /概括.{0,6}剧情/u,
  /情节线/u,
  /主线/u,
  /故事线/u,
  /本章/u,
  /这章/u,
  /这一章/u,
  /当前章/u,
  /全书/u,
  /本书/u,
  /整本书/u,
  /内容/u,
  /概要/u,
];

const CHARACTER_PATTERNS = [
  /人物/u,
  /角色/u,
  /主角/u,
  /配角/u,
  /人物关系/u,
  /关系网/u,
  /都有谁/u,
  /哪些人/u,
];

/** 是否为「定位章节/时间点」类问题（不应自动出思维导图） */
export function isMindmapLocatorQuestion(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  if (/讲了(?:什么|啥)/u.test(t)) return false;
  return LOCATOR_PATTERNS.some((p) => p.test(t));
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

  let summaryHit = false;
  for (const p of SUMMARY_PATTERNS) {
    if (p.test(t)) {
      summaryHit = true;
      break;
    }
  }

  let charHit = false;
  for (const p of CHARACTER_PATTERNS) {
    if (p.test(t)) {
      charHit = true;
      break;
    }
  }

  if (summaryHit && charHit) return "summary";
  if (charHit) return "characters";
  if (summaryHit) return "summary";
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

/** 本轮 system 附加段：引导检索后调用 mindmap */
export function buildMindmapInjectHint(intent: MindmapIntentKind): string {
  const focus =
    intent === "characters"
      ? "了解书中人物及其关系"
      : intent === "summary"
        ? "概括或梳理剧情、章节与主题结构"
        : "将阅读内容结构可视化";

  return [
    "## 本轮：思维导图（优先）",
    `用户意在**${focus}**。`,
    "- 须先通过 **ragSearch** / **ragContext** 依据本书检索结果组织内容；检索不足时如实说明，可省略出图。",
    "- **全书级概括**（仅当用户明确提到全书/本书/整书时）：以 **ragSearch** 多关键词跨章检索；勿因顺带提到「剧情」就拉成全书面貌导图。",
    "- **本章概括**：用户问「本章 / 这章讲了什么」时须 **ragContext(当前章 chapterIndex)**。",
    "- **定点情节**（未要求全书概括时）：导图须紧扣所问情节或当前章，勿生成全书脉络图。",
    "- 检索充分后**必须**调用 **mindmap**（参数 title、markdown 为 `#`/`##`/`###`/`-` 层级，**禁止** Mermaid mindmap 语法）；**禁止**仅用长篇 Markdown 小节代替 mindmap 工具。",
    "- 出图后用 **不超过 3 条** bullet 简要概括导图结构；主枝建议 4–7 条，人物不宜堆砌过多节点。",
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
  return buildMindmapInjectHint(intent);
}
