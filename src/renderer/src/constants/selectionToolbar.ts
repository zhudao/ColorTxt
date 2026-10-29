/** 选区工具条「查找」应用目标 */
export type SelectionToolbarFindTarget = "findBar" | "sidebarSearch";

/** 选区浮动工具条上可由用户配置的项 */
export type SelectionToolbarButtons = {
  copy: boolean;
  find: boolean;
  askAi: boolean;
  /** 词典查词（默认显示） */
  dictionary: boolean;
  /** 选区翻译（默认显示） */
  translate: boolean;
  /** 「查找」按钮：打开 Monaco 查找栏，或填入侧栏全文搜索 */
  findTarget: SelectionToolbarFindTarget;
};

export const SELECTION_TOOLBAR_FIND_TARGET_OPTIONS: {
  id: SelectionToolbarFindTarget;
  label: string;
}[] = [
  { id: "findBar", label: "查找栏" },
  { id: "sidebarSearch", label: "全文搜索" },
];

export const defaultSelectionToolbarFindTarget: SelectionToolbarFindTarget =
  "findBar";

export const defaultSelectionToolbarButtons: SelectionToolbarButtons = {
  copy: true,
  find: true,
  askAi: true,
  dictionary: true,
  translate: true,
  findTarget: defaultSelectionToolbarFindTarget,
};

export function isSelectionToolbarFindTarget(
  v: unknown,
): v is SelectionToolbarFindTarget {
  return v === "findBar" || v === "sidebarSearch";
}

export function mergeSelectionToolbarButtons(
  partial: Partial<SelectionToolbarButtons> | null | undefined,
): SelectionToolbarButtons {
  return {
    copy:
      typeof partial?.copy === "boolean"
        ? partial.copy
        : defaultSelectionToolbarButtons.copy,
    find:
      typeof partial?.find === "boolean"
        ? partial.find
        : defaultSelectionToolbarButtons.find,
    askAi:
      typeof partial?.askAi === "boolean"
        ? partial.askAi
        : defaultSelectionToolbarButtons.askAi,
    dictionary:
      typeof partial?.dictionary === "boolean"
        ? partial.dictionary
        : defaultSelectionToolbarButtons.dictionary,
    translate:
      typeof partial?.translate === "boolean"
        ? partial.translate
        : defaultSelectionToolbarButtons.translate,
    findTarget: isSelectionToolbarFindTarget(partial?.findTarget)
      ? partial.findTarget
      : defaultSelectionToolbarButtons.findTarget,
  };
}

/**
 * 当前配置下选区工具条是否至少有一个按钮会渲染。
 * 可配置项全关且无高亮词/划线/笔记时不应弹出空白工具条。
 */
export function hasVisibleSelectionToolbarActions(opts: {
  buttons: SelectionToolbarButtons;
  showAnnotationTools: boolean;
  aiFeaturesEnabled: boolean;
}): boolean {
  const b = opts.buttons;
  if (b.copy || b.find || b.dictionary || b.translate) return true;
  if (opts.aiFeaturesEnabled && b.askAi) return true;
  if (opts.showAnnotationTools) {
    // 划线三种 + 记笔记固定展示；高亮词另受自定义高亮开关控制
    return true;
  }
  return false;
}
