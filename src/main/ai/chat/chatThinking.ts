/**
 * 各 OpenAI 兼容对话服务的「深度思考 / 推理」请求参数与流式 delta 字段适配。
 */

import { agnesApiLikely, minimaxApiLikely, mimoApiLikely } from "@shared/apiEndpointPresets";

function normalizeChatBaseUrl(baseUrl: string): string {
  return baseUrl.trim().toLowerCase();
}

/** 本机 Ollama / LM Studio 等：请求体 `think: true` */
export function localOpenAiCompatLikely(baseUrl: string): boolean {
  const u = normalizeChatBaseUrl(baseUrl);
  return (
    u.includes("localhost") ||
    u.includes("127.0.0.1") ||
    u.includes("0.0.0.0") ||
    u.includes(":11434") ||
    u.includes("/ollama")
  );
}

export function deepseekCloudLikely(baseUrl: string): boolean {
  return normalizeChatBaseUrl(baseUrl).includes("deepseek.com");
}

/** 阿里云 DashScope OpenAI 兼容模式 */
export function dashscopeLikely(baseUrl: string): boolean {
  const u = normalizeChatBaseUrl(baseUrl);
  return u.includes("dashscope") || u.includes("aliyuncs.com");
}

/** 智谱 GLM 官方 OpenAI 兼容 */
export function zhipuLikely(baseUrl: string): boolean {
  const u = normalizeChatBaseUrl(baseUrl);
  return (
    u.includes("bigmodel.cn") ||
    u.includes("open.bigmodel.cn") ||
    u.includes("z.ai")
  );
}

export function moonshotLikely(baseUrl: string): boolean {
  const u = normalizeChatBaseUrl(baseUrl);
  return u.includes("moonshot.cn") || u.includes("moonshot.ai");
}

/** 硅基流动：Qwen 等思考模型常用 enable_thinking */
export function siliconflowLikely(baseUrl: string): boolean {
  return normalizeChatBaseUrl(baseUrl).includes("siliconflow");
}

/** OpenRouter：统一 `reasoning.effort` */
export function openrouterLikely(baseUrl: string): boolean {
  return normalizeChatBaseUrl(baseUrl).includes("openrouter");
}

/** Google AI Gemini OpenAI 兼容端点（generativelanguage…/v1beta/openai） */
export function geminiOpenAiCompatLikely(baseUrl: string): boolean {
  const u = normalizeChatBaseUrl(baseUrl);
  return (
    u.includes("generativelanguage.googleapis.com") ||
    (u.includes("googleapis.com") && u.includes("/openai"))
  );
}

/** Agnes AI OpenAI 兼容网关 */
export function agnesLikely(baseUrl: string): boolean {
  return agnesApiLikely(baseUrl);
}

/** MiniMax OpenAI 兼容对话 */
export function minimaxLikely(baseUrl: string): boolean {
  return minimaxApiLikely(baseUrl);
}

/** 小米 MiMo OpenAI 兼容对话 */
export function mimoLikely(baseUrl: string): boolean {
  return mimoApiLikely(baseUrl);
}

/** 工具轮 assistant 消息是否应携带 reasoning_content（与 DeepSeek / 智谱 / 通义等一致） */
export function shouldAttachReasoningContentOnToolCalls(
  baseUrl: string,
): boolean {
  return (
    deepseekCloudLikely(baseUrl) ||
    dashscopeLikely(baseUrl) ||
    zhipuLikely(baseUrl) ||
    moonshotLikely(baseUrl) ||
    siliconflowLikely(baseUrl) ||
    openrouterLikely(baseUrl) ||
    geminiOpenAiCompatLikely(baseUrl) ||
    agnesLikely(baseUrl) ||
    minimaxLikely(baseUrl) ||
    mimoLikely(baseUrl)
  );
}

function applyDeepThinkingToExtraBody(
  extraBody: Record<string, unknown>,
  baseUrl: string,
  deepThinking: boolean,
): void {
  if (localOpenAiCompatLikely(baseUrl)) {
    extraBody.think = deepThinking;
    return;
  }
  if (deepseekCloudLikely(baseUrl)) {
    extraBody.thinking = { type: deepThinking ? "enabled" : "disabled" };
    return;
  }
  if (zhipuLikely(baseUrl)) {
    extraBody.thinking = { type: deepThinking ? "enabled" : "disabled" };
    return;
  }
  if (dashscopeLikely(baseUrl)) {
    // Qwen3 等：非流式也要求显式 enable_thinking（true/false）
    extraBody.enable_thinking = deepThinking;
    return;
  }
  if (moonshotLikely(baseUrl)) {
    extraBody.enable_thinking = deepThinking;
    return;
  }
  if (siliconflowLikely(baseUrl)) {
    extraBody.enable_thinking = deepThinking;
    return;
  }
  if (openrouterLikely(baseUrl)) {
    extraBody.reasoning = { effort: deepThinking ? "high" : "none" };
    return;
  }
  if (geminiOpenAiCompatLikely(baseUrl)) {
    // 与 reasoning_effort 二选一；勿同时传 thinking_config
    extraBody.reasoning_effort = deepThinking ? "high" : "none";
    return;
  }
  if (agnesLikely(baseUrl)) {
    extraBody.chat_template_kwargs = { enable_thinking: deepThinking };
    return;
  }
  if (minimaxLikely(baseUrl)) {
    extraBody.thinking = {
      type: deepThinking ? "enabled" : "disabled",
    };
    extraBody.reasoning_split = deepThinking;
    return;
  }
  if (mimoLikely(baseUrl)) {
    extraBody.thinking = {
      type: deepThinking ? "enabled" : "disabled",
    };
  }
}

/** `deepThinking` 时用更高温度；按接口地址注入各厂商思考开关 */
export function resolveAgentDeepThinkingParams(opts: {
  deepThinking: boolean;
  configuredTemperature: number;
  baseUrl: string;
}): { temperature: number; extraBody: Record<string, unknown> } {
  const temperature = opts.deepThinking ? 1 : opts.configuredTemperature;
  const extraBody: Record<string, unknown> = {};
  applyDeepThinkingToExtraBody(extraBody, opts.baseUrl, opts.deepThinking);
  return { temperature, extraBody };
}

/** 从 chat/completions 流式 chunk 的 delta 解析推理文本 */
export function extractReasoningFromStreamDelta(
  delta: Record<string, unknown> | undefined,
): string | undefined {
  if (!delta) return undefined;
  if (typeof delta.reasoning_content === "string") {
    return delta.reasoning_content;
  }
  if (typeof delta.reasoning === "string") return delta.reasoning;
  if (typeof delta.thinking === "string") return delta.thinking;
  if (typeof delta.thought === "string") return delta.thought;
  return undefined;
}
