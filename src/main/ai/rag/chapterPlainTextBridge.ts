import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { ipcMain } from "electron";

/** 向渲染进程索取与阅读器一致的章节原文（标题行至下一章前） */
export async function fetchChapterPlainTextFromRenderer(
  webContents: WebContents,
  chapterIndex: number,
  maxChars: number,
): Promise<string | null> {
  if (webContents.isDestroyed()) return null;
  const replyChannel = `ai:chapter-plain-reply:${randomUUID()}`;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 20_000);
    ipcMain.once(replyChannel, (_evt, text: unknown) => {
      clearTimeout(timeout);
      resolve(typeof text === "string" ? text : null);
    });
    webContents.send("ai:chapter-plain-request", {
      replyChannel,
      chapterIndex,
      maxChars,
    });
  });
}
