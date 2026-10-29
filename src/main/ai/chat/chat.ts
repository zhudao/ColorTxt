import type { WebContents } from "electron";
import {
  AI_USER_VISIBLE_CH_REF_SHORT,
  formatAiToolChapterHeading,
} from "@shared/aiChapterRefPrompt";
import type {
  AIChatEndpoint,
  AIChatStreamPayload,
} from "@shared/aiTypes";
import {
  extractUsageFromChatJson,
  type AITokenUsageTotals,
} from "@shared/aiTokenUsage";
import {
  applyOpenAiCompatAuthHeaders,
} from "@shared/apiEndpointPresets";
import { resolveAgentDeepThinkingParams } from "./chatThinking";

function normalizeBase(u: string): string {
  return u.replace(/\/+$/, "");
}

const CURRENT_CHAPTER_IN_PROMPT_MAX = 72_000;

function buildSystemPrompt(
  payload: AIChatStreamPayload,
  configExtra: string,
): string {
  const { bookMeta, ragSnippets, deepThinking, spoilerSafe } = payload;
  const lines: string[] = [
    "你是资深中文小说阅读助手，正在与用户讨论一部长篇作品。",
    "**重要**：预训练知识中不包含当前这本书的全文；书中细节只能依据下方「当前章节正文」「相关片段」及对话里用户明确给出的文字，不得凭记忆编造或与其它书籍、版本混淆。",
    "你必须严格依据下方「书籍信息」「当前章节正文」「相关片段」与对话中的用户问题作答。",
    "禁止编造原文未出现的情节、对白、人名或设定；材料不足时请直接说明缺什么信息，不要臆测补全。",
    "用户说「本章」「这一章」「当前章」时，默认指「当前章节正文」一节中的内容（若有）；回答宜紧扣剧情、人物与伏笔，条理清晰，可适度分点。",
    "",
    "## 书籍信息",
    `- 书名：${bookMeta.fileTitle}`,
    `- 总章节数：${bookMeta.chapterCount}`,
    `- 当前阅读章节：${
      bookMeta.currentChapterIndex >= 0
        ? `第 ${bookMeta.currentChapterIndex + 1} 章 · ${bookMeta.currentChapterTitle || "（无标题）"}`
        : bookMeta.currentChapterTitle || "（未能解析章节）"
    }`,
    "",
  ];

  const chapterRaw = (payload.currentChapterText ?? "").trim();
  if (chapterRaw) {
    const body =
      chapterRaw.length > CURRENT_CHAPTER_IN_PROMPT_MAX
        ? `${chapterRaw.slice(0, CURRENT_CHAPTER_IN_PROMPT_MAX)}\n\n…（本章正文过长，此处已截断；未展示部分请勿臆测）`
        : chapterRaw;
    lines.push(
      "## 当前章节正文（用户阅读光标所在章，含章节标题行起至下一章之前）",
      "概括本章、分析本章情节或人物时，请优先依据本节正文；可与「相关片段」交叉印证。",
      "",
      body,
      "",
    );
  }

  if (deepThinking) {
    lines.push("请先简要列出依据的关键情节线索，再给出结论。", "");
  }

  if (spoilerSafe) {
    lines.push(
      "## 防剧透",
      "用户已开启防剧透：回答时不要透露当前阅读章节之后的剧情发展、伏笔回收、人物命运或结局向信息。",
      "若用户问题明显涉及后文，请说明需读到对应进度再讨论，或仅依据已给出的「当前章节正文」与「相关片段」作答，不要臆测后文。",
      "",
    );
  }

  if (ragSnippets.length > 0) {
    lines.push("## 相关片段（向量检索，按相似度排序；未必覆盖本章全貌）");
    lines.push(AI_USER_VISIBLE_CH_REF_SHORT, "");
    for (const s of ragSnippets) {
      const snippet =
        s.content.length > 600 ? `${s.content.slice(0, 600)}…` : s.content;
      lines.push(
        formatAiToolChapterHeading(s.chapterIndex, s.chapterTitle),
        snippet,
        "",
      );
    }
  }

  const extra = (payload.systemPromptExtra ?? "").trim() || configExtra.trim();
  if (extra) {
    lines.push("## 用户在设置中附加的系统提示词", extra, "");
  }

  return lines.join("\n");
}

function trimMessages(
  msgs: Array<{ role: "user" | "assistant"; content: string }>,
  slidingWindowSize: number,
): Array<{ role: "user" | "assistant"; content: string }> {
  if (slidingWindowSize <= 0) return msgs;
  const maxMsgs = Math.max(2, slidingWindowSize * 2);
  return msgs.length <= maxMsgs ? msgs : msgs.slice(-maxMsgs);
}

const chatAbortControllers = new Map<number, AbortController>();

/** Agent 多轮请求与单次 chat 共用：可与 `abortChatRequest` 配对 */
export function registerChatAbortController(requestId: number): AbortController {
  const ac = new AbortController();
  chatAbortControllers.set(requestId, ac);
  return ac;
}

export function releaseChatAbortController(requestId: number): void {
  chatAbortControllers.delete(requestId);
}

type SsePayloadResult =
  | { kind: "delta"; text: string }
  | { kind: "done" }
  | { kind: "error"; message: string }
  | { kind: "skip" };

/** 兼容 OpenAI / llama.cpp server 等在 SSE 里可能出现的多种错误结构 */
export function extractSseErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;

  if (typeof o.error === "string" && o.error.trim()) return o.error.trim();

  if (o.error && typeof o.error === "object") {
    const e = o.error as Record<string, unknown>;
    if (typeof e.message === "string" && e.message.trim()) return e.message.trim();
    try {
      return JSON.stringify(o.error);
    } catch {
      return String(o.error);
    }
  }

  if (typeof o.message === "string" && o.message.trim()) {
    if ("error" in o || "code" in o) return o.message.trim();
  }

  const ch0 = Array.isArray(o.choices) ? o.choices[0] : undefined;
  if (ch0 && typeof ch0 === "object") {
    const c = ch0 as Record<string, unknown>;
    const fr = c.finish_reason;
    if (fr === "error" || fr === "content_filter") {
      const msg =
        typeof c.message === "string"
          ? c.message
          : typeof (c.delta as Record<string, unknown> | undefined)?.content ===
              "string"
            ? String((c.delta as { content?: string }).content)
            : null;
      return (
        msg?.trim() ||
        `模型结束原因：${String(fr)}（未返回正文，请查看服务端日志）`
      );
    }
  }

  return null;
}

function parseOpenAiSseJsonPayload(data: string): SsePayloadResult {
  const trimmed = data.trim();
  if (trimmed === "[DONE]") return { kind: "done" };

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return { kind: "skip" };
  }

  const errMsg = extractSseErrorMessage(json);
  if (errMsg) return { kind: "error", message: errMsg };

  if (typeof json === "object" && json !== null) {
    const o = json as Record<string, unknown>;
    const ch0 = Array.isArray(o.choices) ? o.choices[0] : undefined;
    if (ch0 && typeof ch0 === "object") {
      const c = ch0 as Record<string, unknown>;
      const delta =
        c.delta && typeof c.delta === "object"
          ? (c.delta as Record<string, unknown>)
          : undefined;
      const content = delta?.content;
      if (typeof content === "string" && content.length > 0) {
        return { kind: "delta", text: content };
      }
    }
  }

  return { kind: "skip" };
}

/** 单个 SSE 帧内可能有多行 `data:`，规范要求多行 data 拼成一份 payload */
export function parseOneSseEventBlock(rawEvent: string): SsePayloadResult {
  const lines = rawEvent.split(/\r\n|\n/).map((l) => l.trimEnd());
  const dataParts: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith(":")) continue;
    if (t.startsWith("data:")) {
      dataParts.push(t.slice("data:".length).trim());
    }
  }
  if (dataParts.length === 0) return { kind: "skip" };
  return parseOpenAiSseJsonPayload(dataParts.join("\n"));
}

/** 解析单帧 SSE 为 JSON（供 Agent 合并 tool_calls delta） */
export function parseSseFrameJson(rawEvent: string): unknown | null {
  const lines = rawEvent.split(/\r\n|\n/).map((l) => l.trimEnd());
  const dataParts: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith(":")) continue;
    if (t.startsWith("data:")) {
      dataParts.push(t.slice("data:".length).trim());
    }
  }
  if (dataParts.length === 0) return null;
  const payload = dataParts.join("\n").trim();
  if (payload === "[DONE]") return null;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

export function extractNextDoubleNewline(buf: string): {
  frame: string | null;
  rest: string;
} {
  const rn = buf.indexOf("\r\n\r\n");
  const nn = buf.indexOf("\n\n");
  let sep = -1;
  let sepLen = 2;
  if (rn >= 0 && (nn < 0 || rn <= nn)) {
    sep = rn;
    sepLen = 4;
  } else if (nn >= 0) {
    sep = nn;
    sepLen = 2;
  }
  if (sep < 0) return { frame: null, rest: buf };
  const frame = buf.slice(0, sep);
  const rest = buf.slice(sep + sepLen);
  return { frame, rest };
}

export function abortChatRequest(requestId: number): void {
  const ac = chatAbortControllers.get(requestId);
  ac?.abort();
  chatAbortControllers.delete(requestId);
}

function extractTextFromMessagePart(part: unknown): string {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  const o = part as Record<string, unknown>;
  if (typeof o.text === "string") return o.text;
  return "";
}

function looksLikeStructuredModelOutput(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith("{") || t.startsWith("[")) return true;
  if (t.includes("```")) return true;
  return false;
}

function extractNonStreamAssistantContent(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const o = json as Record<string, unknown>;
  const ch0 = Array.isArray(o.choices) ? o.choices[0] : undefined;
  if (!ch0 || typeof ch0 !== "object") return "";
  const c = ch0 as Record<string, unknown>;
  const msg = c.message;
  if (msg && typeof msg === "object") {
    const m = msg as Record<string, unknown>;
    const content = m.content;
    if (typeof content === "string" && content.trim()) return content;
    if (Array.isArray(content)) {
      const joined = content
        .map(extractTextFromMessagePart)
        .filter(Boolean)
        .join("");
      if (joined.trim()) return joined;
    }
    const reasoningContent = m.reasoning_content;
    if (
      typeof reasoningContent === "string" &&
      looksLikeStructuredModelOutput(reasoningContent)
    ) {
      return reasoningContent;
    }
    const reasoning = m.reasoning;
    if (typeof reasoning === "string" && looksLikeStructuredModelOutput(reasoning)) {
      return reasoning;
    }
  }
  const text = c.text;
  if (typeof text === "string") return text;
  return "";
}

export type ChatCompletionOnceResult = {
  text: string;
  usage: AITokenUsageTotals | null;
};

/** 单次非流式 chat/completions（摘录 JSON、测试等） */
export async function chatCompletionOnce(opts: {
  chat: AIChatEndpoint;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<ChatCompletionOnceResult> {
  const url = `${normalizeBase(opts.chat.baseUrl)}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.chat.apiKey.trim()) {
    applyOpenAiCompatAuthHeaders(headers, opts.chat.baseUrl, opts.chat.apiKey);
  }
  const model = opts.chat.model.trim();
  if (!model) throw new Error("未配置对话模型");

  const configuredTemp = opts.temperature ?? opts.chat.temperature;
  const { temperature, extraBody } = resolveAgentDeepThinkingParams({
    deepThinking: false,
    configuredTemperature: configuredTemp,
    baseUrl: opts.chat.baseUrl,
  });

  const res = await fetch(url, {
    method: "POST",
    headers,
    signal: opts.signal,
    body: JSON.stringify({
      model,
      messages: opts.messages,
      temperature,
      max_tokens: opts.maxTokens ?? opts.chat.maxTokens,
      stream: false,
      ...extraBody,
    }),
  });

  const raw = await res.text().catch(() => "");
  if (!res.ok) {
    let message = `HTTP ${res.status}: ${raw.slice(0, 600)}`;
    if (raw.trim()) {
      try {
        const extracted = extractSseErrorMessage(JSON.parse(raw) as unknown);
        if (extracted) message = extracted;
      } catch {
        /* keep */
      }
    }
    throw new Error(message);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("对话接口返回非 JSON");
  }

  const errMsg = extractSseErrorMessage(parsed);
  if (errMsg) throw new Error(errMsg);

  const text = extractNonStreamAssistantContent(parsed).trim();
  if (!text) throw new Error("模型未返回正文");
  return { text, usage: extractUsageFromChatJson(parsed) };
}

export async function streamChatCompletion(opts: {
  chat: AIChatEndpoint;
  payload: AIChatStreamPayload;
  configSystemPromptExtra: string;
  webContents: WebContents;
}): Promise<void> {
  const { chat, payload, webContents, configSystemPromptExtra } = opts;
  const requestId = payload.requestId;
  const url = `${normalizeBase(chat.baseUrl)}/chat/completions`;

  const windowed = trimMessages(payload.messages, chat.slidingWindowSize);

  const messages: Array<{ role: string; content: string }> = [
    {
      role: "system",
      content: buildSystemPrompt(payload, configSystemPromptExtra),
    },
    ...windowed.map((m) => ({ role: m.role, content: m.content })),
  ];

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (chat.apiKey.trim()) {
    applyOpenAiCompatAuthHeaders(headers, chat.baseUrl, chat.apiKey);
  }

  const ac = new AbortController();
  chatAbortControllers.set(requestId, ac);

  const resolvedModel =
    (payload.chatModelOverride ?? "").trim() || chat.model.trim();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: ac.signal,
      body: JSON.stringify({
        model: resolvedModel,
        messages,
        temperature: chat.temperature,
        max_tokens: chat.maxTokens,
        stream: true,
      }),
    });

    if (!res.ok || !res.body) {
      const raw =
        !res.body ? "" : await res.text().catch(() => "");
      let message = !res.body
        ? `HTTP ${res.status}：响应无正文（body 为空）`
        : `HTTP ${res.status}: ${raw.slice(0, 600)}`;
      if (!res.ok && raw.trim()) {
        try {
          const extracted = extractSseErrorMessage(JSON.parse(raw) as unknown);
          if (extracted) message = extracted;
        } catch {
          /* 保留原始 HTTP 文案 */
        }
      }
      webContents.send("ai:chat:error", {
        requestId,
        message: message.slice(0, 2000),
      });
      return;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let sawDoneMarker = false;
    let emittedAnyDelta = false;

    const dispatch = (pr: SsePayloadResult): boolean => {
      switch (pr.kind) {
        case "delta":
          emittedAnyDelta = true;
          webContents.send("ai:chat:chunk", { requestId, delta: pr.text });
          return false;
        case "done":
          sawDoneMarker = true;
          webContents.send("ai:chat:done", { requestId });
          return true;
        case "error":
          webContents.send("ai:chat:error", {
            requestId,
            message: pr.message,
          });
          return true;
        default:
          return false;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      let nx: ReturnType<typeof extractNextDoubleNewline>;
      while ((nx = extractNextDoubleNewline(buf)).frame !== null) {
        const frame = nx.frame;
        buf = nx.rest;
        const pr = parseOneSseEventBlock(frame);
        if (dispatch(pr)) return;
      }
    }

    if (buf.trim()) {
      const pr = parseOneSseEventBlock(buf.trim());
      if (dispatch(pr)) return;
    }

    if (!emittedAnyDelta && !sawDoneMarker) {
      webContents.send("ai:chat:error", {
        requestId,
        message:
          "对话服务已关闭连接，但未收到任何回复内容。若服务端日志中出现「n_ctx」「context length」「exceeds the available context」「n_keep」等字样，表示当前提示（含本书正文与检索片段）超过了模型上下文长度，请在设置中限制附带正文、减少检索片段，或在服务端增大上下文后再试。",
      });
      return;
    }

    webContents.send("ai:chat:done", { requestId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("abort")) {
      webContents.send("ai:chat:done", { requestId });
      return;
    }
    webContents.send("ai:chat:error", { requestId, message: msg });
  } finally {
    chatAbortControllers.delete(requestId);
  }
}
