import { agentSkillToolFunctionName } from "@shared/aiAgentSkillToolNames";
import type { AiCustomSkill } from "@shared/aiSkills";
import { BUILTIN_AI_SKILLS } from "@shared/aiSkills";
import type {
  UiAssistantMsg,
  UiAssistantSegment,
  UiRenderSegRow,
  UiThinkSegment,
  UiToolEntry,
} from "./aiAssistantTypes";

/** 内置 + 已知自定义技能：OpenAI 工具名 → 展示标题（供历史消息中 skill_* 解析） */
export function buildSkillToolDisplayLabels(
  customSkills: readonly AiCustomSkill[],
): Record<string, string> {
  const o: Record<string, string> = {};
  for (const def of BUILTIN_AI_SKILLS) {
    o[agentSkillToolFunctionName(def.id)] = def.title;
  }
  for (const c of customSkills) {
    o[agentSkillToolFunctionName(c.id)] = c.title;
  }
  return o;
}

export function toolDisplayLabel(
  internalName: string,
  skillToolLabels?: Record<string, string>,
): string {
  const n = internalName.trim();
  if (n === "ragSearch") return "搜索书籍内容";
  if (n === "ragContext") return "读取章节原文";
  if (n === "mindmap") return "生成思维导图";
  if (n === "wordcloud") return "生成词云图";
  if (n === "getSkills") return "查询技能";
  const mapped = skillToolLabels?.[n];
  if (mapped) return mapped;
  if (n.startsWith("skill_")) {
    const raw = n.slice("skill_".length).replace(/_/g, " ");
    return raw || "技能";
  }
  return n || "工具";
}

export function collectThinkingTexts(m: UiAssistantMsg): string[] {
  return m.segments
    .filter(
      (s): s is UiThinkSegment => s.kind === "think" && Boolean(s.text.trim()),
    )
    .map((s) => s.text.trim());
}

export function allThinkingJoined(m: UiAssistantMsg): string {
  return collectThinkingTexts(m).join("\n\n");
}

export function findLiveThinkSegment(
  m: UiAssistantMsg,
): UiThinkSegment | undefined {
  for (let i = m.segments.length - 1; i >= 0; i--) {
    const s = m.segments[i]!;
    if (s.kind === "think" && !s.sealed) return s;
  }
  return undefined;
}

export function toolEntryByCallId(
  m: UiAssistantMsg,
  toolCallId: string,
): UiToolEntry | undefined {
  return m.tools.find((t) => t.toolCallId === toolCallId);
}

export function sealLiveThinkingBeforeTool(last: UiAssistantMsg): void {
  let idx = -1;
  for (let k = last.segments.length - 1; k >= 0; k--) {
    const s = last.segments[k]!;
    if (s.kind === "think" && !s.sealed) {
      idx = k;
      break;
    }
  }
  if (idx < 0) return;
  const tb = last.segments[idx] as UiThinkSegment;
  if (tb.text.trim()) {
    tb.sealed = true;
    tb.open = true;
  } else {
    last.segments.splice(idx, 1);
  }
}

/** 用户停止或会话中断后：去掉空的「正在思考…」占位；已有草稿的封存为「思考过程」（停止脉冲与文案） */
export function finalizeLiveThinkingAfterStop(last: UiAssistantMsg): void {
  for (let i = last.segments.length - 1; i >= 0; i--) {
    const s = last.segments[i]!;
    if (s.kind !== "think" || s.sealed) continue;
    const tb = s as UiThinkSegment;
    if (tb.text.trim()) {
      tb.sealed = true;
      tb.open = false;
    } else {
      last.segments.splice(i, 1);
    }
  }
}

export function appendReasoningDelta(
  last: UiAssistantMsg,
  delta: string,
): void {
  const live = findLiveThinkSegment(last);
  if (live) {
    live.text += delta;
    return;
  }
  last.segments.push({
    kind: "think",
    sealed: false,
    text: delta,
    open: true,
  });
}

/** 将 segments 展平为可渲染行（工具行已解析出 UiToolEntry） */
export function expandAssistantSegRows(m: UiAssistantMsg): UiRenderSegRow[] {
  const out: UiRenderSegRow[] = [];
  m.segments.forEach((seg: UiAssistantSegment, segIdx: number) => {
    if (seg.kind === "think") {
      if (seg.sealed && !seg.text.trim()) return;
      out.push({ rowKind: "think", think: seg, segIdx });
    } else {
      const t = toolEntryByCallId(m, seg.toolCallId);
      if (t) out.push({ rowKind: "tool", tool: t, segIdx });
    }
  });
  return out;
}
