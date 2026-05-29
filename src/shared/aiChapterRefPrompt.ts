/**
 * 用户可见章节跳转的唯一字面格式（系统提示 / 工具说明共用），减少模型自创 `[ch=]`、`(ch=M: N)` 等变体。
 * 约定用**全角括号**包裹，避免正文出现形如 `[...](ch=N)` 时被 Markdown 误解析为链接（方括号内不限于序号）。
 */

/** 对用户如何称呼章节（与跳转标记配合） */
export const AI_USER_VISIBLE_CHAPTER_NAMING =
  "对用户回答中的章节称呼**只写**工具 JSON 的 **chapterTitle**（如「第三十九回 大战襄阳」），与书中回目一致。**禁止**在对用户可见正文写 chapterIndex、chapterIndex=、`(chapterIndex=数字)`、或将 chapterIndex / chapterIndex+1 换算成「第 N 章」与回目混用。定位「在哪一章」类问题时，直接给出 chapterTitle 即可，**勿**再解释内部序号。";

/** Agent 系统提示中单独成行 */
export const AI_USER_VISIBLE_CH_REF_RULE =
  `${AI_USER_VISIBLE_CHAPTER_NAMING} 章节跳转标记（可点击跳转，勿向用户解释其含义）**必须且仅能**写 \`（ch=N）\`：全角括号 \`（\` \`）\` + 半角 \`ch=\` + 数字 **N = chapterIndex（与 rag JSON 一致，从 0 起，仅作跳转锚点）**。**多个章节**写 \`（ch=2）（ch=5）\`，**禁止** \`（ch=2, ch=5）\`、\`（ch=25-26）\`、\`（ch=25提及）\` 等同括号内夹说明（说明写在标记外）。**勿用半角** \`(ch=N)\`（易与 \`[…]\` 连成 Markdown 链接）、**禁止** \`[ch=N]\`、\`(ch=字母: N)\` 等自创格式。正文叙述用 chapterTitle；\`（ch=N）\` 仅附在首次提及处，勿堆砌多个重复标记。`;

/** 非 Agent（经典 RAG）系统提示里较短一句 */
export const AI_USER_VISIBLE_CH_REF_SHORT =
  `${AI_USER_VISIBLE_CHAPTER_NAMING} 跳转标记写 \`（ch=N）\`（N=chapterIndex，从 0 起，勿向用户解释）。多章写 \`（ch=a）（ch=b）\`。叙述用 chapterTitle，勿写 chapterIndex= 或「第 N 章」换算。`;

/** 工具 mergedMarkdown 里的章节分隔：仅用书中 chapterTitle，避免「第 N 章」与 chapterIndex 误导模型 */
export function formatAiToolChapterHeading(
  _chapterIndex: number,
  chapterTitle: string,
): string {
  const t = chapterTitle.trim();
  return t || "（无标题）";
}
