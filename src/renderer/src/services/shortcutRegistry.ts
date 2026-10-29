type ShortcutScope = "window" | "global";

/** 快捷键面板展示上下文：主窗与找书窗列表项不同 */
export type ShortcutPanelContext = "main" | "findBook";

export type ShortcutActionId =
  | "openFile"
  | "pickTxtDirectory"
  | "scrollDownLine"
  | "scrollUpLine"
  | "scrollPageUp"
  | "scrollPageDown"
  | "jumpPrevChapter"
  | "jumpNextChapter"
  | "decreaseFontSize"
  | "increaseFontSize"
  | "decreaseLineHeight"
  | "increaseLineHeight"
  | "decreaseLetterSpacing"
  | "increaseLetterSpacing"
  | "decreaseParagraphSpacing"
  | "increaseParagraphSpacing"
  | "decreaseHorizontalInset"
  | "increaseHorizontalInset"
  | "toggleFind"
  | "openSidebarSearch"
  | "openSidebarFiles"
  | "openSidebarChapters"
  | "openSidebarAiAssistant"
  | "toggleReaderEdit"
  | "editSelectedText"
  | "openChapterRules"
  | "toggleBookmark"
  | "toggleSidebar"
  | "toggleMinimalistView"
  | "toggleFullscreen"
  | "toggleTheme"
  | "openSettings"
  | "openColorScheme"
  | "openFindBook"
  | "openBookSource"
  | "openNewWindow"
  | "enterStealthReader"
  | "toggleAllWindowsVisibility";

type ShortcutActionDef = {
  id: ShortcutActionId;
  scope: ShortcutScope;
  desc: string;
  handlerKey: ShortcutActionId;
};

/** 主窗口快捷键面板不展示（仅找书窗使用） */
const MAIN_PANEL_HIDDEN_ACTION_IDS = new Set<ShortcutActionId>([
  "openBookSource",
]);

/** 找书窗口快捷键面板不展示（仅主窗使用） */
const FIND_BOOK_PANEL_HIDDEN_ACTION_IDS = new Set<ShortcutActionId>([
  "openFile",
  "pickTxtDirectory",
  "openChapterRules",
  "toggleBookmark",
  "openSidebarSearch",
  "openSidebarFiles",
  "openSidebarChapters",
  "openSidebarAiAssistant",
]);

export const SHORTCUT_ACTIONS: ShortcutActionDef[] = [
  { id: "openFile", scope: "window", desc: "打开文件", handlerKey: "openFile" },
  {
    id: "pickTxtDirectory",
    scope: "window",
    desc: "选择目录",
    handlerKey: "pickTxtDirectory",
  },
  {
    id: "scrollDownLine",
    scope: "window",
    desc: "向下滚动",
    handlerKey: "scrollDownLine",
  },
  { id: "scrollUpLine", scope: "window", desc: "向上滚动", handlerKey: "scrollUpLine" },
  { id: "scrollPageUp", scope: "window", desc: "上一屏", handlerKey: "scrollPageUp" },
  {
    id: "scrollPageDown",
    scope: "window",
    desc: "下一屏",
    handlerKey: "scrollPageDown",
  },
  {
    id: "jumpPrevChapter",
    scope: "window",
    desc: "上一章",
    handlerKey: "jumpPrevChapter",
  },
  {
    id: "jumpNextChapter",
    scope: "window",
    desc: "下一章",
    handlerKey: "jumpNextChapter",
  },
  {
    id: "decreaseFontSize",
    scope: "window",
    desc: "减小字号",
    handlerKey: "decreaseFontSize",
  },
  {
    id: "increaseFontSize",
    scope: "window",
    desc: "加大字号",
    handlerKey: "increaseFontSize",
  },
  {
    id: "decreaseLineHeight",
    scope: "window",
    desc: "减小行间距",
    handlerKey: "decreaseLineHeight",
  },
  {
    id: "increaseLineHeight",
    scope: "window",
    desc: "加大行间距",
    handlerKey: "increaseLineHeight",
  },
  {
    id: "decreaseLetterSpacing",
    scope: "window",
    desc: "减小字间距",
    handlerKey: "decreaseLetterSpacing",
  },
  {
    id: "increaseLetterSpacing",
    scope: "window",
    desc: "加大字间距",
    handlerKey: "increaseLetterSpacing",
  },
  {
    id: "decreaseParagraphSpacing",
    scope: "window",
    desc: "减小段间距",
    handlerKey: "decreaseParagraphSpacing",
  },
  {
    id: "increaseParagraphSpacing",
    scope: "window",
    desc: "加大段间距",
    handlerKey: "increaseParagraphSpacing",
  },
  {
    id: "decreaseHorizontalInset",
    scope: "window",
    desc: "减小左右边距",
    handlerKey: "decreaseHorizontalInset",
  },
  {
    id: "increaseHorizontalInset",
    scope: "window",
    desc: "加大左右边距",
    handlerKey: "increaseHorizontalInset",
  },
  { id: "toggleFind", scope: "window", desc: "查找", handlerKey: "toggleFind" },
  {
    id: "openSidebarSearch",
    scope: "window",
    desc: "侧边栏：搜索",
    handlerKey: "openSidebarSearch",
  },
  {
    id: "openSidebarFiles",
    scope: "window",
    desc: "侧边栏：文件",
    handlerKey: "openSidebarFiles",
  },
  {
    id: "openSidebarChapters",
    scope: "window",
    desc: "侧边栏：章节",
    handlerKey: "openSidebarChapters",
  },
  {
    id: "openSidebarAiAssistant",
    scope: "window",
    desc: "侧边栏：AI 阅读助手",
    handlerKey: "openSidebarAiAssistant",
  },
  {
    id: "toggleReaderEdit",
    scope: "window",
    desc: "进入/退出编辑模式",
    handlerKey: "toggleReaderEdit",
  },
  {
    id: "editSelectedText",
    scope: "window",
    desc: "编辑选中文本",
    handlerKey: "editSelectedText",
  },
  {
    id: "openChapterRules",
    scope: "window",
    desc: "章节匹配规则",
    handlerKey: "openChapterRules",
  },
  {
    id: "toggleBookmark",
    scope: "window",
    desc: "添加/移除书签",
    handlerKey: "toggleBookmark",
  },
  {
    id: "toggleSidebar",
    scope: "window",
    desc: "显示/隐藏侧边栏",
    handlerKey: "toggleSidebar",
  },
  {
    id: "toggleTheme",
    scope: "window",
    desc: "切换主题色",
    handlerKey: "toggleTheme",
  },
  { id: "openSettings", scope: "window", desc: "设置", handlerKey: "openSettings" },
  {
    id: "openColorScheme",
    scope: "window",
    desc: "配色",
    handlerKey: "openColorScheme",
  },
  {
    id: "openFindBook",
    scope: "window",
    desc: "找书/主界面",
    handlerKey: "openFindBook",
  },
  {
    id: "openBookSource",
    scope: "window",
    desc: "书源管理",
    handlerKey: "openBookSource",
  },
  {
    id: "enterStealthReader",
    scope: "window",
    desc: "进入/退出摸鱼模式",
    handlerKey: "enterStealthReader",
  },
  {
    id: "toggleMinimalistView",
    scope: "window",
    desc: "进入/退出极简视图",
    handlerKey: "toggleMinimalistView",
  },
  {
    id: "toggleFullscreen",
    scope: "window",
    desc: "进入/退出全屏阅读",
    handlerKey: "toggleFullscreen",
  },
  {
    id: "openNewWindow",
    scope: "window",
    desc: "打开新窗口",
    handlerKey: "openNewWindow",
  },
  {
    id: "toggleAllWindowsVisibility",
    scope: "global",
    desc: "显示/隐藏阅读器（全局）",
    handlerKey: "toggleAllWindowsVisibility",
  },
];

export function shortcutActionsForPanel(
  context: ShortcutPanelContext,
): ShortcutActionDef[] {
  const hidden =
    context === "findBook"
      ? FIND_BOOK_PANEL_HIDDEN_ACTION_IDS
      : MAIN_PANEL_HIDDEN_ACTION_IDS;
  return SHORTCUT_ACTIONS.filter((a) => !hidden.has(a.id));
}

export type ShortcutBindingMap = Record<ShortcutActionId, string>;

function accelKeyName(isMac: boolean) {
  return isMac ? "Command" : "Control";
}

export function createDefaultShortcutBindings(isMac: boolean): ShortcutBindingMap {
  const accel = accelKeyName(isMac);
  return {
    openFile: `${accel}+O`,
    pickTxtDirectory: `${accel}+Shift+O`,
    scrollDownLine: "Down",
    scrollUpLine: "Up",
    scrollPageUp: "PageUp",
    scrollPageDown: "PageDown",
    jumpPrevChapter: `${accel}+Left`,
    jumpNextChapter: `${accel}+Right`,
    decreaseFontSize: `${accel}+-`,
    increaseFontSize: `${accel}+=`,
    decreaseLineHeight: `${accel}+[`,
    increaseLineHeight: `${accel}+]`,
    decreaseLetterSpacing: `${accel}+Shift+[`,
    increaseLetterSpacing: `${accel}+Shift+]`,
    decreaseParagraphSpacing: `${accel}+;`,
    increaseParagraphSpacing: `${accel}+'`,
    decreaseHorizontalInset: `${accel}+Shift+,`,
    increaseHorizontalInset: `${accel}+Shift+.`,
    toggleFind: `${accel}+F`,
    openSidebarSearch: `${accel}+Shift+F`,
    openSidebarFiles: `${accel}+Shift+E`,
    openSidebarChapters: `${accel}+Shift+C`,
    openSidebarAiAssistant: `${accel}+Shift+A`,
    toggleReaderEdit: `${accel}+/`,
    editSelectedText: `${accel}+E`,
    openChapterRules: `${accel}+R`,
    toggleBookmark: `${accel}+D`,
    toggleSidebar: `${accel}+B`,
    toggleMinimalistView: "F10",
    toggleFullscreen: "F11",
    toggleTheme: "F2",
    openSettings: "F5",
    openColorScheme: "F6",
    openFindBook: "F7",
    openBookSource: "F8",
    openNewWindow: `${accel}+Shift+N`,
    enterStealthReader: "F9",
    toggleAllWindowsVisibility: "Control+`",
  };
}
