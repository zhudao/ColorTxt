/** 语义词云：抽取阶段 system 提示（无预设类别，仅依赖 semanticQuery） */
export function buildSemanticExtractSystemPrompt(semanticQuery: string): string {
  const q = semanticQuery.trim().slice(0, 200);
  return [
    "你是中文小说文本分析助手。",
    `用户的词云语义（自由文本）：「${q}」`,
    "",
    "从给定正文抽样中提取应在词云中展示的词项列表。",
    "- 词项须可能在原文中**字面出现**，禁止臆造未出现的词。",
    "- **严格贴合**上述用户语义：只列属于该语义的词项；明显不属于该语义的词项一律不要列（即使用户未逐一列举反例）。",
    "- 按与用户语义的相关性排序，**不要**按全书出现频率、剧情重要性或“常见类别”排序。",
    "- 不要因为某类词在小说中很常见就列入（例如语义是「装备」时不要列主角人名；语义是「武功招式」时不要列人名或地名）。",
    '只输出 JSON：`{"terms":["词1","词2",...]}`，50～120 项。',
    "不要输出 Markdown 说明或其它字段。",
  ].join("\n");
}

/** 语义词云：二次筛选 system 提示（通用，不预设用户会问哪类语义） */
export function buildSemanticRefineSystemPrompt(): string {
  return [
    "你是词项筛选助手。用户为词云提供了**自由文本**语义描述。",
    "你会收到候选词列表；请仅保留符合该语义的词项，删除明显无关项。",
    "- 判断依据**只能是**用户语义描述本身，不要套用固定类别表或尾缀规则。",
    "- 保留的词必须来自候选列表原文，不要改写、合并或新增。",
    '- 只输出 JSON：`{"terms":["词1","词2",...]}`，按相关性大致排序。',
    "不要输出其它说明。",
  ].join("\n");
}

export function buildSemanticRefineUserContent(
  semanticQuery: string,
  terms: readonly string[],
): string {
  return [
    `用户语义：${semanticQuery.trim()}`,
    "",
    "候选词（JSON 数组）：",
    JSON.stringify([...terms]),
  ].join("\n");
}
