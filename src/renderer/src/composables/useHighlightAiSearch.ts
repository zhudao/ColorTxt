import { ref, type Ref } from "vue";
import { appAlert, appPrompt } from "../services/appDialog";
import { hashBookBrowser } from "../utils/aiBookHash";

export type UseHighlightAiSearchOptions = {
  sessionFilePath: Ref<string | null | undefined>;
  physicalReaderPath: Ref<string | null | undefined>;
  chapterCount: Ref<number>;
  /** 检索成功后的词语列表（已按出现次数降序） */
  onTerms: (terms: string[]) => void;
};

let nextWordcloudRequestId = 1;

/**
 * 侧栏高亮词「AI 检索」：复用 semantic 词云管线，只要词语列表并打开添加面板。
 * 始终全书检索，不受「防剧透」限制。
 * 进度以列表内信息条展示，不挡其它操作；可由信息条「停止」中止。
 * 停止时若已有抽到的词项，主进程会返回部分结果并打开添加面板。
 */
export function useHighlightAiSearch(opts: UseHighlightAiSearchOptions) {
  const searching = ref(false);
  /** 列表信息条文案，如「正在检索「人名」」（末尾弹跳点由界面组件拼接） */
  const searchBannerText = ref("");
  let activeRequestId: number | null = null;

  async function resolveBookHash(): Promise<string | null> {
    const session = opts.sessionFilePath.value?.trim();
    const physical = opts.physicalReaderPath.value?.trim() || session;
    if (!session || !physical) return null;
    try {
      const st = await window.colorTxt.stat(physical);
      if (!st.isFile) return null;
      return hashBookBrowser(session, st.size, st.mtimeMs);
    } catch {
      return null;
    }
  }

  /** 停止检索：已完成批次的词项会作为结果返回 */
  function stopSearch(): void {
    if (activeRequestId == null) return;
    void window.colorTxt.ai.wordcloudAbort(activeRequestId);
  }

  async function runSemanticSearch(semanticQuery: string): Promise<void> {
    if (searching.value) return;

    const q = semanticQuery.trim();
    if (!q) {
      await appAlert("请输入检索语义。");
      return;
    }
    if (!opts.sessionFilePath.value?.trim()) {
      await appAlert("请先打开一本书。");
      return;
    }
    const chapterCount = opts.chapterCount.value;
    if (!Number.isFinite(chapterCount) || chapterCount <= 0) {
      await appAlert("当前书籍没有可检索的章节。");
      return;
    }

    const bookHash = await resolveBookHash();
    if (!bookHash) {
      await appAlert("无法识别当前书籍，请确认文件已正确打开。");
      return;
    }

    const requestId = nextWordcloudRequestId++;
    activeRequestId = requestId;
    searching.value = true;
    searchBannerText.value = `正在检索「${q}」`;
    try {
      const res = await window.colorTxt.ai.wordcloudRun({
        bookHash,
        chapterCount: Math.trunc(chapterCount),
        semanticQuery: q,
        title: `AI 检索：${q}`,
        unlimitedTerms: true,
        requestId,
      });

      if (!res.ok) {
        if (res.aborted) return;
        await appAlert(res.error || "AI 检索失败。");
        return;
      }

      const terms = res.result.words.map((w) => w.text).filter(Boolean);
      if (terms.length === 0) {
        await appAlert("未检索到相关词语。");
        return;
      }
      opts.onTerms(terms);
    } finally {
      if (activeRequestId === requestId) activeRequestId = null;
      searching.value = false;
      searchBannerText.value = "";
    }
  }

  async function searchPreset(label: string): Promise<void> {
    await runSemanticSearch(label);
  }

  async function searchCustomSemantic(): Promise<void> {
    const input = await appPrompt("描述要检索的词语语义", {
      title: "AI 检索：自定义语义",
      placeholder: "例如：武功招式、修行境界、武器装备、官职…",
      defaultValue: "",
    });
    if (input == null) return;
    await runSemanticSearch(input);
  }

  return {
    searching,
    searchBannerText,
    stopSearch,
    searchPreset,
    searchCustomSemantic,
    runSemanticSearch,
  };
}
