import type { AIAgentEnabledSkill } from "@shared/aiTypes";
import { AI_AGENT_TOOLS } from "@shared/aiTypes";

import {
  agentSkillToolFunctionName,
  CHAPTER_MATCH_RULES_SKILL_ID,
} from "@shared/aiAgentSkillToolNames";

export {
  agentSkillToolFunctionName,
  sanitizeAgentSkillToolName,
} from "@shared/aiAgentSkillToolNames";

const MAX_SKILL_PROMPT_IN_GET_SKILLS = 8000;

function getSkillsOpenAiTool() {
  return {
    type: "function" as const,
    function: {
      name: "getSkills",
      description:
        "查询当前已启用的阅读技能（提示词模板/SOP）。当用户任务涉及摘要、概念解释、论证分析、翻译等体裁时，可先调用以匹配技能；也可直接调用对应技能工具（工具名为技能 id）。",
      parameters: {
        type: "object",
        properties: {
          reasoning: {
            type: "string",
            description: "简要说明为何查询技能",
          },
          task: {
            type: "string",
            description:
              "任务类型或关键词（如：摘要、summary、人物、论证、翻译）",
          },
        },
        required: ["reasoning", "task"],
        additionalProperties: false,
      },
    },
  };
}

function skillToOpenAiTool(s: AIAgentEnabledSkill) {
  const name = agentSkillToolFunctionName(s.id);
  return {
    type: "function" as const,
    function: {
      name,
      description: `[${s.title}] ${s.description}`,
      parameters: {
        type: "object",
        properties: {
          reasoning: {
            type: "string",
            description: "简要说明为何调用该技能",
          },
        },
        required: ["reasoning"],
        additionalProperties: false,
      },
    },
  };
}

/** ragSearch / ragContext（可选）+ getSkills + 各启用技能一项工具 */
export function buildAgentToolsWithSkills(
  enabledSkills: AIAgentEnabledSkill[],
  includeRag = true,
  options: { includeRagContext?: boolean } = {},
): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> {
  const includeRagContext = options.includeRagContext !== false;
  let tools = includeRag ? [...AI_AGENT_TOOLS] : [];
  if (includeRag && !includeRagContext) {
    tools = tools.filter((t) => t.function.name !== "ragContext");
  }
  tools.push(getSkillsOpenAiTool());
  const seen = new Set<string>();
  for (const s of enabledSkills) {
    const n = agentSkillToolFunctionName(s.id);
    if (seen.has(n)) continue;
    seen.add(n);
    tools.push(skillToOpenAiTool(s));
  }
  return tools;
}

/** getSkills 工具执行结果 JSON */
export function runGetSkillsTool(
  taskRaw: string,
  enabledSkills: AIAgentEnabledSkill[],
): string {
  const task = taskRaw.toLowerCase().trim();
  if (!task) {
    return JSON.stringify({
      found: enabledSkills.length,
      message:
        "未指定 task 关键词；以下为当前全部可用技能（可带上 task 再次调用以筛选并获取 skillPrompt）：",
      skills: enabledSkills.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
      })),
    });
  }
  const matched = enabledSkills.filter(
    (s) =>
      s.title.toLowerCase().includes(task) ||
      s.description.toLowerCase().includes(task) ||
      s.id.toLowerCase().includes(task),
  );

  const trimPrompt = (p: string) =>
    p.length <= MAX_SKILL_PROMPT_IN_GET_SKILLS
      ? p
      : `${p.slice(0, MAX_SKILL_PROMPT_IN_GET_SKILLS)}\n…（skillPrompt 已截断）`;

  if (matched.length > 0) {
    return JSON.stringify({
      found: matched.length,
      skills: matched.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        skillPrompt: trimPrompt(s.prompt),
      })),
    });
  }

  return JSON.stringify({
    found: 0,
    message: `未匹配到与 "${taskRaw}" 直接对应的技能。以下为当前可用技能（名称与描述）：`,
    availableSkills: enabledSkills.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
    })),
  });
}

/** 单个技能工具调用返回（供模型下一轮遵循） */
export function runSkillInvokeTool(skill: AIAgentEnabledSkill): string {
  const baseInstruction =
    skill.id === CHAPTER_MATCH_RULES_SKILL_ID
      ? "请严格遵循上述 skillPrompt。**本轮为章节匹配规则**：**禁止**调用 ragContext（不要读取章节原文）。若用户消息中已有章节标题示例行，**必须先**在**对用户的可见回复**中给出 **一个** fenced 代码块（块内仅一行匹配规则）。仅当需要对照全书其它章节的**标题行格式**时，可**可选**调用 ragSearch；**禁止**据情节写规则或剧透。"
      : "请严格遵循上述 skillPrompt 的体裁与步骤组织答案；事实内容必须来自本书：若尚未调用 ragSearch/ragContext，请先检索原文再作答。仍需遵守系统提示中的 `（ch=N）` 章节标记（全角括号）与不得臆造情节的约束。";
  const chapterMatchExtra =
    " **章节匹配规则（硬性）**：调用本工具后，你仍须在**对用户的本条可见回复**里单独给出**一个** fenced 代码块，**块内仅一行**匹配规则（用户从对话里直接复制），**禁止**只写「工具已返回规范/详见上文 JSON」而**不写**该行代码块。若用户消息里**已给出**完整章节标题示例行（如「第一章 标题」），**允许**先按该样例写出这一行匹配规则，再一句建议用 ragSearch 校验全书；**不得以**「须先检索」为由使本条回复中**没有** fenced 单行。**量词**：凡「第…章/回…」形态，「第」与单位之间的数字字类**紧后**的量词**必须字面**为 `{1,12}`（禁止 `{1,2}`、`{1,3}`）；`{1,12}` 表示至多 12 **个**数字字符，不是「两位阿拉伯数」。**仅序号样例**：若用户每条示例均为整行纯序号、无空格后副标题，禁止第二捕获组(.{0,40})与 \\s*(.{0,40})；须单捕获组后以\\s*$结束。**整行骨架**：必须以 ^\\s* 开头、以 \\s*$ 结尾；中间仅 1～2 个捕获组且第 1 组为章节头；禁止行尾 .*$、禁止仅章节名组。";
  const instruction =
    skill.id === CHAPTER_MATCH_RULES_SKILL_ID
      ? baseInstruction + chapterMatchExtra
      : baseInstruction;
  return JSON.stringify({
    skillId: skill.id,
    skillName: skill.title,
    skillPrompt: skill.prompt,
    instruction,
  });
}

/** 根据 OpenAI tool name 解析技能 */
export function findAgentSkillByToolName(
  toolName: string,
  enabledSkills: AIAgentEnabledSkill[],
): AIAgentEnabledSkill | undefined {
  const t = toolName.trim();
  return enabledSkills.find((s) => agentSkillToolFunctionName(s.id) === t);
}
