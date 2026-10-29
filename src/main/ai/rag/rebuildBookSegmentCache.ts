import type { WebContents } from "electron";
import type { AIConfig } from "@shared/aiTypes";
import { fetchChaptersPlainTextRange } from "../tools/wordcloudChapterFetch";
import {
  deleteBookSegmentCache,
  getOrBuildChapterFreq,
} from "./segmentCache";

export async function rebuildBookSegmentCache(opts: {
  webContents: WebContents;
  bookHash: string;
  chapterCount: number;
  aiConfig: AIConfig;
  onProgress?: (current: number, total: number) => void;
}): Promise<{ ok: true; chaptersBuilt: number } | { ok: false; error: string }> {
  const bookHash = opts.bookHash.trim();
  const chapterCount = Math.max(0, Math.trunc(opts.chapterCount));
  if (!bookHash) return { ok: false, error: "无效 bookHash" };
  if (chapterCount <= 0) return { ok: false, error: "没有可分词的章节" };

  deleteBookSegmentCache(bookHash, opts.aiConfig);

  const slices = await fetchChaptersPlainTextRange({
    webContents: opts.webContents,
    chapterCount,
    minChapterIndex: 0,
    maxChapterIndex: chapterCount - 1,
    onProgress: opts.onProgress,
  });
  if (slices.length === 0) {
    return { ok: false, error: "无法从阅读器取得章节正文，请确认书籍已加载" };
  }

  for (const slice of slices) {
    getOrBuildChapterFreq(
      bookHash,
      slice.chapterIndex,
      slice.text,
      undefined,
      opts.aiConfig,
    );
  }
  return { ok: true, chaptersBuilt: slices.length };
}
