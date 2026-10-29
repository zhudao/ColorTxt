import { isVoiceReadEngineId } from "@shared/voiceReadEngines";
import type { ChapterMatchRule } from "../chapter";
import type {
  FileCategoryDefinition,
  FileListViewMode,
  FileSortMode,
} from "../constants/fileCategories";
import {
  isFileSortMode,
  parseFileCategoryCatalog,
  parseFileListViewMode,
} from "../constants/fileCategories";
import {
  migrateTxtFileListAddedAt,
  type TxtFileItem,
} from "../services/fileListService";
import {
  parseChapterTitleBlankMode,
  persistedSettingsChangedEvent,
  persistKey,
  type ChapterTitleBlankMode,
} from "../constants/appUi";
import {
  applyBaselineUpdates,
  mergeLocalPatchOntoDiskSettings,
  readPersistedMainSettingsObject,
} from "../services/settingsPersistMerge";

export type { TxtFileItem };
import {
  parseHighlightColorsArray,
  parseHighlightLastColor,
} from "../constants/highlightColors";
import { parseLineationColorsArray } from "../constants/lineationColors";
import { parseLineationLastColors } from "../constants/annotationColors";
import {
  normalizeHighlightWordsByIndex,
  type HighlightWordsByIndex,
} from "./fileMetaStore";
import {
  parseReaderPaletteColorEnabledOverridesFromPersisted,
  type ReaderSurfaceColorEnabled,
} from "../constants/readerPalette";
import {
  parseReaderBackgroundState,
  type ReaderBackgroundState,
} from "../constants/readerBackground";
import {
  migrateLegacyReaderPaletteOverrides,
  parseReaderPaletteSelectedId,
  parseReaderPaletteUserPresets,
  serializeReaderPaletteUserPresets,
  type ReaderPalettePreset,
} from "../constants/readerPalettePresets";
import type { ShortcutActionId } from "../services/shortcutRegistry";
import type { AiCustomSkill, AiSkillUserOverride } from "@shared/aiSkills";
import {
  mergeAiCustomSkills,
  mergeAiSkillOverrides,
  mergeAiSkillsEnabled,
} from "@shared/aiSkills";
import type { VoiceReadSettings } from "../constants/voiceRead";
import {
  mergeTimedScrollSettings,
  type TimedScrollSettings,
} from "../constants/timedScroll";
import {
  mergePomodoroSettings,
  type PomodoroSettings,
} from "../constants/pomodoro";
import {
  mergeSelectionToolbarButtons,
  type SelectionToolbarButtons,
} from "../constants/selectionToolbar";
import { mergeDictionarySettings } from "../constants/dictionarySettings";
import type { DictionarySettings } from "@shared/dictionaryTypes";
import { mergeWebSearchSettings } from "../constants/webSearchSettings";
import type { WebSearchSettings } from "@shared/webSearchTypes";
import {
  mergeTranslationSettings,
  stripTranslationSecretsForDisk,
} from "../constants/translationSettings";
import type { TranslationSettings } from "@shared/translationTypes";
import { normalizeCharacterCardTextureEffect } from "@shared/characterCardTextureEffects";
import { parseWordcloudAngleMode } from "../constants/wordcloudUi";
import { parseWordcloudPaletteId } from "../constants/wordcloudPalettes";

export type PersistedSettingsData = {
  theme?: "vs" | "vs-dark";
  /** 侧边栏宽度（px） */
  sidebarWidth?: number;
  /** 侧边栏是否打开（非全屏时） */
  showSidebar?: boolean;
  /** 极简视图（顶/侧/底栏默认隐藏） */
  isMinimalistView?: boolean;
  fontSize?: number;
  /** Monaco 行间距倍数（UI「行间距」），实际 lineHeight = round(fontSize * lineHeightMultiple) */
  lineHeightMultiple?: number;
  /** 每个物理行结束后的额外间距（px） */
  lineSpacingPx?: number;
  /** Monaco 字间距（px） */
  letterSpacingPx?: number;
  /** 阅读区正文左右边距（px） */
  readerHorizontalInsetPx?: number;
  fontFamily?: string;
  /** 阅读器字体弹框：钉在外层的「其他字体」名称列表 */
  pinnedOtherFonts?: string[];
  monacoCustomHighlight?: boolean;
  /** 与「内容上色」同时开启时：成对引号/括号是否允许跨行 */
  txtrDelimitedMatchCrossLine?: boolean;
  /** 是否在加载时过滤空行（仅空格/缩进也视为空行） */
  compressBlankLines?: boolean;
  /** 压缩空行时是否在每行（含章节标题）下方保留一行空行 */
  compressBlankKeepOneBlank?: boolean;
  /** 压缩空行时章节标题上下空行模式 */
  chapterTitleBlankMode?: ChapterTitleBlankMode;
  /** 是否为正文行统一行首两个全角空格（章节标题行与空行除外） */
  leadIndentFullWidth?: boolean;
  textConvertZh?: string;
  textConvertLetter?: string;
  textConvertDigit?: string;
  /** 章节列表是否显示每章字数 */
  showChapterCounts?: boolean;
  /** 章节列表与底栏总字数是否显示具体数值（如 `23,123 字`） */
  chapterCharCountExact?: boolean;
  chapterRules?: ChapterMatchRule[];
  /** 启动时是否从会话快照恢复上次文件与列表；关闭时关闭窗口不写入会话 */
  restoreSessionOnStartup?: boolean;
  /** 最近打开文件条数上限，0 表示不记录 */
  recentFilesHistoryLimit?: number;
  /** 小于该字数的章节不纳入章节列表与导航 */
  chapterMinCharCount?: number;
  /** Monaco 换行是否使用 advanced 策略（性能开销更大） */
  monacoAdvancedWrapping?: boolean;
  /** 简单换行下中文标点全角估算；高级换行开启时运行时停用 */
  monacoCjkWrapOptimize?: boolean;
  /** Monaco 阅读区平滑滚动（滚轮、程序性 setScrollTop/revealLine 等） */
  monacoSmoothScrolling?: boolean;
  /** 只读滚动条轨道行为：`disabled` | `page` | `jump` */
  scrollbarTrackBehavior?: import("../constants/appUi").ScrollbarTrackBehavior;
  /**
   * @deprecated 已由 `scrollbarTrackBehavior` 取代；读盘时迁移
   */
  disableScrollbarTrackJump?: boolean;
  /** Monaco 滚轮滚动倍率（`mouseWheelScrollSensitivity`） */
  mouseWheelScrollSensitivity?: number;
  /** Monaco 按住 Alt 时的滚轮加速倍率（`fastScrollSensitivity`） */
  fastScrollSensitivity?: number;
  /** 阅读区顶部粘性章节标题（Monaco stickyScroll） */
  stickyChapterTitleEnabled?: boolean;
  /** 阅读器点击翻页模式（false = 可选模式） */
  readerClickMode?: boolean;
  /** 阅读尺：聚焦视觉行、淡化其余行 */
  readingRulerEnabled?: boolean;
  /** 阅读尺聚焦视觉行数（1–10） */
  readingRulerFocusLines?: number;
  /** 阅读尺非聚焦行不透明度（0–1，步进 0.05） */
  readingRulerDimOpacity?: number;
  /** 阅读尺开启时是否淡化粘性章节标题 */
  readingRulerDimStickyTitle?: boolean;
  /** 阅读尺焦点行切换过渡动画 */
  readingRulerTransitionEnabled?: boolean;
  /** Markdown 块级插图 ViewZone 内容高度（px） */
  markdownImageHeightPx?: number;
  /** 阅读区底部「上一章 / 下一章」工具栏 */
  chapterNavToolbarEnabled?: boolean;
  /** 找书阅读器边界滚动切章 */
  findBookChapterAdvanceEnabled?: boolean;
  /** 编辑模式下是否显示行号 */
  readerEditShowLineNumbers?: boolean;
  /** 编辑模式下是否显示小地图 */
  readerEditMinimap?: boolean;
  /** 编辑模式下内容变更时是否自动刷新侧栏章节列表（超过行数上限时需手动刷新） */
  editAutoRefreshChapterList?: boolean;
  /** 编辑模式 AI 智能排版选项 */
  aiSmartFormat?: Partial<
    import("@shared/aiSmartFormatTypes").AiSmartFormatSettings
  >;
  /** 全屏时阅读区宽度（百分比） */
  fullscreenReaderWidthPercent?: number;
  /** 全屏时是否在左下角显示系统时间 */
  fullscreenShowSystemTime?: boolean;
  /** 定时滚动：范围与间隔 */
  timedScroll?: Partial<TimedScrollSettings>;
  /** 番茄时钟 */
  pomodoro?: Partial<PomodoroSettings>;
  /** 选区浮动工具条可选按钮显示 */
  selectionToolbarButtons?: Partial<SelectionToolbarButtons>;
  /** 词典（启用顺序、本地导入元数据、自定义网络） */
  dictionarySettings?: Partial<DictionarySettings>;
  /** 网络搜索引擎（右键菜单） */
  webSearchSettings?: Partial<WebSearchSettings>;
  /** 选区翻译（服务、目标语言等；不含密钥明文） */
  translationSettings?: Partial<TranslationSettings>;
  /** 用户自定义快捷键（动作ID -> accelerator） */
  shortcutBindings?: Partial<Record<ShortcutActionId, string>>;
  /** 阅读器 token 独立配色开关覆盖（亮暗共用，仅持久化 false） */
  readerPaletteColorEnabledOverrides?: Partial<ReaderSurfaceColorEnabled>;
  /** 用户添加的阅读器配色方案 */
  readerPaletteUserPresets?: ReaderPalettePreset[];
  /** 当前选中的阅读器配色方案 id（亮色） */
  readerPaletteSelectedIdLight?: string;
  /** 当前选中的阅读器配色方案 id（暗色） */
  readerPaletteSelectedIdDark?: string;
  /** 阅读区背景图图库（选图在配色色板 `textureId`） */
  readerBackground?: ReaderBackgroundState;
  /** 自定义高亮色（亮色主题），与默认逐项相同可不写入 */
  highlightColorsLight?: string[];
  /** 自定义高亮色（暗色主题） */
  highlightColorsDark?: string[];
  /** 划线标注色（亮色主题） */
  lineationColorsLight?: string[];
  /** 划线标注色（暗色主题） */
  lineationColorsDark?: string[];
  /** 已收藏（全书通用）高亮词，按高亮色索引分桶 */
  highlightWordsByIndexGlobal?: HighlightWordsByIndex;
  /** 划线（马克笔/波浪/直线）各自上次选用的 5 色索引 */
  lineationLastColors?: import("../constants/annotationColors").LineationLastColorPrefs;
  /** 选区工具条高亮词上次选用的色槽索引 */
  highlightLastColor?: number;
  /**
   * 电子书转换输出目录：空字符串表示与源书同目录。
   * 非空时为绝对路径。若设置 JSON 中无此键，应用默认使用 `userData/ConvertedTxt`。
   */
  ebookConvertOutputDir?: string;
  /**
   * 彩读书包解压目录（绝对路径）。
   * 空串或运行时未配置时使用 `userData/UnpackedBooks`。
   * 若设置 JSON 中无此键，首次启动写入默认路径。
   */
  bookPackUnpackDir?: string;
  /**
   * 彩读书包默认密码。
   * 空串表示导出不加密、导入明文 ZIP；非空时导出为 CTZE 加密包，导入需相同密码。
   */
  bookPackPassword?: string;
  /** 是否启用 WebDAV 同步入口（默认 false） */
  webDavEnabled?: boolean;
  /** WebDAV 服务地址 */
  webDavUrl?: string;
  /** WebDAV 用户名 */
  webDavUsername?: string;
  /** WebDAV 应用根目录名（默认 ColorTxt）；密码存 secrets vault */
  webDavRemoteDir?: string;
  /** 文件列表分类筛选：`__all__` | `__uncategorized__` | 分类名 */
  fileCategory?: string;
  /** 文件列表排序方式 */
  fileSort?: FileSortMode;
  /** 文件列表：列表 / 树状 */
  fileListViewMode?: FileListViewMode;
  /** 用户维护的分类名称与颜色表 */
  fileCategoryCatalog?: FileCategoryDefinition[];
  /** 监控当前打开文件，磁盘变更后自动重新加载 */
  syncCurrentFile?: boolean;
  /** 内置技能开关（键为技能 id，缺省由合并逻辑视为启用） */
  aiSkillsEnabled?: Record<string, boolean>;
  /** 用户对内置技能的描述与提示词覆盖 */
  aiSkillOverrides?: Record<string, AiSkillUserOverride>;
  /** 用户自定义技能列表 */
  aiCustomSkills?: AiCustomSkill[];
  /** AI 阅读助手：深度思考 */
  aiAssistantDeepThinking?: boolean;
  /** AI 阅读助手：防剧透 */
  aiAssistantSpoilerSafe?: boolean;
  /** 词云全屏：字体（CSS font-family 串，与阅读器独立） */
  wordcloudFontFamily?: string;
  /** 词云全屏：角度布局 */
  wordcloudAngleMode?: "horizontal" | "mixed" | "random";
  /** 词云全屏：配色方案 */
  wordcloudPaletteId?:
    | "category10"
    | "category20"
    | "pastel"
    | "paired"
    | "dark"
    | "accent"
    | "warm"
    | "cool";
  /**
   * 角色立绘缓存根目录（绝对路径）。
   * 缺省时运行时使用 `userData/CharacterPortrait`（子目录名见 `@shared/characterPortraitPaths`）。
   */
  characterPortraitCacheDir?: string;
  /** 语音朗读（引擎、音色、语速音调、DashScope Key、配置方案） */
  voiceRead?: Partial<VoiceReadSettings> & {
    profiles?: unknown[];
    activeProfileId?: string;
    aiSpeakerTokenUsage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      promptCacheHitTokens?: number;
    };
    aiSpeakerTokenUsageAvailable?: boolean;
  };
  /** 角色卡列表纹理/全息效果 */
  characterCardTextureEffect?: string;
};

export type PersistedSettingsLoadResult = {
  data: PersistedSettingsData;
  /** 持久化 JSON 是否包含 `ebookConvertOutputDir` 且为 string（含空串）；否则用 userData/ConvertedTxt 作为首次默认 */
  ebookConvertOutputDirKeyPresent: boolean;
  /** 是否包含 `bookPackUnpackDir` 键（含空串） */
  bookPackUnpackDirKeyPresent: boolean;
  /** 是否包含 `characterPortraitCacheDir` 键（含空串） */
  characterPortraitCacheDirKeyPresent: boolean;
};

export type SessionSnapshot = {
  currentFile: string | null;
  /** 源文件物理行号（含空行），视口顶部行 */
  viewportTopLine: number;
  /** 源文件物理行号（含空行），视口底部行 */
  viewportBottomLine: number;
};

function safeJsonParse(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isTxtFileItemArray(x: unknown): x is TxtFileItem[] {
  if (!Array.isArray(x)) return false;
  return x.every((item) => {
    if (!item || typeof item !== "object") return false;
    const o = item as Record<string, unknown>;
    if (typeof o.path !== "string") return false;
    if (o.addedAt !== undefined) {
      if (typeof o.addedAt !== "number" || !Number.isFinite(o.addedAt))
        return false;
    }
    if (o.category !== undefined && typeof o.category !== "string")
      return false;
    return true;
  });
}

export function loadPersistedSettingsData(
  storage: Storage | undefined,
  key: string,
): PersistedSettingsLoadResult | null {
  const parsed = safeJsonParse(storage?.getItem(key));
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const ebookConvertOutputDirKeyPresent =
    Object.prototype.hasOwnProperty.call(obj, "ebookConvertOutputDir") &&
    typeof obj.ebookConvertOutputDir === "string";
  const bookPackUnpackDirKeyPresent =
    Object.prototype.hasOwnProperty.call(obj, "bookPackUnpackDir") &&
    typeof obj.bookPackUnpackDir === "string";
  const characterPortraitCacheDirKeyPresent =
    Object.prototype.hasOwnProperty.call(obj, "characterPortraitCacheDir") &&
    typeof obj.characterPortraitCacheDir === "string";
  const data: PersistedSettingsData = {};

  if (obj.theme === "vs" || obj.theme === "vs-dark") data.theme = obj.theme;
  if (
    typeof obj.sidebarWidth === "number" &&
    Number.isFinite(obj.sidebarWidth)
  ) {
    data.sidebarWidth = obj.sidebarWidth;
  }
  if (typeof obj.showSidebar === "boolean") {
    data.showSidebar = obj.showSidebar;
  }
  if (typeof obj.isMinimalistView === "boolean") {
    data.isMinimalistView = obj.isMinimalistView;
  }
  if (typeof obj.fontSize === "number" && Number.isFinite(obj.fontSize)) {
    data.fontSize = obj.fontSize;
  }
  if (
    typeof obj.lineHeightMultiple === "number" &&
    Number.isFinite(obj.lineHeightMultiple)
  ) {
    data.lineHeightMultiple = obj.lineHeightMultiple;
  }
  if (
    typeof obj.lineSpacingPx === "number" &&
    Number.isFinite(obj.lineSpacingPx)
  ) {
    data.lineSpacingPx = obj.lineSpacingPx;
  }
  if (
    typeof obj.letterSpacingPx === "number" &&
    Number.isFinite(obj.letterSpacingPx)
  ) {
    data.letterSpacingPx = obj.letterSpacingPx;
  }
  if (
    typeof obj.readerHorizontalInsetPx === "number" &&
    Number.isFinite(obj.readerHorizontalInsetPx)
  ) {
    data.readerHorizontalInsetPx = obj.readerHorizontalInsetPx;
  }
  if (typeof obj.fontFamily === "string" && obj.fontFamily.trim()) {
    data.fontFamily = obj.fontFamily;
  }
  if (Array.isArray(obj.pinnedOtherFonts)) {
    data.pinnedOtherFonts = obj.pinnedOtherFonts.filter(
      (f): f is string => typeof f === "string" && f.trim().length > 0,
    );
  }
  if (typeof obj.monacoCustomHighlight === "boolean") {
    data.monacoCustomHighlight = obj.monacoCustomHighlight;
  }
  if (typeof obj.txtrDelimitedMatchCrossLine === "boolean") {
    data.txtrDelimitedMatchCrossLine = obj.txtrDelimitedMatchCrossLine;
  }
  if (typeof obj.compressBlankLines === "boolean") {
    data.compressBlankLines = obj.compressBlankLines;
  }
  if (typeof obj.compressBlankKeepOneBlank === "boolean") {
    data.compressBlankKeepOneBlank = obj.compressBlankKeepOneBlank;
  }
  if (obj.chapterTitleBlankMode !== undefined) {
    data.chapterTitleBlankMode = parseChapterTitleBlankMode(
      obj.chapterTitleBlankMode,
    );
  }
  if (typeof obj.leadIndentFullWidth === "boolean") {
    data.leadIndentFullWidth = obj.leadIndentFullWidth;
  }
  if (typeof obj.textConvertZh === "string") {
    data.textConvertZh = obj.textConvertZh;
  }
  if (typeof obj.textConvertLetter === "string") {
    data.textConvertLetter = obj.textConvertLetter;
  }
  if (typeof obj.textConvertDigit === "string") {
    data.textConvertDigit = obj.textConvertDigit;
  }
  if (typeof obj.showChapterCounts === "boolean") {
    data.showChapterCounts = obj.showChapterCounts;
  }
  if (typeof obj.chapterCharCountExact === "boolean") {
    data.chapterCharCountExact = obj.chapterCharCountExact;
  }
  if (Array.isArray(obj.chapterRules)) {
    data.chapterRules = obj.chapterRules as ChapterMatchRule[];
  }
  if (typeof obj.restoreSessionOnStartup === "boolean") {
    data.restoreSessionOnStartup = obj.restoreSessionOnStartup;
  }
  if (
    typeof obj.recentFilesHistoryLimit === "number" &&
    Number.isFinite(obj.recentFilesHistoryLimit)
  ) {
    data.recentFilesHistoryLimit = Math.max(
      0,
      Math.min(100, Math.floor(obj.recentFilesHistoryLimit)),
    );
  }
  if (
    typeof obj.chapterMinCharCount === "number" &&
    Number.isFinite(obj.chapterMinCharCount)
  ) {
    data.chapterMinCharCount = Math.max(0, Math.floor(obj.chapterMinCharCount));
  }
  if (typeof obj.monacoAdvancedWrapping === "boolean") {
    data.monacoAdvancedWrapping = obj.monacoAdvancedWrapping;
  }
  if (typeof obj.monacoCjkWrapOptimize === "boolean") {
    data.monacoCjkWrapOptimize = obj.monacoCjkWrapOptimize;
  }
  if (typeof obj.monacoSmoothScrolling === "boolean") {
    data.monacoSmoothScrolling = obj.monacoSmoothScrolling;
  }
  if (
    obj.scrollbarTrackBehavior === "disabled" ||
    obj.scrollbarTrackBehavior === "page" ||
    obj.scrollbarTrackBehavior === "jump"
  ) {
    data.scrollbarTrackBehavior = obj.scrollbarTrackBehavior;
  } else if (typeof obj.disableScrollbarTrackJump === "boolean") {
    data.scrollbarTrackBehavior = obj.disableScrollbarTrackJump
      ? "disabled"
      : "jump";
  }
  if (
    typeof obj.mouseWheelScrollSensitivity === "number" &&
    Number.isFinite(obj.mouseWheelScrollSensitivity)
  ) {
    data.mouseWheelScrollSensitivity = obj.mouseWheelScrollSensitivity;
  }
  if (
    typeof obj.fastScrollSensitivity === "number" &&
    Number.isFinite(obj.fastScrollSensitivity)
  ) {
    data.fastScrollSensitivity = obj.fastScrollSensitivity;
  }
  if (typeof obj.stickyChapterTitleEnabled === "boolean") {
    data.stickyChapterTitleEnabled = obj.stickyChapterTitleEnabled;
  }
  if (typeof obj.readerClickMode === "boolean") {
    data.readerClickMode = obj.readerClickMode;
  }
  if (typeof obj.readingRulerEnabled === "boolean") {
    data.readingRulerEnabled = obj.readingRulerEnabled;
  }
  if (
    typeof obj.readingRulerFocusLines === "number" &&
    Number.isFinite(obj.readingRulerFocusLines)
  ) {
    data.readingRulerFocusLines = obj.readingRulerFocusLines;
  }
  if (
    typeof obj.readingRulerDimOpacity === "number" &&
    Number.isFinite(obj.readingRulerDimOpacity)
  ) {
    data.readingRulerDimOpacity = obj.readingRulerDimOpacity;
  }
  if (typeof obj.readingRulerDimStickyTitle === "boolean") {
    data.readingRulerDimStickyTitle = obj.readingRulerDimStickyTitle;
  }
  if (typeof obj.readingRulerTransitionEnabled === "boolean") {
    data.readingRulerTransitionEnabled = obj.readingRulerTransitionEnabled;
  }
  if (
    typeof obj.markdownImageHeightPx === "number" &&
    Number.isFinite(obj.markdownImageHeightPx)
  ) {
    data.markdownImageHeightPx = obj.markdownImageHeightPx;
  }
  if (typeof obj.chapterNavToolbarEnabled === "boolean") {
    data.chapterNavToolbarEnabled = obj.chapterNavToolbarEnabled;
  }
  if (typeof obj.readerEditShowLineNumbers === "boolean") {
    data.readerEditShowLineNumbers = obj.readerEditShowLineNumbers;
  }
  if (typeof obj.readerEditMinimap === "boolean") {
    data.readerEditMinimap = obj.readerEditMinimap;
  }
  if (typeof obj.editAutoRefreshChapterList === "boolean") {
    data.editAutoRefreshChapterList = obj.editAutoRefreshChapterList;
  }
  if (obj.aiSmartFormat && typeof obj.aiSmartFormat === "object") {
    data.aiSmartFormat = obj.aiSmartFormat as PersistedSettingsData["aiSmartFormat"];
  }
  if (
    typeof obj.fullscreenReaderWidthPercent === "number" &&
    Number.isFinite(obj.fullscreenReaderWidthPercent)
  ) {
    data.fullscreenReaderWidthPercent = Math.max(
      30,
      Math.min(100, Math.floor(obj.fullscreenReaderWidthPercent)),
    );
  }
  if (typeof obj.fullscreenShowSystemTime === "boolean") {
    data.fullscreenShowSystemTime = obj.fullscreenShowSystemTime;
  }
  if (obj.timedScroll && typeof obj.timedScroll === "object") {
    data.timedScroll = mergeTimedScrollSettings(
      obj.timedScroll as Partial<TimedScrollSettings>,
    );
  }
  if (obj.pomodoro && typeof obj.pomodoro === "object") {
    data.pomodoro = mergePomodoroSettings(
      obj.pomodoro as Partial<PomodoroSettings>,
    );
  }
  if (
    obj.selectionToolbarButtons &&
    typeof obj.selectionToolbarButtons === "object"
  ) {
    data.selectionToolbarButtons = mergeSelectionToolbarButtons(
      obj.selectionToolbarButtons as Partial<SelectionToolbarButtons>,
    );
  }
  if (obj.dictionarySettings && typeof obj.dictionarySettings === "object") {
    data.dictionarySettings = mergeDictionarySettings(
      obj.dictionarySettings as Partial<DictionarySettings>,
    );
  }
  if (obj.webSearchSettings && typeof obj.webSearchSettings === "object") {
    data.webSearchSettings = mergeWebSearchSettings(
      obj.webSearchSettings as Partial<WebSearchSettings>,
    );
  }
  if (obj.translationSettings && typeof obj.translationSettings === "object") {
    data.translationSettings = stripTranslationSecretsForDisk(
      mergeTranslationSettings(
        obj.translationSettings as Partial<TranslationSettings>,
      ),
    );
  }
  if (obj.shortcutBindings && typeof obj.shortcutBindings === "object") {
    data.shortcutBindings = obj.shortcutBindings as Partial<
      Record<ShortcutActionId, string>
    >;
  }
  const enabledOverrides = parseReaderPaletteColorEnabledOverridesFromPersisted(
    obj,
  );
  if (Object.keys(enabledOverrides).length) {
    data.readerPaletteColorEnabledOverrides = enabledOverrides;
  }
  if (obj.readerBackground != null) {
    data.readerBackground = parseReaderBackgroundState(obj.readerBackground);
  }
  const migratedPalette = migrateLegacyReaderPaletteOverrides({
    userPresets: parseReaderPaletteUserPresets(obj.readerPaletteUserPresets),
    selectedIdLight: parseReaderPaletteSelectedId(
      obj.readerPaletteSelectedIdLight,
    ),
    selectedIdDark: parseReaderPaletteSelectedId(
      obj.readerPaletteSelectedIdDark,
    ),
    overridesLight: obj.readerPaletteOverridesLight,
    overridesDark: obj.readerPaletteOverridesDark,
  });
  if (migratedPalette.userPresets.length) {
    data.readerPaletteUserPresets = migratedPalette.userPresets;
  }
  if (migratedPalette.selectedIdLight) {
    data.readerPaletteSelectedIdLight = migratedPalette.selectedIdLight;
  }
  if (migratedPalette.selectedIdDark) {
    data.readerPaletteSelectedIdDark = migratedPalette.selectedIdDark;
  }
  if (migratedPalette.migrated) {
    persistLegacyReaderPaletteMigration(storage, key, obj, migratedPalette);
  }
  if (Array.isArray(obj.highlightColorsLight)) {
    const h = parseHighlightColorsArray(obj.highlightColorsLight);
    if (h) data.highlightColorsLight = h;
  }
  if (Array.isArray(obj.highlightColorsDark)) {
    const h = parseHighlightColorsArray(obj.highlightColorsDark);
    if (h) data.highlightColorsDark = h;
  }
  if (Array.isArray(obj.lineationColorsLight)) {
    const c = parseLineationColorsArray(obj.lineationColorsLight);
    if (c) data.lineationColorsLight = c;
  }
  if (Array.isArray(obj.lineationColorsDark)) {
    const c = parseLineationColorsArray(obj.lineationColorsDark);
    if (c) data.lineationColorsDark = c;
  }
  if (obj.lineationLastColors != null && typeof obj.lineationLastColors === "object") {
    data.lineationLastColors = parseLineationLastColors(obj.lineationLastColors);
  }
  if (obj.highlightLastColor != null) {
    data.highlightLastColor = parseHighlightLastColor(obj.highlightLastColor);
  }
  const globalHl = normalizeHighlightWordsByIndex(
    obj.highlightWordsByIndexGlobal,
  );
  if (globalHl) data.highlightWordsByIndexGlobal = globalHl;
  if (typeof obj.ebookConvertOutputDir === "string") {
    data.ebookConvertOutputDir = obj.ebookConvertOutputDir;
  }
  if (typeof obj.bookPackUnpackDir === "string") {
    data.bookPackUnpackDir = obj.bookPackUnpackDir.trim();
  }
  if (typeof obj.bookPackPassword === "string") {
    data.bookPackPassword = obj.bookPackPassword;
  }
  if (typeof obj.webDavEnabled === "boolean") {
    data.webDavEnabled = obj.webDavEnabled;
  }
  if (typeof obj.webDavUrl === "string") {
    data.webDavUrl = obj.webDavUrl;
  }
  if (typeof obj.webDavUsername === "string") {
    data.webDavUsername = obj.webDavUsername;
  }
  if (typeof obj.webDavRemoteDir === "string") {
    data.webDavRemoteDir = obj.webDavRemoteDir;
  }
  if (typeof obj.fileCategory === "string" && obj.fileCategory.trim()) {
    data.fileCategory = obj.fileCategory.trim();
  }
  if (typeof obj.fileSort === "string" && isFileSortMode(obj.fileSort)) {
    data.fileSort = obj.fileSort;
  }
  if (obj.fileListViewMode !== undefined) {
    data.fileListViewMode = parseFileListViewMode(obj.fileListViewMode);
  }
  const catalog = parseFileCategoryCatalog(obj.fileCategoryCatalog);
  if (catalog) data.fileCategoryCatalog = catalog;
  if (typeof obj.syncCurrentFile === "boolean") {
    data.syncCurrentFile = obj.syncCurrentFile;
  }

  const hasAiSkillsPersisted =
    (obj.aiSkillsEnabled && typeof obj.aiSkillsEnabled === "object") ||
    (obj.aiSkillOverrides && typeof obj.aiSkillOverrides === "object") ||
    Array.isArray(obj.aiCustomSkills);

  const customSkillList = Array.isArray(obj.aiCustomSkills)
    ? mergeAiCustomSkills(obj.aiCustomSkills)
    : [];
  if (customSkillList.length) {
    data.aiCustomSkills = customSkillList;
  }
  const customSkillIds = customSkillList.map((s) => s.id);

  if (obj.aiSkillOverrides && typeof obj.aiSkillOverrides === "object") {
    data.aiSkillOverrides = mergeAiSkillOverrides(
      obj.aiSkillOverrides as Record<string, AiSkillUserOverride>,
    );
  }

  if (hasAiSkillsPersisted) {
    const enabledRaw =
      obj.aiSkillsEnabled && typeof obj.aiSkillsEnabled === "object"
        ? (obj.aiSkillsEnabled as Record<string, boolean>)
        : undefined;
    data.aiSkillsEnabled = mergeAiSkillsEnabled(enabledRaw, customSkillIds);
  }

  if (typeof obj.aiAssistantDeepThinking === "boolean") {
    data.aiAssistantDeepThinking = obj.aiAssistantDeepThinking;
  }
  if (typeof obj.aiAssistantSpoilerSafe === "boolean") {
    data.aiAssistantSpoilerSafe = obj.aiAssistantSpoilerSafe;
  }

  if (
    typeof obj.wordcloudFontFamily === "string" &&
    obj.wordcloudFontFamily.trim()
  ) {
    data.wordcloudFontFamily = obj.wordcloudFontFamily.trim();
  }
  const wordcloudAngle = parseWordcloudAngleMode(obj.wordcloudAngleMode);
  if (wordcloudAngle) {
    data.wordcloudAngleMode = wordcloudAngle;
  }
  const wordcloudPalette = parseWordcloudPaletteId(obj.wordcloudPaletteId);
  if (wordcloudPalette) {
    data.wordcloudPaletteId = wordcloudPalette;
  }

  if (typeof obj.characterPortraitCacheDir === "string") {
    data.characterPortraitCacheDir = obj.characterPortraitCacheDir.trim();
  }

  data.characterCardTextureEffect = normalizeCharacterCardTextureEffect(
    obj.characterCardTextureEffect,
  );

  if (obj.voiceRead && typeof obj.voiceRead === "object") {
    const vr = obj.voiceRead as Record<string, unknown>;
    data.voiceRead = {
      scheme:
        vr.scheme === "single" || vr.scheme === "multi" ? vr.scheme : undefined,
      engine: isVoiceReadEngineId(vr.engine) ? vr.engine : undefined,
      single:
        vr.single && typeof vr.single === "object"
          ? (vr.single as VoiceReadSettings["single"])
          : undefined,
      multi:
        vr.multi && typeof vr.multi === "object"
          ? (vr.multi as VoiceReadSettings["multi"])
          : undefined,
      rate: typeof vr.rate === "number" ? vr.rate : undefined,
      pitch: typeof vr.pitch === "number" ? vr.pitch : undefined,
      volume: typeof vr.volume === "number" ? vr.volume : undefined,
      emotionEnabled:
        typeof vr.emotionEnabled === "boolean" ? vr.emotionEnabled : undefined,
      dashscopeApiKey:
        typeof vr.dashscopeApiKey === "string" ? vr.dashscopeApiKey : undefined,
      engineConfig:
        vr.engineConfig && typeof vr.engineConfig === "object"
          ? (vr.engineConfig as Record<string, unknown>)
          : undefined,
      profiles: Array.isArray(vr.profiles) ? vr.profiles : undefined,
      activeProfileId:
        typeof vr.activeProfileId === "string" ? vr.activeProfileId : undefined,
    };
    const usageRaw = vr.aiSpeakerTokenUsage;
    if (usageRaw && typeof usageRaw === "object") {
      const u = usageRaw as Record<string, unknown>;
      data.voiceRead!.aiSpeakerTokenUsage = {
        promptTokens:
          typeof u.promptTokens === "number" ? u.promptTokens : undefined,
        completionTokens:
          typeof u.completionTokens === "number" ? u.completionTokens : undefined,
        totalTokens:
          typeof u.totalTokens === "number" ? u.totalTokens : undefined,
        promptCacheHitTokens:
          typeof u.promptCacheHitTokens === "number"
            ? u.promptCacheHitTokens
            : undefined,
      };
    }
    if (typeof vr.aiSpeakerTokenUsageAvailable === "boolean") {
      data.voiceRead!.aiSpeakerTokenUsageAvailable =
        vr.aiSpeakerTokenUsageAvailable;
    }
  }

  return {
    data,
    ebookConvertOutputDirKeyPresent,
    bookPackUnpackDirKeyPresent,
    characterPortraitCacheDirKeyPresent,
  };
}

function persistLegacyReaderPaletteMigration(
  storage: Storage | undefined,
  key: string,
  disk: Record<string, unknown>,
  migrated: {
    userPresets: ReaderPalettePreset[];
    selectedIdLight: string;
    selectedIdDark: string;
  },
) {
  try {
    const next = { ...disk };
    next.readerPaletteUserPresets = serializeReaderPaletteUserPresets(
      migrated.userPresets,
    );
    if (migrated.selectedIdLight) {
      next.readerPaletteSelectedIdLight = migrated.selectedIdLight;
    } else {
      delete next.readerPaletteSelectedIdLight;
    }
    if (migrated.selectedIdDark) {
      next.readerPaletteSelectedIdDark = migrated.selectedIdDark;
    } else {
      delete next.readerPaletteSelectedIdDark;
    }
    delete next.readerPaletteOverridesLight;
    delete next.readerPaletteOverridesDark;
    delete next.readerPaletteColorEnabledOverridesLight;
    delete next.readerPaletteColorEnabledOverridesDark;
    delete next.readerPaletteSelectedPresetId;
    storage?.setItem(key, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function persistSettingsData(
  storage: Storage | undefined,
  key: string,
  data: PersistedSettingsData,
) {
  try {
    const payload = { ...(data as Record<string, unknown>) };
    delete payload.readerPaletteColorEnabledOverridesLight;
    delete payload.readerPaletteColorEnabledOverridesDark;
    delete payload.readerPaletteSelectedPresetId;
    delete payload.readerPaletteOverridesLight;
    delete payload.readerPaletteOverridesDark;
    storage?.setItem(key, JSON.stringify(payload));
    if (
      typeof window !== "undefined" &&
      storage === window.localStorage &&
      key === persistKey
    ) {
      window.dispatchEvent(new Event(persistedSettingsChangedEvent));
    }
  } catch {
    // ignore
  }
}

/**
 * 合并写入主设置 JSON（保留未在 patch 中出现的键）。
 * 传入 baseline 时：window-local 且相对基线未变的字段保留磁盘值，且不把磁盘合并进调用方内存。
 */
export function patchPersistedMainSettings(
  patch: Record<string, unknown>,
  options?: {
    baseline?: Record<string, unknown>;
    windowLocalKeys?: ReadonlySet<string>;
    skipKeys?: ReadonlySet<string>;
  },
) {
  const disk = readPersistedMainSettingsObject();
  let next: Record<string, unknown>;
  if (options?.baseline) {
    const merged = mergeLocalPatchOntoDiskSettings({
      disk,
      patch,
      baseline: options.baseline,
      windowLocalKeys: options.windowLocalKeys,
      skipKeys: options.skipKeys,
    });
    next = merged.next;
    applyBaselineUpdates(options.baseline, patch, merged.writtenKeys);
  } else {
    next = { ...disk };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      next[key] = value;
    }
    delete next.readerPaletteColorEnabledOverridesLight;
    delete next.readerPaletteColorEnabledOverridesDark;
    delete next.readerPaletteSelectedPresetId;
    delete next.readerPaletteOverridesLight;
    delete next.readerPaletteOverridesDark;
  }
  persistSettingsData(
    typeof localStorage !== "undefined" ? localStorage : undefined,
    persistKey,
    next as PersistedSettingsData,
  );
}

export function loadSessionSnapshot(
  storage: Storage | undefined,
  key: string,
): SessionSnapshot | null {
  const parsed = safeJsonParse(storage?.getItem(key));
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const currentFile =
    typeof obj.currentFile === "string" && obj.currentFile.trim()
      ? obj.currentFile
      : null;
  const viewportTopLine =
    typeof obj.viewportTopLine === "number" &&
    Number.isFinite(obj.viewportTopLine)
      ? Math.max(1, Math.floor(obj.viewportTopLine))
      : 1;
  const viewportBottomLine =
    typeof obj.viewportBottomLine === "number" &&
    Number.isFinite(obj.viewportBottomLine)
      ? Math.max(1, Math.floor(obj.viewportBottomLine))
      : 1;

  return {
    currentFile,
    viewportTopLine,
    viewportBottomLine,
  };
}

export function persistSessionSnapshot(
  storage: Storage | undefined,
  key: string,
  data: SessionSnapshot,
) {
  try {
    storage?.setItem(key, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function clearSessionSnapshot(
  storage: Storage | undefined,
  key: string,
) {
  try {
    storage?.removeItem(key);
  } catch {
    // ignore
  }
}

export function loadTxtFileListSnapshot(
  storage: Storage | undefined,
  key: string,
): TxtFileItem[] {
  const parsed = safeJsonParse(storage?.getItem(key));
  if (!isTxtFileItemArray(parsed)) return [];
  return migrateTxtFileListAddedAt(parsed);
}

export function persistTxtFileListSnapshot(
  storage: Storage | undefined,
  key: string,
  data: TxtFileItem[],
) {
  try {
    storage?.setItem(key, JSON.stringify(data));
  } catch {
    // ignore
  }
}
