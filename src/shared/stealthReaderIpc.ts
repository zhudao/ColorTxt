/** 摸鱼模式独立窗 IPC；覆盖层与主窗共用 preload。 */

export const STEALTH_READER_IPC = {
  enter: "stealthReader:enter",
  getPayload: "stealthReader:getPayload",
  exit: "stealthReader:exit",
  popupMenu: "stealthReader:popupMenu",
  command: "stealthReader:command",
  menuOpen: "stealthReader:menuOpen",
  getBounds: "stealthReader:getBounds",
  getCursorScreenPoint: "stealthReader:getCursorScreenPoint",
  setBounds: "stealthReader:setBounds",
  setPosition: "stealthReader:setPosition",
  setMinSize: "stealthReader:setMinSize",
  /**
   * macOS：不可聚焦的透明窗不会套用 CSS cursor。
   * 覆盖层在边缘悬停时把系统光标设成缩放样式。
   */
  setHoverCursor: "stealthReader:setHoverCursor",
  blur: "stealthReader:blur",
  /** 重申窗口透明（不改尺寸）；设置窗抢焦点 / 点按提示层结束后用 */
  refreshTransparency: "stealthReader:refreshTransparency",
  prepareEyedropper: "stealthReader:prepareEyedropper",
  restoreEyedropper: "stealthReader:restoreEyedropper",
  ownerProgress: "stealthReader:ownerProgress",
  /** 覆盖层 → 主进程 → 源窗：章边界外切章（找书等单章 payload） */
  ownerChapterNav: "stealthReader:ownerChapterNav",
  /** 源窗 → 主进程：热换摸鱼正文（不 teardown） */
  updatePayload: "stealthReader:updatePayload",
  /** 覆盖层拉取热换正文（与 boot 用的 getPayload 分开，避免误清） */
  getPendingPayload: "stealthReader:getPendingPayload",
  /** 源窗 → 主进程 → 覆盖层：切章失败/无邻章时解除加载态 */
  chapterNavSettled: "stealthReader:chapterNavSettled",
  /** 覆盖层 / 设置窗 → 主进程：更新翻页切章全局键 */
  setNavShortcuts: "stealthReader:setNavShortcuts",
} as const;

export type StealthChapterSnapshot = {
  title: string;
  lineNumber: number;
  tocOrder?: number;
};

/** 摸鱼窗边缘悬停光标。仅 macOS 主进程会真正设置。 */
export type StealthHoverCursor = "arrow" | "ns" | "ew" | "nesw" | "nwse";

export type StealthBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StealthEnterPayload = {
  text: string;
  startLine: number;
  chapters: StealthChapterSnapshot[];
  bounds?: StealthBounds | null;
  /** 与主窗「摸鱼模式」快捷键一致；摸鱼期间用作全局退出键 */
  exitAccelerator?: string;
  /** 进入时的翻页/切章键（来自摸鱼设置） */
  navShortcuts?: Partial<
    Record<"pagePrev" | "pageNext" | "chapterPrev" | "chapterNext", string>
  >;
  /**
   * 源窗是否还有上一/下一可读章（找书单章 payload 用）。
   * 省略则覆盖层不向源窗请求切章（整书本地 TOC 或未知）。
   */
  hasPrevChapter?: boolean;
  hasNextChapter?: boolean;
};

export type StealthPagePayload = {
  text: string;
  startLine: number;
  chapters: StealthChapterSnapshot[];
  /** end：定位到章末一页（找书上边界切上一章） */
  anchor?: "start" | "end";
  hasPrevChapter?: boolean;
  hasNextChapter?: boolean;
};

export type StealthCommand =
  | "pagePrev"
  | "pageNext"
  | "chapterPrev"
  | "chapterNext"
  | "exit"
  | "openSettings"
  /** 右键：启动/停止摸鱼窗定时滚动 */
  | "toggleTimedScroll"
  /** 源窗热换章后：覆盖层拉取 pending payload */
  | "reloadPayload"
  /** 源窗切章未更新正文：解除加载态 */
  | "chapterNavSettled";

export type StealthOwnerProgressPayload = {
  line: number;
  /** true：退出摸鱼后跳转并聚焦；false：隐藏源窗时只同步滚动 */
  focus: boolean;
};

export type StealthChapterNavDirection = "prev" | "next";

export type StealthOwnerChapterNavPayload = {
  direction: StealthChapterNavDirection;
  /**
   * 切到目标章后的定位：start 章首（快捷键默认）；
   * end 章末（仅上边界再滚/翻页切上一章）。
   */
  anchor?: "start" | "end";
};
