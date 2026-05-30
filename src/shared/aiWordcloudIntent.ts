import type { AIWordcloudMode } from "./aiTypes";

const EXCLUDE_PATTERNS = [
  /不要图/u,
  /别画/u,
  /无需图/u,
  /不用图/u,
  /不要词云/u,
  /简短/u,
  /一句话/u,
  /用文字/u,
  /纯文字/u,
  /文字回答/u,
  /只要文字/u,
];

const EXPLICIT_PATTERNS = [
  /词云/u,
  /词云图/u,
  /词频图/u,
  /文字云/u,
  /word\s*cloud/i,
  /wordcloud/i,
];

const GENERAL_ONLY_PATTERNS = [
  /^生成本书词云/u,
  /^全书词云/u,
  /^本书词云/u,
  /^词云$/u,
  /高频词/u,
  /词频/u,
];

/** 用户是否想要词云（任意语义） */
export function detectWordcloudIntent(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  for (const p of EXCLUDE_PATTERNS) {
    if (p.test(t)) return false;
  }
  for (const p of EXPLICIT_PATTERNS) {
    if (p.test(t)) return true;
  }
  if (/的?词云/u.test(t)) return true;
  return false;
}

export function detectWordcloudMode(userText: string): AIWordcloudMode {
  const t = userText.trim();
  for (const p of GENERAL_ONLY_PATTERNS) {
    if (p.test(t)) return "general";
  }
  if (/词云/u.test(t)) {
    const stripped = t.replace(/词云图?/gu, "").trim();
    if (stripped.length >= 2) return "semantic";
  }
  return "general";
}

/** 从用户消息提炼 semanticQuery（不做固定类别映射） */
export function inferSemanticQueryFromUserText(userText: string): string {
  let t = userText.trim();
  t = t.replace(/^(请|帮我|给我|生成|做|来|画|制作|输出)+/u, "").trim();
  t = t.replace(/(的)?词云(图)?/gu, "").trim();
  t = t.replace(/[？?。!！]+$/u, "").trim();
  return t || userText.trim();
}

export function buildWordcloudInjectHint(userText: string): string {
  const mode = detectWordcloudMode(userText);
  const semanticBit =
    mode === "semantic"
      ? `- \`mode\`: **semantic**；\`semanticQuery\` 贴近用户原话：「${inferSemanticQueryFromUserText(userText).slice(0, 120)}」`
      : "- `mode`: **general**（全书/本章高频词）；勿传 semanticQuery";

  return [
    "## 本轮：词云（优先）",
    "用户需要**词云图**。须调用 **wordcloud** 工具；**禁止**自行编造词频或仅用文字罗列。",
    semanticBit,
    "- `title`：简短标题；`scope` 默认 full；用户明确「本章词云」时用 scope=chapter + chapterIndex。",
    "- 语义词云（semantic）时 `semanticQuery` 须贴近用户原话，不要擅自改写成其它主题。",
    "- 出图后用 **不超过 3 条** bullet 解读词云；主视觉由工具渲染。",
  ].join("\n");
}

export function resolveWordcloudInjectHintForTurn(opts: {
  userText: string;
  chapterMatchRuleOnlyTurn: boolean;
}): string | null {
  if (opts.chapterMatchRuleOnlyTurn) return null;
  if (!detectWordcloudIntent(opts.userText)) return null;
  return buildWordcloudInjectHint(opts.userText);
}
