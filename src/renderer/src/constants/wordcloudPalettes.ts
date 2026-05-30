/** 词云配色方案（参考 d3 分类色板与 Jason Davies Word Cloud 常见 palette） */

export type WordcloudPaletteId =
  | "category10"
  | "category20"
  | "pastel"
  | "paired"
  | "dark"
  | "accent"
  | "warm"
  | "cool";

export const WORDCLOUD_DEFAULT_PALETTE_ID: WordcloudPaletteId = "category10";

export type WordcloudPaletteDef = {
  id: WordcloudPaletteId;
  /** 根据主色组成命名的展示名 */
  label: string;
  colors: readonly string[];
};

export const WORDCLOUD_PALETTES: readonly WordcloudPaletteDef[] = [
  {
    id: "category10",
    label: "缤纷十色",
    colors: [
      "#1f77b4",
      "#ff7f0e",
      "#2ca02c",
      "#d62728",
      "#9467bd",
      "#8c564b",
      "#e377c2",
      "#7f7f7f",
      "#bcbd22",
      "#17becf",
    ],
  },
  {
    id: "category20",
    label: "缤纷二十",
    colors: [
      "#1f77b4",
      "#aec7e8",
      "#ff7f0e",
      "#ffbb78",
      "#2ca02c",
      "#98df8a",
      "#d62728",
      "#ff9896",
      "#9467bd",
      "#c5b0d5",
      "#8c564b",
      "#c49c94",
      "#e377c2",
      "#f7b6d2",
      "#7f7f7f",
      "#c7c7c7",
      "#bcbd22",
      "#dbdb8d",
      "#17becf",
      "#9edae5",
    ],
  },
  {
    id: "pastel",
    label: "马卡龙粉彩",
    colors: [
      "#fbb4ae",
      "#b3cde3",
      "#ccebc5",
      "#decbe4",
      "#fed9a6",
      "#ffffcc",
      "#e5d8bd",
      "#fddaec",
      "#f2f2f2",
    ],
  },
  {
    id: "paired",
    label: "蓝绿配对",
    colors: [
      "#a6cee3",
      "#1f78b4",
      "#b2df8a",
      "#33a02c",
      "#fb9a99",
      "#e31a1c",
      "#fdbf6f",
      "#ff7f00",
      "#cab2d6",
      "#6a3d9a",
    ],
  },
  {
    id: "dark",
    label: "沉稳暗彩",
    colors: [
      "#1b9e77",
      "#d95f02",
      "#7570b3",
      "#e7298a",
      "#66a61e",
      "#e6ab02",
      "#a6761d",
      "#666666",
    ],
  },
  {
    id: "accent",
    label: "鲜明点缀",
    colors: [
      "#7fc97f",
      "#beaed4",
      "#fdc086",
      "#ffff99",
      "#386cb0",
      "#f0027f",
      "#bf5b17",
      "#666666",
    ],
  },
  {
    id: "warm",
    label: "暖色落日",
    colors: [
      "#d73027",
      "#f46d43",
      "#fdae61",
      "#fee08b",
      "#e6550d",
      "#fd8d3c",
      "#fc4e2a",
      "#b30000",
    ],
  },
  {
    id: "cool",
    label: "清凉海洋",
    colors: [
      "#08519c",
      "#3182bd",
      "#6baed6",
      "#9ecae1",
      "#238b45",
      "#41ab5d",
      "#74c476",
      "#225ea8",
    ],
  },
] as const;

const PALETTE_BY_ID = new Map(
  WORDCLOUD_PALETTES.map((p) => [p.id, p] as const),
);

export function parseWordcloudPaletteId(
  value: unknown,
): WordcloudPaletteId | null {
  if (typeof value !== "string") return null;
  return PALETTE_BY_ID.has(value as WordcloudPaletteId)
    ? (value as WordcloudPaletteId)
    : null;
}

export function getWordcloudPalette(
  id: WordcloudPaletteId,
): WordcloudPaletteDef {
  return PALETTE_BY_ID.get(id) ?? PALETTE_BY_ID.get("category10")!;
}

export function wordcloudPaletteLabel(id: WordcloudPaletteId): string {
  return getWordcloudPalette(id).label;
}
