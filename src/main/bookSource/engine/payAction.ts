/**
 * 对齐 Legado `ReadBookActivity.payAction`：执行书源 `ruleContent.payAction`。
 */
import type { Book, BookChapter, BookSourceRecord } from "@shared/bookSource/types";
import { coerceBook, toEngineBook } from "@shared/bookSource/bookModel";
import { AnalyzeRule } from "./analyzeRule";
import { createJsExtensionHost } from "./jsExtensions";
import { getVerificationResult, isVerificationCancelled } from "./sourceVerification";
import { deleteChapterCache } from "./chapterCache";

/** 对齐 Legado `String.isAbsUrl()` */
function isAbsUrl(s: string): boolean {
  const t = s.trim();
  return /^https?:\/\//i.test(t);
}

/** 对齐 Legado `String.isTrue()`（购买成功判定） */
function isTruthyResult(s: string): boolean {
  const v = s.trim();
  if (!v || v === "null") return false;
  return !/^(false|no|not|0)$/i.test(v);
}

export type RunPayActionParams = {
  source: BookSourceRecord;
  book: Book;
  chapter: BookChapter;
  cacheDir?: string;
};

export type RunPayActionResult = {
  ok: boolean;
  message?: string;
  cancelled?: boolean;
  /** 购买成功：已删该章缓存，调用方应刷新目录并重载正文 */
  refresh?: boolean;
  logs: string[];
};

export async function runChapterPayAction(
  params: RunPayActionParams,
): Promise<RunPayActionResult> {
  const logs: string[] = [];
  const payAction = params.source.ruleContent?.payAction?.trim();
  if (!payAction) {
    return { ok: false, message: "此书源未配置购买操作", logs };
  }

  const book = coerceBook(params.book);
  const chapter = params.chapter;
  const chapterUrl = chapter.url?.trim() ?? "";
  if (!chapterUrl) {
    return { ok: false, message: "章节无效", logs };
  }

  try {
    const host = createJsExtensionHost(params.source, logs);
    const ar = new AnalyzeRule(params.source, logs, host)
      .setBook(toEngineBook(book))
      .setChapter({ ...chapter })
      .setContent("", chapterUrl);
    const raw = await ar.evalJS(payAction);
    const result = String(raw ?? "");

    if (isAbsUrl(result)) {
      try {
        await getVerificationResult(
          params.source.bookSourceUrl,
          result.trim(),
          "购买",
          { refetchAfterSuccess: false, source: params.source },
        );
        return { ok: true, logs };
      } catch (e) {
        if (isVerificationCancelled(e)) {
          return { ok: false, cancelled: true, logs };
        }
        throw e;
      }
    }

    if (isTruthyResult(result)) {
      await deleteChapterCache(
        book.name,
        book.bookUrl,
        chapterUrl,
        params.cacheDir,
      );
      return { ok: true, refresh: true, logs };
    }

    return { ok: true, logs };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logs.push(`执行购买操作出错: ${msg}`);
    return { ok: false, message: msg || "执行购买操作出错", logs };
  }
}
