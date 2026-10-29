/** 简繁转换选项（「关」或 OpenCC 配置基名，不含 .json） */
export type TextConvertZhMode =
  | "off"
  | "t2s"
  | "tw2sp"
  | "hk2s"
  | "mo2s"
  | "s2t"
  | "s2twp"
  | "s2hk"
  | "s2mo";

/** 字母/数字全角 ↔ 半角 */
export type TextConvertWidthMode = "off" | "full-to-half" | "half-to-full";

export type TextConvertZhMenuOption = {
  id: TextConvertZhMode;
  label: string;
  /** 阅读模式：此项前显示分隔线 */
  dividerBeforeRead?: boolean;
  /** 编辑模式：此项前显示分隔线 */
  dividerBeforeEdit?: boolean;
};

export type TextConvertWidthMenuOption = {
  id: TextConvertWidthMode;
  label: string;
  dividerBeforeRead?: boolean;
  dividerBeforeEdit?: boolean;
};

/** 阅读模式：「简繁」子菜单（含「关」） */
export const TEXT_CONVERT_ZH_READ_MENU: TextConvertZhMenuOption[] = [
  { id: "off", label: "关" },
  { id: "t2s", label: "標準繁體 → 简体", dividerBeforeRead: true },
  { id: "tw2sp", label: "台灣繁體 → 简体" },
  { id: "hk2s", label: "香港繁體 → 简体" },
  { id: "mo2s", label: "澳門繁體 → 简体" },
  { id: "s2t", label: "简体 → 標準繁體", dividerBeforeRead: true },
  { id: "s2twp", label: "简体 → 台灣繁體" },
  { id: "s2hk", label: "简体 → 香港繁體" },
  { id: "s2mo", label: "简体 → 澳門繁體" },
];

/** 编辑模式：无「关」 */
export const TEXT_CONVERT_ZH_EDIT_MENU: TextConvertZhMenuOption[] = [
  { id: "t2s", label: "標準繁體 → 简体" },
  { id: "tw2sp", label: "台灣繁體 → 简体" },
  { id: "hk2s", label: "香港繁體 → 简体" },
  { id: "mo2s", label: "澳門繁體 → 简体" },
  { id: "s2t", label: "简体 → 標準繁體", dividerBeforeEdit: true },
  { id: "s2twp", label: "简体 → 台灣繁體" },
  { id: "s2hk", label: "简体 → 香港繁體" },
  { id: "s2mo", label: "简体 → 澳門繁體" },
];

export const TEXT_CONVERT_WIDTH_READ_MENU: TextConvertWidthMenuOption[] = [
  { id: "off", label: "关" },
  { id: "full-to-half", label: "全角 → 半角", dividerBeforeRead: true },
  { id: "half-to-full", label: "半角 → 全角" },
];

export const TEXT_CONVERT_WIDTH_EDIT_MENU: TextConvertWidthMenuOption[] = [
  { id: "full-to-half", label: "全角 → 半角" },
  { id: "half-to-full", label: "半角 → 全角" },
];

export const defaultTextConvertZhMode: TextConvertZhMode = "off";
export const defaultTextConvertLetterMode: TextConvertWidthMode = "off";
export const defaultTextConvertDigitMode: TextConvertWidthMode = "off";

const VALID_ZH_MODES = new Set<string>([
  "off",
  "t2s",
  "tw2sp",
  "hk2s",
  "mo2s",
  "s2t",
  "s2twp",
  "s2hk",
  "s2mo",
]);

const VALID_WIDTH_MODES = new Set<string>([
  "off",
  "full-to-half",
  "half-to-full",
]);

/** 澳门无独立 OpenCC 配置，复用香港规则 */
export function resolveOpenCcConfig(mode: TextConvertZhMode): string | null {
  switch (mode) {
    case "off":
      return null;
    case "mo2s":
      return "hk2s";
    case "s2mo":
      return "s2hk";
    default:
      return mode;
  }
}

export function parseTextConvertZhMode(raw: unknown): TextConvertZhMode {
  return typeof raw === "string" && VALID_ZH_MODES.has(raw)
    ? (raw as TextConvertZhMode)
    : defaultTextConvertZhMode;
}

export function parseTextConvertWidthMode(raw: unknown): TextConvertWidthMode {
  return typeof raw === "string" && VALID_WIDTH_MODES.has(raw)
    ? (raw as TextConvertWidthMode)
    : "off";
}

export function isTextConvertDisplayActive(
  zh: TextConvertZhMode,
  letter: TextConvertWidthMode,
  digit: TextConvertWidthMode,
): boolean {
  return zh !== "off" || letter !== "off" || digit !== "off";
}
