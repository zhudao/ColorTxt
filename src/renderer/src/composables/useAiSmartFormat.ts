import { onMounted, onUnmounted, ref, type Ref } from "vue";
import type { AITokenPricePerMillion } from "@shared/aiTypes";
import {
  addTokenUsage,
  ZERO_TOKEN_USAGE,
  type AITokenUsageTotals,
} from "@shared/aiTokenUsage";
import type ReaderMain from "../components/ReaderMain.vue";
import {
  aiSmartFormatNeedsLlm,
  type AiSmartFormatSettings,
} from "@shared/aiSmartFormatTypes";
import {
  revertDeDiDeParticleSubstitutions,
  tryRecoverFormatOutputScope,
  validateFormatOutputPreserved,
} from "@shared/formatOutputValidation";
import { prepareTextForAiFormat } from "../reader/readerTextInputHygiene";
import { cleanHtmlRemnantsInText } from "@shared/htmlRemnantCleanup";
import {
  applySegmentTextToWorkingLines,
  extractSegmentTextFromWorkingLines,
  lineDeltaAfterReplace,
  planFullTextSegments,
  planSelectionSegments,
  type SmartFormatSegmentPlan,
} from "../aiSmartFormat/aiSmartFormatSegments";
import {
  applySmartFormatPostProcessToText,
  type SmartFormatPostProcessContext,
} from "../aiSmartFormat/aiSmartFormatTextPostProcess";
import type { ChapterTitleBlankMode } from "../constants/appUi";
import type { SmartFormatReviewSession } from "../aiSmartFormat/aiSmartFormatReviewTypes";
import type { Chapter } from "../chapter";
import {
  SMART_FORMAT_DISCARD_CONFIRM_MESSAGE,
  SMART_FORMAT_DISCARD_CONFIRM_TITLE,
} from "../aiSmartFormat/smartFormatDiscardConfirm";
import { appAlert, appConfirm } from "../services/appDialog";
import { appToast } from "../services/appToast";
import { isRetryableAiRequestError } from "@shared/aiRequestRetry";
import {
  resolveSmartFormatSkillPrompt,
  type AiSkillUserOverride,
} from "@shared/aiSkills";
export type AiSmartFormatScope = "full" | "selection";
let smartFormatRequestIdSeq = 1;
export function useAiSmartFormat(deps: {
  readerRef: Ref<InstanceType<typeof ReaderMain> | null>;
  chapters: Ref<readonly Chapter[]>;
  aiSmartFormat: Ref<AiSmartFormatSettings>;
  aiFeaturesEnabled: Ref<boolean>;
  aiSkillOverrides: Ref<Record<string, AiSkillUserOverride>>;
  compressBlankKeepOneBlank: Ref<boolean>;
  chapterTitleBlankMode: Ref<ChapterTitleBlankMode>;
  runEditFormatWithChapterSync: (
    format: () => Promise<boolean | undefined> | boolean | undefined,
  ) => Promise<void>;
  onReaderEditDirty: () => void;
  resyncMirrorFromReader: () => void;
}) {
  const running = ref(false);
  const progressOpen = ref(false);
  const progressLabel = ref("");
  const progressCurrent = ref(0);
  const progressTotal = ref(0);
  const progressShowTokenUsage = ref(false);
  const progressTokenUsage = ref<AITokenUsageTotals>({ ...ZERO_TOKEN_USAGE });
  const progressTokenUsageAvailable = ref(false);
  const progressTokenPricePerMillion = ref<AITokenPricePerMillion | null>(
    null,
  );
  const reviewOpen = ref(false);
  const reviewSession = ref<SmartFormatReviewSession | null>(null);
  let abortAc: AbortController | null = null;
  let activeRequestId = 0;
  let unsubProgress: (() => void) | null = null;
  onMounted(() => {
    unsubProgress = window.colorTxt.ai.onTextFormatProgress((ev) => {
      if (ev.requestId !== activeRequestId || !running.value) return;
      if (
        ev.retryAttempt != null &&
        ev.maxRetries != null &&
        ev.retryAttempt > 0
      ) {
        const base = progressLabel.value.replace(/，重试 \d+\/\d+$/, "");
        progressLabel.value = `${base}，重试 ${ev.retryAttempt}/${ev.maxRetries}`;
      }
    });
  });
  onUnmounted(() => {
    unsubProgress?.();
    unsubProgress = null;
  });
  function canUseSmartFormat(): boolean {
    if (!deps.aiFeaturesEnabled.value) return false;
    const s = deps.aiSmartFormat.value;
    return (
      s.mergeHardWrap ||
      s.fixPunctuation ||
      s.unifyDialogueQuotes !== "none" ||
      s.removePromotionalContent ||
      s.removePiracyWatermarks ||
      s.restoreGarbledChars ||
      s.restoreAsteriskMasks ||
      s.cleanHtmlRemnants ||
      s.autoCompressBlank ||
      s.autoLeadIndent
    );
  }
  function canUseSmartFormatLlm(): boolean {
    return (
      deps.aiFeaturesEnabled.value &&
      aiSmartFormatNeedsLlm(deps.aiSmartFormat.value)
    );
  }
  function readPostProcessContext(): SmartFormatPostProcessContext {
    const reader = deps.readerRef.value;
    return (
      reader?.getSmartFormatPostProcessContext?.() ?? {
        chapterMinCharCount: 0,
        isMarkdown: false,
        preserveMarkdownSourceLines: false,
        preservePhysicalSourceLines: false,
      }
    );
  }
  function readLinesFromModel(
    startLine: number,
    endLine: number,
  ): { text: string; contextBefore: string; contextAfter: string } {
    const reader = deps.readerRef.value;
    if (!reader) return { text: "", contextBefore: "", contextAfter: "" };
    const lc = reader.getModelLineCount?.() ?? 0;
    const parts: string[] = [];
    for (let ln = startLine; ln <= endLine && ln <= lc; ln++) {
      parts.push(reader.getEditorLineContent(ln));
    }
    const text = parts.join("\n");
    const beforeParts: string[] = [];
    for (let ln = Math.max(1, startLine - 2); ln < startLine; ln++) {
      beforeParts.push(reader.getEditorLineContent(ln));
    }
    const afterParts: string[] = [];
    for (let ln = endLine + 1; ln <= Math.min(lc, endLine + 2); ln++) {
      afterParts.push(reader.getEditorLineContent(ln));
    }
    return {
      text,
      contextBefore: beforeParts.join("\n"),
      contextAfter: afterParts.join("\n"),
    };
  }
  function resetProgressTokenUsage() {
    progressShowTokenUsage.value = false;
    progressTokenUsage.value = { ...ZERO_TOKEN_USAGE };
    progressTokenUsageAvailable.value = false;
    progressTokenPricePerMillion.value = null;
  }
  function recordSegmentTokenUsage(result: {
    tokenUsage?: AITokenUsageTotals;
    tokenUsageAvailable?: boolean;
  }) {
    if (result.tokenUsage) {
      progressTokenUsage.value = addTokenUsage(
        progressTokenUsage.value,
        result.tokenUsage,
      );
    }
    if (result.tokenUsageAvailable) {
      progressTokenUsageAvailable.value = true;
    }
  }
  function unlockSmartFormatRunning() {
    const reader = deps.readerRef.value;
    reader?.setSmartFormatRunning?.(false);
    running.value = false;
  }
  function openReview(session: SmartFormatReviewSession) {
    reviewSession.value = session;
    reviewOpen.value = true;
  }
  function closeReview() {
    reviewOpen.value = false;
    reviewSession.value = null;
    unlockSmartFormatRunning();
  }
  function finishWithProposedReview(
    scope: AiSmartFormatScope,
    rangeStart: number,
    rangeEnd: number,
    originalText: string,
    proposedText: string,
    stats?: { applied: number; skipped: number; stopped?: boolean },
  ) {
    progressOpen.value = false;
    if (originalText === proposedText) {
      unlockSmartFormatRunning();
      appToast(
        stats?.stopped ? "已停止排版（无变更）" : "排版完成（无变更）",
        stats?.stopped ? { kind: "warning" } : { kind: "info" },
      );
      return;
    }
    openReview({
      startLine: rangeStart,
      endLine: rangeEnd,
      originalText,
      proposedText,
      scope,
    });
    if (stats) {
      const parts: string[] = [];
      if (stats.applied > 0) parts.push(`已处理 ${stats.applied} 段`);
      if (stats.skipped > 0) parts.push(`跳过 ${stats.skipped} 段`);
      const detail = parts.length > 0 ? `${parts.join("，")}，` : "";
      if (stats.stopped) {
        appToast(`已停止排版，${detail}请预览确认后应用`, { kind: "warning" });
      } else if (parts.length > 0) {
        appToast(`${parts.join("，")}，请预览确认后应用`, { kind: "primary" });
      }
    }
  }
  async function processOneSegmentInMemory(
    plan: SmartFormatSegmentPlan,
    workingLines: string[],
    rangeStart: number,
    lineDeltaAcc: { value: number },
    index: number,
    total: number,
    settings: AiSmartFormatSettings,
  ): Promise<
    | { ok: true; changed?: boolean; skipped?: boolean }
    | { ok: false; fatal: true; message: string }
    | { ok: false; fatal: false; cancelled: true }
  > {
    const reader = deps.readerRef.value;
    if (!reader) return { ok: false, fatal: true, message: "编辑器未就绪" };
    reader.revealSmartFormatSegment?.(plan.startLine, plan.endLine);
    const text = extractSegmentTextFromWorkingLines(
      workingLines,
      plan,
      rangeStart,
      lineDeltaAcc.value,
    );
    const { contextBefore, contextAfter } = readLinesFromModel(
      plan.startLine,
      plan.endLine,
    );
    let working = prepareTextForAiFormat(text);
    if (settings.cleanHtmlRemnants) {
      working = cleanHtmlRemnantsInText(working);
    }
    const baseline = working;
    if (!working.trim()) {
      if (total > 1) progressCurrent.value = index + 1;
      return { ok: true, skipped: true };
    }
    progressLabel.value =
      total > 1 ? `第 ${index + 1}/${total} 段` : "正在处理…";
    if (aiSmartFormatNeedsLlm(settings)) {
      const res = await window.colorTxt.ai.textFormatCleanup({
        requestId: activeRequestId,
        segment: {
          id: plan.id,
          text: baseline,
          contextBefore,
          contextAfter,
        },
        mergeHardWrap: settings.mergeHardWrap,
        fixPunctuation: settings.fixPunctuation,
        unifyDialogueQuotes: settings.unifyDialogueQuotes,
        removePromotionalContent: settings.removePromotionalContent,
        removePiracyWatermarks: settings.removePiracyWatermarks,
        restoreGarbledChars: settings.restoreGarbledChars,
        restoreAsteriskMasks: settings.restoreAsteriskMasks,
        cleanHtmlRemnants: settings.cleanHtmlRemnants,
        skillPrompt: resolveSmartFormatSkillPrompt(deps.aiSkillOverrides.value),
      });
      if (abortAc?.signal.aborted) {
        return { ok: false, fatal: false, cancelled: true };
      }
      if (!res.ok) {
        const msg = res.error ?? "请求失败";
        if (isRetryableAiRequestError(new Error(msg))) {
          return {
            ok: false,
            fatal: true,
            message: `第 ${index + 1}/${total} 段请求失败：${msg}`,
          };
        }
        return { ok: false, fatal: true, message: msg };
      }
      const result = res.result;
      recordSegmentTokenUsage(result);
      if (result.error) {
        return {
          ok: false,
          fatal: true,
          message: `第 ${index + 1}/${total} 段：${result.error}`,
        };
      }
      working = revertDeDiDeParticleSubstitutions(baseline, result.text);
      const validationOpts = {
        restoreGarbledChars: settings.restoreGarbledChars,
        restoreAsteriskMasks: settings.restoreAsteriskMasks,
        fixPunctuation: settings.fixPunctuation,
        unifyDialogueQuotes: settings.unifyDialogueQuotes,
        removePromotionalContent: settings.removePromotionalContent,
        removePiracyWatermarks: settings.removePiracyWatermarks,
      };
      const recovered = tryRecoverFormatOutputScope(
        baseline,
        working,
        validationOpts,
      );
      if (recovered.recovered) {
        working = recovered.text;
      }
      const validation = validateFormatOutputPreserved(
        baseline,
        working,
        validationOpts,
      );
      if (!validation.ok) {
        if (total > 1) progressCurrent.value = index + 1;
        return { ok: true, skipped: true };
      }
    }

    // 压缩空行/行首缩进仅在全文合并后执行（finalizeSmartFormatProposedText）。
    // 段内后置会在行内切块时把 keepOneBlank 补出的 \n 写回同一物理行，造成句中硬换行。
    let changed = false;
    if (working !== text) {
      applySegmentTextToWorkingLines(
        workingLines,
        plan,
        rangeStart,
        lineDeltaAcc.value,
        working,
      );
      lineDeltaAcc.value += lineDeltaAfterReplace(text, working);
      changed = true;
    }
    if (total > 1) progressCurrent.value = index + 1;
    return { ok: true, changed };
  }

  /**
   * 压缩空行 / 行首缩进仅在全文合并后做一次：
   * - 行内切块时段内后置会把 keepOneBlank 的换行写进半行片段，拼回后产生句中硬换行；
   * - 分段边界处的空行也须按全文规则统一处理。
   */
  function finalizeSmartFormatProposedText(
    text: string,
    settings: AiSmartFormatSettings,
  ): string {
    if (!settings.autoCompressBlank && !settings.autoLeadIndent) {
      return text;
    }
    return applySmartFormatPostProcessToText(
      text,
      settings,
      readPostProcessContext(),
      deps.compressBlankKeepOneBlank.value,
      deps.chapterTitleBlankMode.value,
    );
  }

  async function runSmartFormat(scope: AiSmartFormatScope): Promise<void> {
    if (running.value || reviewOpen.value) return;
    if (!canUseSmartFormat()) {
      appToast("请先在设置 → 编辑中启用 AI 智能排版选项", { kind: "info" });
      return;
    }
    const settings = { ...deps.aiSmartFormat.value };
    const needsLlm = aiSmartFormatNeedsLlm(settings);
    let chatMaxTokens: number | undefined;
    let chatTokenPricePerMillion: AITokenPricePerMillion | null = null;
    try {
      const aiConfig = await window.colorTxt.ai.configGet();
      chatMaxTokens = aiConfig.chat?.maxTokens;
      chatTokenPricePerMillion = aiConfig.chat?.tokenPricePerMillion ?? null;
      if (needsLlm) {
        if (!aiConfig.aiEnabled || !aiConfig.chat?.model?.trim()) {
          await appAlert("请先在设置中启用 AI 阅读助手并配置对话模型。");
          return;
        }
      }
    } catch {
      await appAlert("无法读取 AI 配置。");
      return;
    }
    const reader = deps.readerRef.value;
    if (!reader) return;
    const fullText = reader.getAllText?.() ?? "";
    const lineCount = reader.getModelLineCount?.() ?? 0;
    if (!fullText.trim()) {
      appToast("当前没有可排版的正文", { kind: "info" });
      return;
    }
    let plans: SmartFormatSegmentPlan[] = [];
    if (scope === "full") {
      plans = planFullTextSegments(
        lineCount,
        deps.chapters.value,
        fullText,
        chatMaxTokens,
      );
    } else {
      const range = reader.getSelectionRange?.();
      if (!range || range.isEmpty()) {
        appToast("请先选中要排版的文本", { kind: "info" });
        return;
      }
      plans = planSelectionSegments(
        fullText,
        range.startLineNumber,
        range.endLineNumber,
        chatMaxTokens,
      );
    }
    if (plans.length === 0) {
      appToast("无法切分排版范围", { kind: "info" });
      return;
    }
    const rangeStart = plans[0]!.startLine;
    const rangeEnd = plans[plans.length - 1]!.endLine;
    const originalText = readLinesFromModel(rangeStart, rangeEnd).text;
    resetProgressTokenUsage();
    running.value = true;
    progressOpen.value = true;
    reader.setSmartFormatRunning?.(true);
    progressCurrent.value = 0;
    progressTotal.value = plans.length;
    progressLabel.value = "准备中…";
    if (needsLlm) {
      progressShowTokenUsage.value = true;
      progressTokenPricePerMillion.value = chatTokenPricePerMillion;
    }
    activeRequestId = smartFormatRequestIdSeq++;
    abortAc = new AbortController();
    const workingLines = originalText.split("\n");
    const lineDeltaAcc = { value: 0 };
    let applied = 0;
    let skipped = 0;
    let lastAppliedSegmentIndex = -1;
    let cancelled = false;
    try {
      for (let i = 0; i < plans.length; i++) {
        if (abortAc.signal.aborted) {
          cancelled = true;
          break;
        }
        const outcome = await processOneSegmentInMemory(
          plans[i]!,
          workingLines,
          rangeStart,
          lineDeltaAcc,
          i,
          plans.length,
          settings,
        );
        if (!outcome.ok) {
          if ("cancelled" in outcome && outcome.cancelled) {
            cancelled = true;
            break;
          }
          if (outcome.fatal) {
            progressOpen.value = false;
            unlockSmartFormatRunning();
            await appAlert(
              `${outcome.message}\n\n，请检查网络后重新执行。`,
            );
            return;
          }
        } else if (outcome.skipped) {
          skipped += 1;
        } else if (outcome.changed) {
          applied += 1;
          lastAppliedSegmentIndex = i;
        }
      }
      if (cancelled) {
        progressOpen.value = false;
        if (applied === 0) {
          unlockSmartFormatRunning();
          appToast("已停止排版", { kind: "warning" });
          return;
        }
        const lastPlan = plans[lastAppliedSegmentIndex]!;
        const partialOriginal = readLinesFromModel(
          rangeStart,
          lastPlan.endLine,
        ).text;
        const endIdx = lastPlan.endLine - rangeStart + lineDeltaAcc.value;
        const partialProposed = finalizeSmartFormatProposedText(
          workingLines.slice(0, endIdx + 1).join("\n"),
          settings,
        );
        finishWithProposedReview(
          scope,
          rangeStart,
          lastPlan.endLine,
          partialOriginal,
          partialProposed,
          { applied, skipped, stopped: true },
        );
        return;
      }
      const proposedText = finalizeSmartFormatProposedText(
        workingLines.join("\n"),
        settings,
      );
      finishWithProposedReview(
        scope,
        rangeStart,
        rangeEnd,
        originalText,
        proposedText,
        { applied, skipped },
      );
    } finally {
      void window.colorTxt.ai.textFormatAbort(activeRequestId);
      abortAc = null;
    }
  }
  function stopSmartFormat() {
    abortAc?.abort();
    void window.colorTxt.ai.textFormatAbort(activeRequestId);
  }
  async function applySmartFormatReview() {
    const session = reviewSession.value;
    const reader = deps.readerRef.value;
    if (!session || !reader) return;
    const proposedText =
      reader.getSmartFormatReviewModifiedText?.() ?? session.proposedText;
    let patched = false;
    await deps.runEditFormatWithChapterSync(() => {
      patched =
        reader.applyEditLineRangePatch?.(
          session.startLine,
          session.endLine,
          proposedText,
        ) ?? false;
      if (patched) deps.onReaderEditDirty();
      return patched;
    });
    deps.resyncMirrorFromReader();
    closeReview();
    if (patched) {
      reader.focusSmartFormatAppliedRange?.(session.startLine, proposedText);
    }
    appToast("已应用排版结果", { kind: "success" });
  }
  async function discardSmartFormatReview() {
    const ok = await appConfirm(
      SMART_FORMAT_DISCARD_CONFIRM_MESSAGE,
      SMART_FORMAT_DISCARD_CONFIRM_TITLE,
    );
    if (!ok) return;
    closeReview();
    appToast("已放弃排版结果", { kind: "info" });
  }
  return {
    running,
    progressOpen,
    progressLabel,
    progressCurrent,
    progressTotal,
    progressShowTokenUsage,
    progressTokenUsage,
    progressTokenUsageAvailable,
    progressTokenPricePerMillion,
    reviewOpen,
    reviewSession,
    canUseSmartFormat,
    canUseSmartFormatLlm,
    runSmartFormat,
    stopSmartFormat,
    applySmartFormatReview,
    discardSmartFormatReview,
  };
}
