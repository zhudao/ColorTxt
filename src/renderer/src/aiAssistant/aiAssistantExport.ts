import type {
  AiThreadListRow,
  UiAssistantMsg,
  UiMsg,
} from "./aiAssistantTypes";
import {
  collectThinkingTexts,
  toolDisplayLabel,
  toolEntryByCallId,
} from "./aiAssistantSegments";
import type { Chapter } from "../chapter";
import { formatAiAssistantAnswerForUser } from "../utils/aiMarkdownChapterRef";

export function resolveExportThreadTitle(
  threadId: string | null,
  threads: AiThreadListRow[],
  messages: UiMsg[],
): string {
  const row = threadId ? threads.find((x) => x.id === threadId) : undefined;
  if (row?.title?.trim()) return row.title.trim();
  const firstUser = messages.find((m) => m.role === "user");
  const u = firstUser?.content.trim();
  if (u) return u.length > 120 ? `${u.slice(0, 120)}…` : u;
  return "对话";
}

export function chatExportDateSlug(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** 用于保存对话框默认文件名片段：去掉 Windows 非法字符并限制长度 */
export function sanitizeChatExportTitleForFilename(raw: string): string {
  const trimmed = raw.trim().slice(0, 100);
  if (!trimmed) return "对话";
  const cleaned = trimmed
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\.+$/u, "")
    .trim();
  return cleaned || "对话";
}

/** `chat-{日期}-{对话名}.md`；带思考过程时在扩展名前加 `（带思考过程）` */
export function buildChatExportDefaultName(
  title: string,
  ext: "md" | "json",
  withReasoning: boolean,
): string {
  const slug = chatExportDateSlug();
  const titlePart = sanitizeChatExportTitleForFilename(title);
  const reasoning = withReasoning ? "（带思考过程）" : "";
  return `chat-${slug}-${titlePart}${reasoning}.${ext}`;
}

/**
 * 阅读助手对话导出为 Markdown（复制与保存共用）。
 * @param includeReasoningAndTools 为 true 时包含思考过程与工具调用块，且 AI 正文前有「### 回答」；为 false 时为二人对话版式（无该 h3），仅保留用户消息与 AI 正文（及中止/附加说明等）。
 */
export function buildAssistantChatExportMarkdown(
  messages: UiMsg[],
  title: string,
  includeReasoningAndTools = false,
  skillToolLabels?: Record<string, string>,
  chapters: readonly Chapter[] = [],
): string {
  const lines: string[] = [`# ${title}`, ""];
  for (const m of messages) {
    if (
      m.role === "indexBanner" ||
      m.role === "tokenUsage"
    ) {
      continue;
    }
    if (m.role === "user") {
      lines.push("## 你", "", m.content, "", "---", "");
      continue;
    }
    lines.push("## AI", "");
    if (includeReasoningAndTools) {
      for (const seg of m.segments) {
        if (seg.kind === "think" && seg.text.trim()) {
          lines.push(
            "### 思考过程",
            "",
            formatAiAssistantAnswerForUser(seg.text.trim(), chapters),
            "",
          );
        } else if (seg.kind === "toolRef") {
          const t = toolEntryByCallId(m, seg.toolCallId);
          if (!t) continue;
          const body = (t.full || t.preview).trim();
          const reqJson = (t.argsJson || t.argsPreview).trim();
          lines.push(
            `### 工具：${toolDisplayLabel(t.name, skillToolLabels)}`,
            "",
            t.argsPreview ? `参数摘要：${t.argsPreview}` : "",
            "",
          );
          if (reqJson && reqJson !== t.argsPreview) {
            lines.push("完整请求：", "", "```json", reqJson, "```", "");
          }
          lines.push(
            "结果：",
            "",
            "```",
            body || "（无正文）",
            "```",
            "",
          );
        }
      }
    }
    const ansMd = formatAiAssistantAnswerForUser(m.answer.trim(), chapters);
    if (ansMd) {
      if (includeReasoningAndTools) {
        lines.push("### 回答", "", ansMd, "");
      } else {
        lines.push(ansMd, "");
      }
    }
    if (m.aborted) {
      lines.push("用户取消了生成", "");
    }
    if (m.errorDetail?.trim()) {
      lines.push("### 附加说明", "", m.errorDetail.trim(), "");
    }
    lines.push("", "---", "");
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  while (lines.length && lines[lines.length - 1] === "---") lines.pop();
  lines.push("", "---", "", `*导出于 ${new Date().toLocaleString()}*`);
  return lines.join("\n");
}

/**
 * 阅读助手对话导出为 JSON 字符串。
 * @param includeReasoningAndTools 为 true 时包含 thinkingChunks、segments、tools；为 false 时助手消息仅含核心字段与 answer。
 */
export function buildAssistantChatExportJson(
  messages: UiMsg[],
  title: string,
  includeReasoningAndTools = false,
  skillToolLabels?: Record<string, string>,
  chapters: readonly Chapter[] = [],
): string {
  const exportedAt = new Date().toISOString();
  const payload = {
    title,
    exportedAt,
    messages: messages
      .filter(
        (m) =>
          m.role !== "indexBanner" &&
          m.role !== "tokenUsage",
      )
      .map((m) => {
      if (m.role === "user") {
        return {
          id: m.id,
          role: m.role,
          parts: [{ type: "text", text: m.content }],
          createdAt: m.createdAt ?? Date.now(),
        };
      }
      const base = {
        id: m.id,
        role: m.role,
        aborted: Boolean(m.aborted),
        answer: formatAiAssistantAnswerForUser(m.answer.trim(), chapters),
        createdAt: m.createdAt ?? Date.now(),
      };
      if (!includeReasoningAndTools) {
        return base;
      }
      const am = m as UiAssistantMsg;
      return {
        ...base,
        thinkingChunks: collectThinkingTexts(am),
        segments: am.segments.map((seg) =>
          seg.kind === "think"
            ? { kind: "think" as const, text: seg.text, sealed: seg.sealed }
            : { kind: "toolRef" as const, toolCallId: seg.toolCallId },
        ),
        tools: am.tools.map((t) => ({
          name: t.name,
          displayName: toolDisplayLabel(t.name, skillToolLabels),
          argsPreview: t.argsPreview,
          argsJson: t.argsJson,
          preview: t.preview,
          full: t.full,
          status: t.status,
          ...(t.mindmap ? { mindmap: t.mindmap } : {}),
          ...(t.wordcloud ? { wordcloud: t.wordcloud } : {}),
        })),
      };
    }),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}
