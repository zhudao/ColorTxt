import { computed, ref, watch, type Ref } from "vue";
import type ReaderMain from "../components/ReaderMain.vue";
import { APP_DISPLAY_NAME } from "../constants/appUi";
import { appAlert, appConfirm } from "../services/appDialog";
import { appToast } from "../services/appToast";
import { applyTextDisplayConverts } from "../services/textConvertApply";
import {
  assignHighlightTermToColorForFile,
  fileNameKey,
  findFileMetaRecord,
  removeHighlightGroupFromFile,
  removeHighlightTermFromFile,
  upsertFileMetaRecord,
  upsertHighlightGroupForFile,
  type FileMetaRecord,
  type HighlightWordsByIndex,
} from "../stores/fileMetaStore";
import {
  buildHighlightListTerms,
  groupExistsInHighlightMap,
  highlightGroupsEqual,
  mergeHighlightGroupsInMap,
  mergeHighlightWordsByIndex,
  normalizeHighlightGroup,
  removeHighlightGroupFromMap,
  removeHighlightTermFromMap,
  splitTermFromHighlightGroupInMap,
  upsertHighlightGroupInMap,
  type HighlightListTerm,
} from "../utils/highlightWords";
import {
  isTextConvertDisplayActive,
  type TextConvertWidthMode,
  type TextConvertZhMode,
} from "@shared/textConvertTypes";

type ReaderRef = Ref<InstanceType<typeof ReaderMain> | null>;

/**
 * 高亮词：展示层刷新、侧栏列表、CRUD / 导入导出。
 */
export function useAppHighlightTerms(deps: {
  readerRef: ReaderRef;
  currentFile: Ref<string | null>;
  loading: Ref<boolean>;
  totalLineCount: Ref<number>;
  readerEditMode: Ref<boolean>;
  fileMetaRecords: Ref<FileMetaRecord[]>;
  highlightWordsByIndexGlobal: Ref<HighlightWordsByIndex | undefined>;
  highlightColorsForReader: Ref<readonly string[]>;
  currentTheme: Ref<string>;
  readerSurfaceLight: Ref<{ bodyText: string }>;
  readerSurfaceDark: Ref<{ bodyText: string }>;
  textConvertZh: Ref<TextConvertZhMode>;
  textConvertLetter: Ref<TextConvertWidthMode>;
  textConvertDigit: Ref<TextConvertWidthMode>;
  persistFileMeta: () => void;
  persistSettings: () => void;
  isVoiceReadNavigationBlocked: Ref<boolean>;
  ensurePinBeforeRevealFindWidget: () => void;
  hasInlineSearchHighlight: Ref<boolean>;
}) {
  const currentFileHighlightWords = computed(() => {
    const path = deps.currentFile.value;
    if (!path) return undefined;
    return findFileMetaRecord(deps.fileMetaRecords.value, path)
      ?.highlightWordsByIndex;
  });

  const mergedHighlightWordsForReader = computed(() =>
    mergeHighlightWordsByIndex(
      deps.highlightWordsByIndexGlobal.value,
      currentFileHighlightWords.value,
    ),
  );

  /** 只读展示层转换后的高亮词（Monaco 上色 / 侧栏列表 / 查找） */
  const readerDisplayHighlightWordsByIndex = ref<
    HighlightWordsByIndex | undefined
  >(undefined);
  const readerDisplayHighlightWordsBookOnly = ref<
    HighlightWordsByIndex | undefined
  >(undefined);
  const currentFileHighlightTerms = ref<HighlightListTerm[]>([]);

  let refreshHighlightDisplayGen = 0;

  function highlightListBodyTextColor(): string {
    return deps.currentTheme.value === "vs"
      ? deps.readerSurfaceLight.value.bodyText
      : deps.readerSurfaceDark.value.bodyText;
  }

  async function refreshReaderHighlightDisplayLayer() {
    const gen = ++refreshHighlightDisplayGen;
    const global = deps.highlightWordsByIndexGlobal.value;
    const book = currentFileHighlightWords.value;
    const colors = deps.highlightColorsForReader.value;
    const bodyText = highlightListBodyTextColor();
    const convertOpts = {
      zh: deps.textConvertZh.value,
      letter: deps.textConvertLetter.value,
      digit: deps.textConvertDigit.value,
    };
    const applyConvert =
      !deps.readerEditMode.value &&
      isTextConvertDisplayActive(
        convertOpts.zh,
        convertOpts.letter,
        convertOpts.digit,
      );

    if (!applyConvert) {
      if (gen !== refreshHighlightDisplayGen) return;
      readerDisplayHighlightWordsByIndex.value =
        mergedHighlightWordsForReader.value;
      readerDisplayHighlightWordsBookOnly.value = book;
      currentFileHighlightTerms.value = buildHighlightListTerms(
        global,
        book,
        colors,
        bodyText,
      );
      return;
    }

    const displayByStored = new Map<string, string>();

    async function convertMapWithLookup(
      map: HighlightWordsByIndex | undefined,
    ): Promise<HighlightWordsByIndex | undefined> {
      if (!map) return undefined;
      const out: HighlightWordsByIndex = {};
      for (const [key, groups] of Object.entries(map)) {
        const convertedGroups: string[][] = [];
        for (const group of groups) {
          const converted: string[] = [];
          for (const stored of group) {
            if (!stored) continue;
            let display = displayByStored.get(stored);
            if (display == null) {
              display = await applyTextDisplayConverts(stored, convertOpts);
              displayByStored.set(stored, display);
            }
            converted.push(display);
          }
          if (converted.length > 0) convertedGroups.push(converted);
        }
        if (convertedGroups.length > 0) out[key] = convertedGroups;
      }
      return Object.keys(out).length > 0 ? out : undefined;
    }

    const [globalDisplay, bookDisplay] = await Promise.all([
      convertMapWithLookup(global),
      convertMapWithLookup(book),
    ]);
    if (gen !== refreshHighlightDisplayGen) return;

    readerDisplayHighlightWordsByIndex.value = mergeHighlightWordsByIndex(
      globalDisplay,
      bookDisplay,
    );
    readerDisplayHighlightWordsBookOnly.value = bookDisplay;
    currentFileHighlightTerms.value = buildHighlightListTerms(
      global,
      book,
      colors,
      bodyText,
      (stored) => displayByStored.get(stored) ?? stored,
    );
  }

  watch(
    [
      mergedHighlightWordsForReader,
      () => deps.textConvertZh.value,
      () => deps.textConvertLetter.value,
      () => deps.textConvertDigit.value,
      deps.readerEditMode,
      deps.highlightColorsForReader,
      deps.currentTheme,
    ],
    () => {
      void refreshReaderHighlightDisplayLayer();
    },
    { deep: true, immediate: true },
  );

  function onAddHighlightTerm(payload: { text: string; colorIndex: number }) {
    const path = deps.currentFile.value;
    if (!path) return;
    deps.fileMetaRecords.value = assignHighlightTermToColorForFile(
      deps.fileMetaRecords.value,
      path,
      payload.colorIndex,
      payload.text,
    );
    deps.persistFileMeta();
  }

  async function onRemoveHighlightTerm(payload: {
    /** 侧栏：按整组删除 */
    storedTerms?: string[];
    /** 阅读器选区：按单词从各组中剔除 */
    text?: string;
    scope?: "global" | "book";
    /** 编辑面板清空词组等内部路径跳过确认 */
    skipConfirm?: boolean;
  }) {
    if (!payload.skipConfirm) {
      const ok = await appConfirm("是否移除该高亮词？");
      if (!ok) return;
    }

    if (payload.storedTerms?.length) {
      const group = normalizeHighlightGroup(payload.storedTerms);
      if (!group) return;
      if (payload.scope === "global") {
        deps.highlightWordsByIndexGlobal.value = removeHighlightGroupFromMap(
          deps.highlightWordsByIndexGlobal.value,
          group,
        );
        deps.persistSettings();
        return;
      }
      const path = deps.currentFile.value;
      if (!path) return;
      deps.fileMetaRecords.value = removeHighlightGroupFromFile(
        deps.fileMetaRecords.value,
        path,
        group,
      );
      deps.persistFileMeta();
      return;
    }

    const term = payload.text?.trim();
    if (!term) return;
    if (payload.scope === "global") {
      deps.highlightWordsByIndexGlobal.value = removeHighlightTermFromMap(
        deps.highlightWordsByIndexGlobal.value,
        term,
      );
      deps.persistSettings();
      return;
    }
    const path = deps.currentFile.value;
    if (!path) return;
    deps.fileMetaRecords.value = removeHighlightTermFromFile(
      deps.fileMetaRecords.value,
      path,
      term,
    );
    deps.persistFileMeta();
  }

  function onFavoriteHighlightTerm(payload: {
    storedTerms: string[];
    colorIndex: number;
  }) {
    const path = deps.currentFile.value;
    const group = normalizeHighlightGroup(payload.storedTerms);
    if (!path || !group) return;
    deps.fileMetaRecords.value = removeHighlightGroupFromFile(
      deps.fileMetaRecords.value,
      path,
      group,
    );
    deps.highlightWordsByIndexGlobal.value = upsertHighlightGroupInMap(
      deps.highlightWordsByIndexGlobal.value,
      payload.colorIndex,
      group,
    );
    deps.persistFileMeta();
    deps.persistSettings();
  }

  function onUnfavoriteHighlightTerm(payload: {
    storedTerms: string[];
    colorIndex: number;
  }) {
    const group = normalizeHighlightGroup(payload.storedTerms);
    if (!group) return;
    deps.highlightWordsByIndexGlobal.value = removeHighlightGroupFromMap(
      deps.highlightWordsByIndexGlobal.value,
      group,
    );
    const path = deps.currentFile.value;
    const bookHas = groupExistsInHighlightMap(
      currentFileHighlightWords.value,
      group,
    );
    if (!bookHas && path) {
      deps.fileMetaRecords.value = upsertHighlightGroupForFile(
        deps.fileMetaRecords.value,
        path,
        payload.colorIndex,
        group,
      );
      deps.persistFileMeta();
    }
    deps.persistSettings();
  }

  function persistScopeMap(
    scope: "global" | "book",
    next: HighlightWordsByIndex | undefined,
  ) {
    if (scope === "global") {
      deps.highlightWordsByIndexGlobal.value = next;
      deps.persistSettings();
      return;
    }
    const path = deps.currentFile.value;
    if (!path) return;
    deps.fileMetaRecords.value = upsertFileMetaRecord(
      deps.fileMetaRecords.value,
      path,
      () => ({ highlightWordsByIndex: next }),
    );
    deps.persistFileMeta();
  }

  function mapForScope(scope: "global" | "book"): HighlightWordsByIndex | undefined {
    if (scope === "global") return deps.highlightWordsByIndexGlobal.value;
    return currentFileHighlightWords.value;
  }

  /** 从某 scope 剔除若干词（多词组收缩；可整组或单词语） */
  function stripTermsFromScope(
    scope: "global" | "book",
    terms: readonly string[],
  ) {
    let map = mapForScope(scope);
    for (const t of terms) {
      map = removeHighlightTermFromMap(map, t);
    }
    persistScopeMap(scope, map);
  }

  /**
   * 拖放合并：颜色与 scope 以 target 为准。
   * `source.storedTerms` 可为整组或单个词。
   */
  function onMergeHighlightGroups(payload: {
    source: { storedTerms: string[]; scope: "global" | "book" };
    target: {
      storedTerms: string[];
      scope: "global" | "book";
      colorIndex: number;
    };
  }) {
    const source = normalizeHighlightGroup(payload.source.storedTerms);
    const target = normalizeHighlightGroup(payload.target.storedTerms);
    if (!source || !target) return;
    // 拖到自身整组，或单词语已在目标组内
    if (highlightGroupsEqual(source, target)) return;
    if (source.every((t) => target.includes(t))) return;

    const merged = normalizeHighlightGroup([...target, ...source]);
    if (!merged) return;

    if (payload.source.scope === payload.target.scope) {
      const next = mergeHighlightGroupsInMap(
        mapForScope(payload.target.scope),
        source,
        target,
        payload.target.colorIndex,
      );
      persistScopeMap(payload.target.scope, next);
      return;
    }

    // 跨 scope：从 source 剔除被拖词语，再写入 target
    stripTermsFromScope(payload.source.scope, source);

    if (payload.target.scope === "global") {
      deps.highlightWordsByIndexGlobal.value = upsertHighlightGroupInMap(
        deps.highlightWordsByIndexGlobal.value,
        payload.target.colorIndex,
        merged,
        { replaceStoredTerms: target },
      );
      deps.persistSettings();
    } else {
      const path = deps.currentFile.value;
      if (!path) return;
      deps.fileMetaRecords.value = upsertHighlightGroupForFile(
        deps.fileMetaRecords.value,
        path,
        payload.target.colorIndex,
        merged,
        target,
      );
      deps.persistFileMeta();
    }
  }

  /** 从多词组拆出一词为独立项（同色同 scope） */
  function onSplitHighlightTerm(payload: {
    storedTerms: string[];
    scope: "global" | "book";
    colorIndex: number;
    term: string;
  }) {
    const next = splitTermFromHighlightGroupInMap(
      mapForScope(payload.scope),
      payload.storedTerms,
      payload.term,
      payload.colorIndex,
    );
    persistScopeMap(payload.scope, next);
  }

  /** 添加词组（本书）或编辑词组（按 scope） */
  function onCommitHighlightGroup(payload: {
    mode: "add" | "edit";
    scope: "global" | "book";
    colorIndex: number;
    terms: string[];
    /** 编辑时替换的原词组 */
    replaceStoredTerms?: string[];
  }) {
    const group = normalizeHighlightGroup(payload.terms);
    if (payload.mode === "add") {
      if (!group) return;
      const path = deps.currentFile.value;
      if (!path) return;
      deps.fileMetaRecords.value = upsertHighlightGroupForFile(
        deps.fileMetaRecords.value,
        path,
        payload.colorIndex,
        group,
      );
      deps.persistFileMeta();
      return;
    }

    // edit
    if (!group) {
      if (payload.replaceStoredTerms?.length) {
        void onRemoveHighlightTerm({
          storedTerms: payload.replaceStoredTerms,
          scope: payload.scope,
          skipConfirm: true,
        });
      }
      return;
    }

    if (payload.scope === "global") {
      deps.highlightWordsByIndexGlobal.value = upsertHighlightGroupInMap(
        deps.highlightWordsByIndexGlobal.value,
        payload.colorIndex,
        group,
        payload.replaceStoredTerms
          ? { replaceStoredTerms: payload.replaceStoredTerms }
          : undefined,
      );
      deps.persistSettings();
      return;
    }
    const path = deps.currentFile.value;
    if (!path) return;
    deps.fileMetaRecords.value = upsertHighlightGroupForFile(
      deps.fileMetaRecords.value,
      path,
      payload.colorIndex,
      group,
      payload.replaceStoredTerms,
    );
    deps.persistFileMeta();
  }

  async function clearCurrentFileHighlightTerms() {
    const path = deps.currentFile.value;
    if (!path) return;
    const r = await window.colorTxt.showMessageBox({
      type: "warning",
      title: APP_DISPLAY_NAME,
      buttons: ["取消", "清空"],
      defaultId: 1,
      cancelId: 0,
      message: "是否要清空当前文件的所有本书高亮词？",
      detail: "此操作不可逆！",
      noLink: true,
    });
    if (r.response !== 1) return;
    deps.fileMetaRecords.value = upsertFileMetaRecord(
      deps.fileMetaRecords.value,
      path,
      () => ({ highlightWordsByIndex: undefined }),
    );
    deps.persistFileMeta();
  }

  async function onExportBookHighlightsJson() {
    const path = deps.currentFile.value;
    const map = currentFileHighlightWords.value;
    if (!path || !map) return;
    const {
      buildHighlightExportDefaultName,
      buildReaderHighlightsExportJson,
      countHighlightWordsInMap,
      saveHighlightExportFile,
    } = await import("../utils/readerHighlightExport");
    if (countHighlightWordsInMap(map) <= 0) return;
    const name = buildHighlightExportDefaultName(fileNameKey(path));
    const data = buildReaderHighlightsExportJson(map);
    const r = await saveHighlightExportFile(name, data);
    if (!r.ok && "error" in r) await appAlert(r.error);
  }

  async function onImportBookHighlightsJson() {
    const path = deps.currentFile.value;
    if (!path) return;
    const {
      countHighlightWordsInMap,
      mergeImportedHighlightWords,
      parseReaderHighlightsExportJson,
      pickAndReadHighlightJsonFile,
    } = await import("../utils/readerHighlightExport");
    const picked = await pickAndReadHighlightJsonFile("导入本书高亮词（JSON）");
    if (!picked.ok) {
      if ("error" in picked) await appAlert(picked.error);
      return;
    }
    const envelope = parseReaderHighlightsExportJson(picked.text);
    if (!envelope) {
      await appAlert("无效的高亮词 JSON 文件");
      return;
    }
    const imported = envelope.highlightWordsByIndex;
    const merged = mergeImportedHighlightWords(
      currentFileHighlightWords.value,
      imported,
    );
    deps.fileMetaRecords.value = upsertFileMetaRecord(
      deps.fileMetaRecords.value,
      path,
      () => ({ highlightWordsByIndex: merged }),
    );
    deps.persistFileMeta();
    appToast(`已导入 ${countHighlightWordsInMap(imported)} 个高亮词到本书`, {
      kind: "success",
    });
  }

  async function onExportFavoriteHighlightsJson() {
    const map = deps.highlightWordsByIndexGlobal.value;
    if (!map) return;
    const {
      FAVORITE_HIGHLIGHTS_EXPORT_DEFAULT_NAME,
      buildReaderHighlightsExportJson,
      countHighlightWordsInMap,
      saveHighlightExportFile,
    } = await import("../utils/readerHighlightExport");
    if (countHighlightWordsInMap(map) <= 0) return;
    const data = buildReaderHighlightsExportJson(map);
    const r = await saveHighlightExportFile(
      FAVORITE_HIGHLIGHTS_EXPORT_DEFAULT_NAME,
      data,
    );
    if (!r.ok && "error" in r) await appAlert(r.error);
  }

  async function onImportFavoriteHighlightsJson() {
    const {
      countHighlightWordsInMap,
      mergeImportedHighlightWords,
      parseReaderHighlightsExportJson,
      pickAndReadHighlightJsonFile,
    } = await import("../utils/readerHighlightExport");
    const picked = await pickAndReadHighlightJsonFile("导入收藏高亮词（JSON）");
    if (!picked.ok) {
      if ("error" in picked) await appAlert(picked.error);
      return;
    }
    const envelope = parseReaderHighlightsExportJson(picked.text);
    if (!envelope) {
      await appAlert("无效的高亮词 JSON 文件");
      return;
    }
    const imported = envelope.highlightWordsByIndex;
    deps.highlightWordsByIndexGlobal.value = mergeImportedHighlightWords(
      deps.highlightWordsByIndexGlobal.value,
      imported,
    );
    deps.persistSettings();
    appToast(`已导入 ${countHighlightWordsInMap(imported)} 个收藏高亮词`, {
      kind: "success",
    });
  }

  function onFindHighlightTermFromSidebar(payload: {
    query: string;
    useRegex: boolean;
  }) {
    if (
      !deps.currentFile.value ||
      deps.loading.value ||
      deps.totalLineCount.value <= 0
    )
      return;
    if (deps.isVoiceReadNavigationBlocked.value) return;
    const q = payload.query.trim();
    if (!q) return;
    deps.ensurePinBeforeRevealFindWidget();
    const found = deps.readerRef.value?.jumpToNextInlineSearchMatch?.(q, {
      caseSensitive: false,
      wholeWord: false,
      useRegex: payload.useRegex,
      smooth: true,
    });
    deps.hasInlineSearchHighlight.value = found === true;
  }

  return {
    currentFileHighlightWords,
    mergedHighlightWordsForReader,
    readerDisplayHighlightWordsByIndex,
    readerDisplayHighlightWordsBookOnly,
    currentFileHighlightTerms,
    refreshReaderHighlightDisplayLayer,
    onAddHighlightTerm,
    onRemoveHighlightTerm,
    onFavoriteHighlightTerm,
    onUnfavoriteHighlightTerm,
    onCommitHighlightGroup,
    onMergeHighlightGroups,
    onSplitHighlightTerm,
    clearCurrentFileHighlightTerms,
    onExportBookHighlightsJson,
    onImportBookHighlightsJson,
    onExportFavoriteHighlightsJson,
    onImportFavoriteHighlightsJson,
    onFindHighlightTermFromSidebar,
  };
}
