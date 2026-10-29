import { ref, toValue, type MaybeRefOrGetter } from "vue";
import type { BookChapter } from "@shared/bookSource/types";

/**
 * 目录「已缓存」勾标：详情页与阅读器侧栏共用。
 */
export function useChapterCacheMarks(opts: {
  bookName: MaybeRefOrGetter<string>;
  bookUrl: MaybeRefOrGetter<string>;
  /** 非分卷章节 URL 列表 */
  chapterUrls: MaybeRefOrGetter<string[]>;
  cacheDir: MaybeRefOrGetter<string | undefined>;
}) {
  const cachedChapterUrls = ref(new Set<string>());

  function clearLocal() {
    cachedChapterUrls.value = new Set();
  }

  function markCached(chapterUrl: string) {
    if (!chapterUrl || cachedChapterUrls.value.has(chapterUrl)) return;
    const next = new Set(cachedChapterUrls.value);
    next.add(chapterUrl);
    cachedChapterUrls.value = next;
  }

  function isCached(ch: BookChapter | undefined): boolean {
    return Boolean(ch?.url && cachedChapterUrls.value.has(ch.url));
  }

  async function refresh(): Promise<void> {
    const bookUrl = toValue(opts.bookUrl).trim();
    const urls = toValue(opts.chapterUrls);
    if (!bookUrl || !urls.length) {
      clearLocal();
      return;
    }
    try {
      const res = await window.colorTxt.bookSourceChapterCacheStatus({
        name: toValue(opts.bookName).trim(),
        bookUrl,
        chapterUrls: urls,
        cacheDir: toValue(opts.cacheDir)?.trim() || undefined,
      });
      cachedChapterUrls.value = new Set(res.cachedUrls ?? []);
    } catch {
      clearLocal();
    }
  }

  return {
    cachedChapterUrls,
    refresh,
    markCached,
    clearLocal,
    isCached,
  };
}
