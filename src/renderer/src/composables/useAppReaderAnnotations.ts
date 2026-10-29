import { computed, ref, watch, type Ref } from "vue";
import type { Chapter } from "../chapter";
import type ReaderMain from "../components/ReaderMain.vue";
import { APP_DISPLAY_NAME } from "../constants/appUi";
import { appAlert, appConfirm } from "../services/appDialog";
import { appToast } from "../services/appToast";
import {
  annotationColumnMapOptions,
  buildAnnotationListRows,
  groupAnnotationListRowsByChapter,
  mergeImportedAnnotations,
  normalizeReaderAnnotations,
  revalidateAnnotations,
  refreshAnnotationDisplayTexts,
  resolveAnnotationDisplayQuote,
  type AnnotationDisplayQuoteContext,
} from "../utils/readerAnnotations";
import {
  clearReaderAnnotationsForFile,
  fileNameKey,
  findFileMetaRecord,
  removeReaderAnnotationForFile,
  setReaderAnnotationsForFile,
  upsertReaderAnnotationForFile,
  type FileMetaRecord,
  type ReaderAnnotationRecord,
} from "../stores/fileMetaStore";
import type { useTxtStreamPipeline } from "./useTxtStreamPipeline";

type ReaderRef = Ref<InstanceType<typeof ReaderMain> | null>;
type Stream = ReturnType<typeof useTxtStreamPipeline>;

/**
 * 阅读标注：列表分组、CRUD / 导入导出、失效重检与展示文案刷新。
 */
export function useAppReaderAnnotations(deps: {
  readerRef: ReaderRef;
  stream: Stream;
  currentFile: Ref<string | null>;
  readerEditMode: Ref<boolean>;
  fileMetaRecords: Ref<FileMetaRecord[]>;
  chapters: Ref<readonly Chapter[]>;
  leadIndentFullWidth: Ref<boolean>;
  textConvertZh: Ref<unknown>;
  textConvertLetter: Ref<unknown>;
  textConvertDigit: Ref<unknown>;
  compressBlankLines: Ref<boolean>;
  persistFileMeta: () => void;
  isVoiceReadNavigationBlocked: Ref<boolean>;
  ensurePinBeforeRevealFindWidget: () => void;
}) {
  const currentFileAnnotations = computed(
    () => {
      const path = deps.currentFile.value;
      if (!path) return [];
      return (
        findFileMetaRecord(deps.fileMetaRecords.value, path)
          ?.readerAnnotations ?? []
      );
    },
  );

  function physicalLineToDisplayForAnnotation(physicalLine: number): number {
    return deps.readerEditMode.value
      ? Math.max(1, Math.floor(physicalLine))
      : deps.stream.physicalLineToDisplayForReader(physicalLine);
  }

  function annotationDisplayQuoteContextForUi(): AnnotationDisplayQuoteContext {
    return {
      readerEditMode: deps.readerEditMode.value,
      getDisplayLineContent: (line) =>
        deps.stream.getDisplayLineContent(line),
      getPhysicalLineContent: (line) =>
        deps.stream.getPhysicalLineContent(line),
      physicalToDisplay: physicalLineToDisplayForAnnotation,
      columnMap: annotationColumnMapOptions({
        readerEditMode: deps.readerEditMode.value,
        leadIndentFullWidth: deps.leadIndentFullWidth.value,
      }),
      monacoModel: deps.readerEditMode.value
        ? null
        : (deps.readerRef.value?.getModel?.() ?? null),
      hitsByLine: deps.readerRef.value?.getAnnotationHitsByLine?.(),
    };
  }

  function resolveAnnotationQuoteForUi(ann: ReaderAnnotationRecord): string {
    return resolveAnnotationDisplayQuote(
      ann,
      annotationDisplayQuoteContextForUi(),
    );
  }

  const annotationDisplayEpoch = ref(0);

  function bumpAnnotationDisplayEpoch() {
    annotationDisplayEpoch.value += 1;
  }

  const annotationListRows = computed(() => {
    void annotationDisplayEpoch.value;
    return buildAnnotationListRows(
      currentFileAnnotations.value,
      resolveAnnotationQuoteForUi,
    );
  });

  const annotationListGroups = computed(() =>
    groupAnnotationListRowsByChapter(
      annotationListRows.value,
      deps.chapters.value,
      physicalLineToDisplayForAnnotation,
    ),
  );

  watch(
    [
      () => deps.textConvertZh.value,
      () => deps.textConvertLetter.value,
      () => deps.textConvertDigit.value,
      deps.compressBlankLines,
      deps.leadIndentFullWidth,
      deps.readerEditMode,
    ],
    bumpAnnotationDisplayEpoch,
  );

  function annotationDisplayLayerOptions():
    | {
        getDisplayLineContent: (displayLine: number) => string;
        displayToPhysical: (displayLine: number) => number;
        physicalToDisplay: (physicalLine: number) => number;
      }
    | undefined {
    if (deps.readerEditMode.value) return undefined;
    return {
      getDisplayLineContent: (line) =>
        deps.stream.getDisplayLineContent(line),
      displayToPhysical: (line) =>
        deps.stream.viewportDisplayLineToPhysicalLine(line),
      physicalToDisplay: (n) =>
        deps.stream.physicalLineToDisplayForReader(n),
    };
  }

  function revalidateCurrentFileAnnotations() {
    const path = deps.currentFile.value;
    if (!path) return;
    const anns = currentFileAnnotations.value;
    if (anns.length === 0) return;
    const validated = revalidateAnnotations(
      (line) => deps.stream.getPhysicalLineContent(line),
      () => deps.stream.getPhysicalLineCount(),
      anns,
      annotationDisplayLayerOptions(),
    );
    const changed = validated.some((a, i) => {
      const prev = anns[i];
      if (!prev) return true;
      return (
        !!a.stale !== !!prev.stale ||
        a.startColumn !== prev.startColumn ||
        a.endColumn !== prev.endColumn ||
        a.startPhysicalLine !== prev.startPhysicalLine ||
        a.endPhysicalLine !== prev.endPhysicalLine ||
        a.startDisplayLine !== prev.startDisplayLine ||
        a.endDisplayLine !== prev.endDisplayLine
      );
    });
    if (!changed) return;
    deps.fileMetaRecords.value = setReaderAnnotationsForFile(
      deps.fileMetaRecords.value,
      path,
      validated,
    );
    deps.persistFileMeta();
  }

  function refreshCurrentFileAnnotationDisplayTexts() {
    const path = deps.currentFile.value;
    if (!path || deps.readerEditMode.value) return;
    const anns = currentFileAnnotations.value;
    if (anns.length === 0) return;
    const refreshed = refreshAnnotationDisplayTexts(
      anns,
      annotationDisplayQuoteContextForUi(),
    );
    const changed = refreshed.some(
      (a, i) => a.displayText !== anns[i]?.displayText,
    );
    if (!changed) return;
    deps.fileMetaRecords.value = setReaderAnnotationsForFile(
      deps.fileMetaRecords.value,
      path,
      refreshed,
    );
    deps.persistFileMeta();
  }

  function onUpsertReaderAnnotation(annotation: ReaderAnnotationRecord) {
    const path = deps.currentFile.value;
    if (!path) return;
    deps.fileMetaRecords.value = upsertReaderAnnotationForFile(
      deps.fileMetaRecords.value,
      path,
      annotation,
    );
    deps.persistFileMeta();
  }

  function onRemoveReaderAnnotation(id: string) {
    const path = deps.currentFile.value;
    if (!path) return;
    deps.fileMetaRecords.value = removeReaderAnnotationForFile(
      deps.fileMetaRecords.value,
      path,
      id,
    );
    deps.persistFileMeta();
  }

  function onClearStaleReaderAnnotations() {
    const path = deps.currentFile.value;
    if (!path) return;
    const next = currentFileAnnotations.value.filter((ann) => !ann.stale);
    if (next.length === currentFileAnnotations.value.length) return;
    deps.fileMetaRecords.value = setReaderAnnotationsForFile(
      deps.fileMetaRecords.value,
      path,
      next,
    );
    deps.persistFileMeta();
  }

  function onClearReaderAnnotations() {
    const path = deps.currentFile.value;
    if (!path) return;
    deps.fileMetaRecords.value = clearReaderAnnotationsForFile(
      deps.fileMetaRecords.value,
      path,
    );
    deps.persistFileMeta();
  }

  function onJumpToReaderAnnotation(ann: ReaderAnnotationRecord) {
    if (deps.isVoiceReadNavigationBlocked.value) return;
    deps.ensurePinBeforeRevealFindWidget();
    deps.readerRef.value?.jumpToAnnotationRange?.(ann, { smooth: true });
  }

  async function onClearReaderAnnotationsWithConfirm() {
    const path = deps.currentFile.value;
    if (!path || currentFileAnnotations.value.length === 0) return;
    if (!window.colorTxt) return;
    const r = await window.colorTxt.showMessageBox({
      type: "warning",
      title: APP_DISPLAY_NAME,
      buttons: ["取消", "清空"],
      defaultId: 1,
      cancelId: 0,
      message: "确定要清空当前文件的全部标注与笔记吗？",
      detail: "此操作不可逆！",
      noLink: true,
    });
    if (r.response !== 1) return;
    onClearReaderAnnotations();
  }

  async function onExportAnnotationsMd() {
    const path = deps.currentFile.value;
    if (!path || currentFileAnnotations.value.length === 0) return;
    const {
      buildAnnotationExportDefaultName,
      buildReaderAnnotationsExportMarkdown,
      saveAnnotationExportFile,
    } = await import("../utils/readerAnnotationExport");
    const name = buildAnnotationExportDefaultName(fileNameKey(path), "md");
    const data = buildReaderAnnotationsExportMarkdown(
      fileNameKey(path),
      currentFileAnnotations.value,
      {
        chapters: deps.chapters.value,
        physicalLineToDisplayLine: physicalLineToDisplayForAnnotation,
        resolveQuoteText: deps.readerEditMode.value
          ? undefined
          : resolveAnnotationQuoteForUi,
      },
    );
    const r = await saveAnnotationExportFile(name, data, "md");
    if (!r.ok && "error" in r) await appAlert(r.error);
  }

  async function onExportAnnotationsJson() {
    const path = deps.currentFile.value;
    if (!path || currentFileAnnotations.value.length === 0) return;
    const {
      buildAnnotationExportDefaultName,
      buildReaderAnnotationsExportJson,
      saveAnnotationExportFile,
    } = await import("../utils/readerAnnotationExport");
    const name = buildAnnotationExportDefaultName(fileNameKey(path), "json");
    const data = buildReaderAnnotationsExportJson(
      path,
      fileNameKey(path),
      currentFileAnnotations.value,
    );
    const r = await saveAnnotationExportFile(name, data, "json");
    if (!r.ok && "error" in r) await appAlert(r.error);
  }

  async function onImportAnnotationsJson() {
    const path = deps.currentFile.value;
    if (!path) return;
    const {
      parseReaderAnnotationsExportJson,
      pickAndReadJsonFile,
    } = await import("../utils/readerAnnotationExport");
    const picked = await pickAndReadJsonFile();
    if (!picked.ok) {
      if ("error" in picked) await appAlert(picked.error);
      return;
    }
    const envelope = parseReaderAnnotationsExportJson(picked.text);
    if (!envelope) {
      await appAlert("无效的笔记 JSON 文件");
      return;
    }
    if (
      envelope.bookPath.replace(/\\/g, "/").toLowerCase() !==
      path.replace(/\\/g, "/").toLowerCase()
    ) {
      const ok = await appConfirm("该文件来自其他书籍，仍导入到当前书？");
      if (!ok) return;
    }
    const imported = normalizeReaderAnnotations(envelope.annotations);
    const merged = mergeImportedAnnotations(
      currentFileAnnotations.value,
      imported,
    );
    const validated = revalidateAnnotations(
      (line) => deps.stream.getPhysicalLineContent(line),
      () => deps.stream.getPhysicalLineCount(),
      merged,
      annotationDisplayLayerOptions(),
    );
    const refreshed = refreshAnnotationDisplayTexts(
      validated,
      annotationDisplayQuoteContextForUi(),
    );
    bumpAnnotationDisplayEpoch();
    deps.fileMetaRecords.value = setReaderAnnotationsForFile(
      deps.fileMetaRecords.value,
      path,
      refreshed,
    );
    deps.persistFileMeta();
    const staleN = refreshed.filter((a) => a.stale).length;
    appToast(
      `导入 ${imported.length} 条${staleN > 0 ? `，${staleN} 条已失效` : ""}`,
      { kind: "success" },
    );
  }

  return {
    currentFileAnnotations,
    annotationListGroups,
    bumpAnnotationDisplayEpoch,
    revalidateCurrentFileAnnotations,
    refreshCurrentFileAnnotationDisplayTexts,
    onUpsertReaderAnnotation,
    onRemoveReaderAnnotation,
    onClearStaleReaderAnnotations,
    onClearReaderAnnotations,
    onJumpToReaderAnnotation,
    onClearReaderAnnotationsWithConfirm,
    onExportAnnotationsMd,
    onExportAnnotationsJson,
    onImportAnnotationsJson,
  };
}
