/** 与 `BUILTIN_AI_SKILLS` 中对应项 id 一致；主进程据此在启用该技能时放宽 RAG 防剧透章节过滤 */
export const CHAPTER_MATCH_RULES_SKILL_ID = "chapter-match-rules" as const;

/** 编辑模式「AI 智能排版」提示词来源；默认不在对话助手中注册为工具 */
export const SMART_FORMAT_SKILL_ID = "smart-format" as const;

/** OpenAI function name：字母数字与 _ - */
export function sanitizeAgentSkillToolName(id: string): string {
  const s = id.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  return s.length > 0 ? s : "skill";
}

/** 与 ragSearch/ragContext/getSkills 隔离的技能工具名 */
export function agentSkillToolFunctionName(id: string): string {
  return `skill_${sanitizeAgentSkillToolName(id)}`;
}
