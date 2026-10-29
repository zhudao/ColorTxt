import {
  formatPhysicalPlainTextForReader,
  type ReaderDisplayFormatOptions,
} from "../reader/readerDisplayPipeline";
import {
  defaultChapterTitleBlankMode,
  type ChapterTitleBlankMode,
} from "../constants/appUi";

/** 智能排版后置处理（压缩空行 / 行首缩进）所需的编辑上下文 */
export type SmartFormatPostProcessContext = {
  chapterMinCharCount: number;
  isMarkdown: boolean;
  preserveMarkdownSourceLines: boolean;
  preservePhysicalSourceLines: boolean;
};

export function buildSmartFormatPostProcessOptions(
  ctx: SmartFormatPostProcessContext,
  overrides: Partial<ReaderDisplayFormatOptions> = {},
): ReaderDisplayFormatOptions {
  return {
    compressBlankLines: false,
    compressBlankKeepOneBlank: false,
    chapterTitleBlankMode: defaultChapterTitleBlankMode,
    leadIndentFullWidth: false,
    minCharCount: ctx.chapterMinCharCount,
    isMarkdown: ctx.isMarkdown,
    preserveMarkdownSourceLines: ctx.preserveMarkdownSourceLines,
    preservePhysicalSourceLines: ctx.preservePhysicalSourceLines,
    ...overrides,
  };
}

export function compressBlankLinesInText(
  plain: string,
  ctx: SmartFormatPostProcessContext,
  keepOneBlank: boolean,
  chapterTitleBlankMode: ChapterTitleBlankMode = defaultChapterTitleBlankMode,
): string {
  return formatPhysicalPlainTextForReader(
    plain,
    buildSmartFormatPostProcessOptions(ctx, {
      compressBlankLines: true,
      compressBlankKeepOneBlank: keepOneBlank,
      chapterTitleBlankMode,
    }),
  ).text;
}

export function leadIndentFullWidthInText(
  plain: string,
  ctx: SmartFormatPostProcessContext,
): string {
  return formatPhysicalPlainTextForReader(
    plain,
    buildSmartFormatPostProcessOptions(ctx, { leadIndentFullWidth: true }),
  ).text;
}

export function applySmartFormatPostProcessToText(
  text: string,
  settings: Pick<
    import("@shared/aiSmartFormatTypes").AiSmartFormatSettings,
    "autoCompressBlank" | "autoLeadIndent"
  >,
  ctx: SmartFormatPostProcessContext,
  keepOneBlank: boolean,
  chapterTitleBlankMode: ChapterTitleBlankMode = defaultChapterTitleBlankMode,
): string {
  let result = text;
  if (settings.autoCompressBlank) {
    result = compressBlankLinesInText(
      result,
      ctx,
      keepOneBlank,
      chapterTitleBlankMode,
    );
  }
  if (settings.autoLeadIndent) {
    result = leadIndentFullWidthInText(result, ctx);
  }
  return result;
}
