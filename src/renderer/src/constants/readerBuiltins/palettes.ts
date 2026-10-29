/**
 * 内置阅读器配色方案目录（单侧：`theme` + 9 色 + `textureId`）。
 * 按 id 选中、用户方案、落盘见 `readerPalettePresets.ts`。
 */
import {
  defaultReaderPaletteDark,
  defaultReaderPaletteLight,
  READER_SURFACE_KEYS,
  type ReaderSurfacePalette,
} from "../readerPalette";
import { READER_BACKGROUND_NONE_ID } from "./textures";

export type ReaderPaletteThemeSide = "light" | "dark";

/** 与 `readerPalettePresets.ReaderPalettePreset` 同形，避免与逻辑模块循环引用 */
export type BuiltinPalettePreset = {
  id: string;
  name: string;
  theme: ReaderPaletteThemeSide;
  palette: ReaderSurfacePalette & { textureId: string };
};

export const DEFAULT_READER_PALETTE_PRESET_ID = "default";
export const DEFAULT_READER_PALETTE_PRESET_ID_DARK = "default-dark";

export function defaultReaderPalettePresetId(
  theme: ReaderPaletteThemeSide,
): string {
  return theme === "dark"
    ? DEFAULT_READER_PALETTE_PRESET_ID_DARK
    : DEFAULT_READER_PALETTE_PRESET_ID;
}

function assertFullPalette(
  id: string,
  theme: ReaderPaletteThemeSide,
  palette: ReaderSurfacePalette,
): ReaderSurfacePalette {
  for (const key of READER_SURFACE_KEYS) {
    if (!palette[key]) {
      throw new Error(`配色方案「${id}」${theme} 缺少 ${key}`);
    }
  }
  return palette;
}

type PaletteInput = ReaderSurfacePalette & { textureId?: string };

function preset(
  id: string,
  name: string,
  theme: ReaderPaletteThemeSide,
  palette: PaletteInput,
): BuiltinPalettePreset {
  return {
    id,
    name,
    theme,
    palette: {
      ...assertFullPalette(id, theme, palette),
      textureId: palette.textureId ?? READER_BACKGROUND_NONE_ID,
    },
  };
}

/** 内置方案（亮/暗分列；「默认」为现有阅读器色） */
export const BUILTIN_READER_PALETTE_PRESETS: readonly BuiltinPalettePreset[] = [
  preset(DEFAULT_READER_PALETTE_PRESET_ID, "默认", "light", {
    ...defaultReaderPaletteLight,
  }),
  preset(DEFAULT_READER_PALETTE_PRESET_ID_DARK, "默认", "dark", {
    ...defaultReaderPaletteDark,
  }),
  preset("paperTexture", "素纸", "light", {
    readerBg: "#ffffff",
    chapterTitle: "#b88230",
    bodyText: "#000000",
    txtrQuoteInner: "#a31515",
    txtrBracketInner: "#001080",
    txtrPunctuation: "#267f99",
    txtrSpecialMarker: "#f56c6c",
    txtrNumber: "#795e26",
    txtrEnglish: "#af00db",
    textureId: "paper",
  }),
  preset("paperTexture-dark", "素纸", "dark", {
    readerBg: "#0d0d0d",
    chapterTitle: "#d6b866",
    bodyText: "#f2f2f2",
    txtrQuoteInner: "#d88d6e",
    txtrBracketInner: "#9bdcfd",
    txtrPunctuation: "#4ec9b0",
    txtrSpecialMarker: "#f56c6c",
    txtrNumber: "#dcdcaa",
    txtrEnglish: "#ce7ec9",
    textureId: "paper",
  }),
  preset("parchmentTexture", "羊皮纸", "light", {
    readerBg: "#f4d8a6",
    chapterTitle: "#0f4a85",
    bodyText: "#292929",
    txtrQuoteInner: "#811f3f",
    txtrBracketInner: "#185e73",
    txtrPunctuation: "#7d5921",
    txtrSpecialMarker: "#ce4b4b",
    txtrNumber: "#298160",
    txtrEnglish: "#5e2cbc",
    textureId: "parchment",
  }),
  preset("parchmentTexture-dark", "羊皮纸", "dark", {
    readerBg: "#21201c",
    chapterTitle: "#569cd6",
    bodyText: "#e2e2e2",
    txtrQuoteInner: "#e591ae",
    txtrBracketInner: "#84c8dd",
    txtrPunctuation: "#b98d4a",
    txtrSpecialMarker: "#dc6d6d",
    txtrNumber: "#91d8bd",
    txtrEnglish: "#bb95ff",
    textureId: "parchment",
  }),
  preset("eye-green", "护眼", "light", {
    readerBg: "#e6eace",
    chapterTitle: "#177b4d",
    bodyText: "#232c16",
    txtrQuoteInner: "#8a4e2c",
    txtrBracketInner: "#1a4060",
    txtrPunctuation: "#2a6b5a",
    txtrSpecialMarker: "#c45c4c",
    txtrNumber: "#5a6020",
    txtrEnglish: "#5a2a7a",
    textureId: "eye-green",
  }),
  preset("eye-green-dark", "护眼", "dark", {
    readerBg: "#333627",
    chapterTitle: "#a6d608",
    bodyText: "#d8deba",
    txtrQuoteInner: "#e0b070",
    txtrBracketInner: "#9cc8e0",
    txtrPunctuation: "#7ec9a0",
    txtrSpecialMarker: "#f08070",
    txtrNumber: "#c8d080",
    txtrEnglish: "#c8a0d0",
    textureId: "eye-green",
  }),
  preset("plush-rug", "毛绒地毯", "light", {
    readerBg: "#faf0e8",
    chapterTitle: "#c9887a",
    bodyText: "#5a453c",
    txtrQuoteInner: "#6e52a8",
    txtrBracketInner: "#5c6e94",
    txtrPunctuation: "#639c89",
    txtrSpecialMarker: "#b06888",
    txtrNumber: "#e07020",
    txtrEnglish: "#d05878",
    textureId: "plush-rug",
  }),
  preset("plush-rug-dark", "毛绒地毯", "dark", {
    readerBg: "#342c2a",
    chapterTitle: "#e8b0a0",
    bodyText: "#efe4dc",
    txtrQuoteInner: "#d4c0f4",
    txtrBracketInner: "#c4d2ea",
    txtrPunctuation: "#9cc8b8",
    txtrSpecialMarker: "#e8a8d0",
    txtrNumber: "#f0c060",
    txtrEnglish: "#e09aa8",
    textureId: "plush-rug",
  }),
  preset("bamboo", "墨竹", "light", {
    readerBg: "#e6eace",
    chapterTitle: "#177b4d",
    bodyText: "#232c16",
    txtrQuoteInner: "#9c3470",
    txtrBracketInner: "#1a4060",
    txtrPunctuation: "#2a6b5a",
    txtrSpecialMarker: "#c45c4c",
    txtrNumber: "#5a6020",
    txtrEnglish: "#5a2a7a",
    textureId: "bamboo-grove",
  }),
  preset("bamboo-dark", "墨竹", "dark", {
    readerBg: "#333627",
    chapterTitle: "#a6d608",
    bodyText: "#d8deba",
    txtrQuoteInner: "#f2b0d0",
    txtrBracketInner: "#9cc8e0",
    txtrPunctuation: "#7ec9a0",
    txtrSpecialMarker: "#f08070",
    txtrNumber: "#c8d080",
    txtrEnglish: "#c8a0d0",
    textureId: "bamboo-grove",
  }),
  preset("plum-blossom", "雪梅", "light", {
    readerBg: "#7f8f9f",
    chapterTitle: "#3d6494",
    bodyText: "#2e3440",
    txtrQuoteInner: "#5e81ac",
    txtrBracketInner: "#5c9d66",
    txtrPunctuation: "#bba163",
    txtrSpecialMarker: "#bf616a",
    txtrNumber: "#c47eb7",
    txtrEnglish: "#c07850",
    textureId: "plum-blossom",
  }),
  preset("plum-blossom-dark", "雪梅", "dark", {
    readerBg: "#33363b",
    chapterTitle: "#88c0d0",
    bodyText: "#d8dee9",
    txtrQuoteInner: "#81a1c1",
    txtrBracketInner: "#a3be8c",
    txtrPunctuation: "#c5b487",
    txtrSpecialMarker: "#bf616a",
    txtrNumber: "#b98ab0",
    txtrEnglish: "#d08770",
    textureId: "plum-blossom",
  }),
  preset("sky-dark", "星空", "dark", {
    readerBg: "#03040c",
    chapterTitle: "#e8b06a",
    bodyText: "#f0e0c8",
    txtrQuoteInner: "#cbb8f5",
    txtrBracketInner: "#acd1ff",
    txtrPunctuation: "#78c8b0",
    txtrSpecialMarker: "#f0a080",
    txtrNumber: "#e0c080",
    txtrEnglish: "#d0a0c0",
    textureId: "night-sky",
  }),
];

const BUILTIN_ID_SET = new Set(
  BUILTIN_READER_PALETTE_PRESETS.map((p) => p.id),
);

export function isBuiltinReaderPalettePresetId(id: string): boolean {
  return BUILTIN_ID_SET.has(id);
}

export function getBuiltinReaderPalettePreset(
  id: string,
): BuiltinPalettePreset | undefined {
  return BUILTIN_READER_PALETTE_PRESETS.find((p) => p.id === id);
}

export function listBuiltinReaderPalettePresets(
  theme: ReaderPaletteThemeSide,
): BuiltinPalettePreset[] {
  return BUILTIN_READER_PALETTE_PRESETS.filter((p) => p.theme === theme);
}
