import { hashBookBrowser } from "./aiBookHash";

async function resolveBookHash(
  sessionPath: string,
  physicalPath: string,
): Promise<string | null> {
  const session = sessionPath.trim();
  const physical = physicalPath.trim();
  if (!session || !physical || !window.colorTxt?.ai) return null;
  let st;
  try {
    st = await window.colorTxt.stat(physical);
  } catch {
    return null;
  }
  if (!st.isFile) return null;
  return hashBookBrowser(session, st.size, st.mtimeMs);
}

/**
 * 按与 AI 阅读助手相同的 bookHash 规则删除该书全部对话（threads + CASCADE messages）。
 * `sessionPath`：会话/列表路径；`physicalPath`：用于取 size/mtime 的正文路径（电子书多为转换后的 .md）。
 */
export async function clearAiChatHistoryForBook(options: {
  sessionPath: string;
  physicalPath: string;
}): Promise<void> {
  const bookHash = await resolveBookHash(
    options.sessionPath,
    options.physicalPath,
  );
  if (!bookHash) return;
  const list = await window.colorTxt.ai.threadList(bookHash);
  for (const t of list) {
    await window.colorTxt.ai.threadDelete(t.id);
  }
}

/**
 * 清除该书全部 AI 阅读痕迹：对话记录、向量索引、词云分词缓存。
 */
export async function clearAiReadingTracesForBook(options: {
  sessionPath: string;
  physicalPath: string;
}): Promise<void> {
  const bookHash = await resolveBookHash(
    options.sessionPath,
    options.physicalPath,
  );
  if (!bookHash) return;
  const list = await window.colorTxt.ai.threadList(bookHash);
  for (const t of list) {
    await window.colorTxt.ai.threadDelete(t.id);
  }
  await window.colorTxt.ai.indexDeleteBook(bookHash);
  await window.colorTxt.ai.segmentDeleteBook(bookHash);
}
