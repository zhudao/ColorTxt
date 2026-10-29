/**
 * 系统字体列表：默认只列字体族；可选按字重拆开。
 * 列表预览用真实系统族名 + font-weight（即时渲染）；
 * 展示文案可带「细体 / 中等」后缀。
 * 同族多字重选中时才用别名 + @font-face 锁到具体文件。
 */

export type RawSystemFontFace = {
  family: string;
  /** 样式名，如 Regular、Bold Italic、W3、常规 */
  style: string;
  postscriptName: string;
  /** 额外的 local() 候选（全名、本地化「族名 样式」） */
  localNames: string[];
  /** 同族内排序；各平台量纲可以不同 */
  weight: number;
  italic: boolean;
  /** Windows GlyphTypeface.FontUri 等 file:// 路径；渲染前会换成 colortxt-local */
  fileUrl?: string;
  /** 绝对路径；重启后重新 register colortxt-local 用（与 fileUrl 并存） */
  filePath?: string;
};

export type ListedSystemFont = {
  /** 列表展示文案（可含字重后缀） */
  label: string;
  /** 稳定族名（跨「字体族 / 区分字重」模式匹配用，不含字重后缀） */
  family: string;
  /** 列表预览用真实系统族名 */
  previewFamily: string;
  /** 列表预览用 CSS font-weight（约 100–900） */
  previewWeight: number;
  /** 列表预览用是否斜体（CSS font-style） */
  previewItalic: boolean;
  /**
   * 选中后写入设置的 font-family。
   * 等于 previewFamily 时直接用系统族；否则为锁字重别名，需 @font-face。
   */
  cssFamily: string;
  /**
   * 非空时注入 @font-face，用这些名字做 local()。
   * 仅当 cssFamily 为别名时需要。
   */
  locals: string[];
  /** 有值时 @font-face 优先用 url()（通常为 colortxt-local） */
  fileUrl?: string;
  /** 绝对路径，供 pin 缓存跨启动重新注册 */
  filePath?: string;
};

type ListedInternal = ListedSystemFont & {
  rank: number;
};

/** 是否需要为选中项注入 @font-face 别名 */
export function listedFontNeedsFacePin(font: ListedSystemFont): boolean {
  return font.cssFamily !== font.previewFamily;
}

const WEIGHT_WORDS: Record<string, { zh: string; rank: number }> = {
  hairline: { zh: "极细", rank: 100 },
  ultralight: { zh: "极细", rank: 120 },
  ultrathin: { zh: "极细", rank: 120 },
  thin: { zh: "纤细", rank: 150 },
  extralight: { zh: "特细", rank: 200 },
  light: { zh: "细体", rank: 300 },
  regular: { zh: "常规", rank: 400 },
  normal: { zh: "常规", rank: 400 },
  roman: { zh: "常规", rank: 400 },
  book: { zh: "常规", rank: 400 },
  medium: { zh: "中黑", rank: 500 },
  semibold: { zh: "中粗", rank: 600 },
  demibold: { zh: "中粗", rank: 600 },
  bold: { zh: "粗体", rank: 700 },
  extrabold: { zh: "特粗", rank: 800 },
  ultrabold: { zh: "特粗", rank: 800 },
  heavy: { zh: "特粗", rank: 850 },
  black: { zh: "超粗", rank: 900 },
};

const WIDTH_WORDS: Record<string, string> = {
  condensed: "窄体",
  narrow: "窄体",
  semicondensed: "窄体",
  extracondensed: "窄体",
  ultracondensed: "窄体",
  expanded: "宽体",
  extended: "宽体",
  semiexpanded: "宽体",
  extraexpanded: "宽体",
  ultraexpanded: "宽体",
};

const ITALIC_WORDS = new Set(["italic", "oblique"]);

const ZH_RANKS: readonly [string, number][] = [
  ["极细", 100],
  ["超细", 120],
  ["纤细", 150],
  ["特细", 200],
  ["细体", 300],
  ["常规", 400],
  ["标准", 400],
  ["正常", 400],
  ["中等", 500],
  ["中黑", 500],
  ["半粗", 600],
  ["中粗", 600],
  ["粗体", 700],
  ["特粗", 850],
  ["超粗", 900],
  ["浓黑", 900],
];

function quoteCssFamily(name: string): string {
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function combineStyleTokens(style: string): string[] {
  const parts = style
    .split(/[\s_+-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const cur = parts[i]!.toLowerCase();
    const next = parts[i + 1]?.toLowerCase();
    if (
      next &&
      (cur === "extra" || cur === "ultra" || cur === "semi" || cur === "demi")
    ) {
      out.push(cur + next);
      i++;
      continue;
    }
    out.push(parts[i]!);
  }
  return out;
}

function chineseStyleRank(style: string, weight: number): number {
  let best = 0;
  for (const [word, rank] of ZH_RANKS) {
    if (style.includes(word) && rank > best) best = rank;
  }
  return best || (weight > 0 ? weight : 400);
}

function appendItalicLabel(text: string, italic: boolean): string {
  if (!italic) return text;
  if (/斜|italic|oblique/i.test(text)) return text;
  return text ? `${text} 斜体` : "斜体";
}

/**
 * 样式名是货号 / W3 这类代号时，不宜直接拼进展示名
 * （族名里往往已有 101、201；应改用 OpenType 字重译名）。
 */
function isUnhelpfulStyleLabel(label: string): boolean {
  const t = label.trim();
  if (!t) return true;
  if (/^\d+$/.test(t)) return true;
  if (/^w\d+$/i.test(t)) return true;
  return false;
}

/**
 * 由 OpenType / CSS 字重近似到中文标签（对齐资源管理器常见叫法）。
 * 仅接受 ≥100 的 OpenType 量纲；macOS 的 0–15 不算，避免误标。
 */
function openTypeWeightSuffix(
  weight: number,
  italic: boolean,
): { text: string; rank: number } | null {
  if (!(weight >= 100)) {
    return italic ? { text: "斜体", rank: 400 } : null;
  }
  let text: string;
  let rank: number;
  if (weight <= 150) {
    text = "极细";
    rank = 100;
  } else if (weight <= 250) {
    text = "特细";
    rank = 200;
  } else if (weight <= 350) {
    text = "细体";
    rank = 300;
  } else if (weight <= 450) {
    text = "常规";
    rank = 400;
  } else if (weight <= 550) {
    text = "中等";
    rank = 500;
  } else if (weight <= 650) {
    text = "半粗体";
    rank = 600;
  } else if (weight <= 750) {
    text = "粗体";
    rank = 700;
  } else if (weight <= 850) {
    text = "特粗";
    rank = 850;
  } else {
    text = "超粗";
    rank = 900;
  }
  return { text: appendItalicLabel(text, italic), rank };
}

function styleSuffix(
  style: string,
  italic: boolean,
  weight: number,
): { text: string; rank: number } {
  const trimmed = style.trim();

  if (!trimmed) {
    return { text: italic ? "斜体" : "", rank: 400 };
  }
  if (hasCjk(trimmed)) {
    return {
      text: appendItalicLabel(trimmed, italic),
      rank: chineseStyleRank(trimmed, weight),
    };
  }

  const tokens = combineStyleTokens(trimmed);
  const widths: string[] = [];
  const weights: { text: string; rank: number }[] = [];
  let sawItalic = false;
  for (const token of tokens) {
    const key = token.toLowerCase().replace(/-/g, "");
    if (ITALIC_WORDS.has(key)) {
      sawItalic = true;
      continue;
    }
    const width = WIDTH_WORDS[key];
    if (width) {
      if (!widths.includes(width)) widths.push(width);
      continue;
    }
    const mapped = WEIGHT_WORDS[key];
    if (mapped) {
      weights.push({ text: mapped.zh, rank: mapped.rank });
      continue;
    }
    return {
      text: appendItalicLabel(trimmed, italic),
      rank: weight > 0 ? weight : 400,
    };
  }

  weights.sort((a, b) => a.rank - b.rank);
  const rank = weights.length > 0 ? weights[weights.length - 1]!.rank : 400;
  const pieces = [
    ...widths,
    ...weights.map((item) => item.text),
  ];
  if (sawItalic || italic) pieces.push("斜体");
  return { text: pieces.join(" "), rank };
}

/** Win32 常把 Light/SemiBold 也标成 Regular/Bold，需改信 OpenType 字重。 */
function isGenericFaceStyle(style: string): boolean {
  return /^(regular|normal|roman|book|bold)$/i.test(style.trim());
}

/**
 * 解析展示用字重后缀。
 * Regular@300 → 细体；Bold@600 → 半粗体；货号样式 → 按字重；W3 等仍保留原文。
 */
function resolveFaceSuffix(
  face: RawSystemFontFace,
): { text: string; rank: number } | null {
  const fromWeight = openTypeWeightSuffix(face.weight, face.italic);
  const fromStyle = styleSuffix(face.style, face.italic, face.weight);
  if (fromWeight && isGenericFaceStyle(face.style)) {
    return fromWeight;
  }
  if (fromStyle.text && !isUnhelpfulStyleLabel(fromStyle.text)) {
    return fromStyle;
  }
  if (fromWeight) return fromWeight;
  return fromStyle.text ? fromStyle : null;
}

/**
 * WPF 常对同一 Win32 style 再挂合成粗体 / 斜体；
 * 按 style 合并后优先正体、再取最轻设计字重。
 */
function collapseLikelySimulatedFaces(
  faces: RawSystemFontFace[],
): RawSystemFontFace[] {
  const groups = new Map<string, RawSystemFontFace[]>();
  for (const face of faces) {
    const key = face.style.toLowerCase();
    const list = groups.get(key);
    if (list) list.push(face);
    else groups.set(key, [face]);
  }
  const out: RawSystemFontFace[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]!);
      continue;
    }
    group.sort(
      (a, b) =>
        Number(a.italic) - Number(b.italic) ||
        a.weight - b.weight ||
        a.postscriptName.localeCompare(b.postscriptName),
    );
    out.push(group[0]!);
  }
  return out;
}

function normalizeFontFileUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).href;
  } catch {
    return trimmed;
  }
}

function previewWeightFromRank(rank: number, faceWeight: number): number {
  if (rank >= 100 && rank <= 1000) return rank;
  if (faceWeight >= 100 && faceWeight <= 1000) return faceWeight;
  return 400;
}

/** 同族多字重：展示带后缀，预览用真实族+字重，选中用别名锁文件 */
function pinnedFaceEntry(
  family: string,
  face: RawSystemFontFace,
  suffix: { text: string; rank: number },
): ListedInternal | null {
  if (!suffix.text) return null;
  let locals = faceLocals(face);
  const fileUrl = normalizeFontFileUrl(face.fileUrl);
  if (locals.length === 0 && !fileUrl) locals = [family];
  if (family === suffix.text || family.endsWith(` ${suffix.text}`)) {
    return familyEntry(family);
  }
  const label = `${family} ${suffix.text}`;
  const filePath = face.filePath?.trim() || undefined;
  const previewItalic = face.italic || /斜/.test(suffix.text);
  return {
    label,
    previewFamily: family,
    previewWeight: previewWeightFromRank(suffix.rank, face.weight),
    previewItalic,
    cssFamily: label,
    locals,
    fileUrl,
    ...(filePath ? { filePath } : {}),
    family,
    rank: suffix.rank,
  };
}

/** 单设计字重：后缀仅作文案，预览与选中都用真实族名（即时、无 @font-face） */
function labeledFamilyEntry(
  family: string,
  face: RawSystemFontFace,
): ListedInternal {
  const suffix = resolveFaceSuffix(face);
  if (
    !suffix?.text ||
    family === suffix.text ||
    family.endsWith(` ${suffix.text}`)
  ) {
    return familyEntry(family);
  }
  return {
    label: `${family} ${suffix.text}`,
    previewFamily: family,
    previewWeight: previewWeightFromRank(suffix.rank, face.weight),
    previewItalic: face.italic || /斜/.test(suffix.text),
    cssFamily: family,
    locals: [],
    family,
    rank: suffix.rank,
  };
}

function normalizeFace(face: RawSystemFontFace): RawSystemFontFace | null {
  if (!face || typeof face.family !== "string") return null;
  const family = face.family.trim();
  if (!family || family.startsWith(".")) return null;
  const localNames = Array.isArray(face.localNames)
    ? face.localNames.filter((name): name is string => typeof name === "string")
    : [];
  return {
    family,
    style: typeof face.style === "string" ? face.style.trim() : "",
    postscriptName:
      typeof face.postscriptName === "string" ? face.postscriptName.trim() : "",
    localNames,
    weight:
      typeof face.weight === "number" && Number.isFinite(face.weight)
        ? face.weight
        : 0,
    italic: Boolean(face.italic),
    fileUrl: normalizeFontFileUrl(face.fileUrl),
    filePath:
      typeof face.filePath === "string" && face.filePath.trim()
        ? face.filePath.trim()
        : undefined,
  };
}

function faceLocals(face: RawSystemFontFace): string[] {
  const out: string[] = [];
  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === face.family || out.includes(trimmed)) return;
    out.push(trimmed);
  };
  add(face.postscriptName);
  for (const name of face.localNames) add(name);
  // 具体字重名解析失败时，仍落到该族，而不是换成完全无关的字体
  if (out.length > 0) out.push(face.family);
  return out;
}

function dedupeFaces(faces: RawSystemFontFace[]): RawSystemFontFace[] {
  const seen = new Set<string>();
  const out: RawSystemFontFace[] = [];
  for (const face of faces) {
    const key =
      face.postscriptName ||
      `${face.style.toLowerCase()}|${face.italic ? 1 : 0}|${face.weight}|${face.localNames.join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(face);
  }
  return out;
}

function familyEntry(family: string): ListedInternal {
  return {
    label: family,
    previewFamily: family,
    previewWeight: 400,
    previewItalic: false,
    cssFamily: family,
    locals: [],
    family,
    rank: 0,
  };
}

export function familyNamesToRawFaces(
  names: readonly string[],
): RawSystemFontFace[] {
  const seen = new Set<string>();
  const out: RawSystemFontFace[] = [];
  for (const name of names) {
    const family = name.trim();
    if (!family || seen.has(family)) continue;
    seen.add(family);
    out.push({
      family,
      style: "",
      postscriptName: "",
      localNames: [],
      weight: 0,
      italic: false,
    });
  }
  return out;
}

/**
 * WPF / 平台枚举常漏掉仅注册在 GDI 的中文字体（方正、华康等）。
 * 用 font-list 族名补齐缺失项，已有 face 保留字重信息。
 */
export function mergeLegacyFamilyNames(
  faces: readonly RawSystemFontFace[],
  legacyNames: readonly string[],
): RawSystemFontFace[] {
  const seen = new Set<string>();
  for (const face of faces) {
    const family = face.family.trim();
    if (family) seen.add(family);
  }
  if (seen.size === 0) return familyNamesToRawFaces(legacyNames);
  const missing = legacyNames.filter((name) => {
    const family = name.trim();
    return family.length > 0 && !seen.has(family);
  });
  if (missing.length === 0) return [...faces];
  return [...faces, ...familyNamesToRawFaces(missing)];
}

function groupFacesByFamily(
  raw: readonly RawSystemFontFace[],
): Map<string, RawSystemFontFace[]> {
  const groups = new Map<string, RawSystemFontFace[]>();
  for (const item of raw) {
    const face = normalizeFace(item);
    if (!face) continue;
    const list = groups.get(face.family);
    if (list) list.push(face);
    else groups.set(face.family, [face]);
  }
  return groups;
}

function finalizeListed(listed: ListedInternal[]): ListedSystemFont[] {
  const counts = new Map<string, number>();
  for (const item of listed) {
    counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  for (const item of listed) {
    if ((counts.get(item.label) ?? 0) < 2) continue;
    const n = (seen.get(item.label) ?? 0) + 1;
    seen.set(item.label, n);
    const tag = item.locals[0] || item.cssFamily || String(n);
    const suffix = ` (${tag})`;
    item.label = `${item.label}${suffix}`;
    if (listedFontNeedsFacePin(item)) {
      item.cssFamily = `${item.cssFamily}${suffix}`;
    }
  }

  listed.sort((a, b) => {
    const byFamily = a.family.localeCompare(b.family, "zh-Hans-CN");
    if (byFamily !== 0) return byFamily;
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.previewItalic !== b.previewItalic) return a.previewItalic ? 1 : -1;
    return a.label.localeCompare(b.label, "zh-Hans-CN");
  });

  return listed.map(
    ({
      label,
      family,
      previewFamily,
      previewWeight,
      previewItalic,
      cssFamily,
      locals,
      fileUrl,
      filePath,
    }) => ({
      label,
      family,
      previewFamily,
      previewWeight,
      previewItalic,
      cssFamily,
      locals,
      ...(fileUrl ? { fileUrl } : {}),
      ...(filePath ? { filePath } : {}),
    }),
  );
}

/**
 * 不区分字重：每个族一行，只显示族名（与启用字重拆分前一致，不加后缀）。
 */
export function buildCollapsedSystemFonts(
  raw: readonly RawSystemFontFace[],
): ListedSystemFont[] {
  const listed: ListedInternal[] = [];
  for (const [family] of groupFacesByFamily(raw)) {
    listed.push(familyEntry(family));
  }
  return finalizeListed(listed);
}

/** 折叠列表的展示文案（默认「不区分字重」）。 */
export function buildSystemFontFamilyNames(
  raw: readonly RawSystemFontFace[],
): string[] {
  return buildCollapsedSystemFonts(raw).map((font) => font.label);
}

/** 按字重拆开展示（「区分字重」开启时）。 */
export function buildListedSystemFonts(
  raw: readonly RawSystemFontFace[],
): ListedSystemFont[] {
  const listed: ListedInternal[] = [];
  for (const [family, faces] of groupFacesByFamily(raw)) {
    const unique = collapseLikelySimulatedFaces(dedupeFaces(faces));
    if (unique.length <= 1) {
      const only = unique[0];
      listed.push(only ? labeledFamilyEntry(family, only) : familyEntry(family));
      continue;
    }
    const pinned: ListedInternal[] = [];
    for (const face of unique) {
      const suffix = resolveFaceSuffix(face);
      if (!suffix) continue;
      const entry = pinnedFaceEntry(family, face, suffix);
      if (entry && (entry.locals.length > 0 || entry.fileUrl)) pinned.push(entry);
    }
    if (pinned.length <= 1) {
      const only = unique[0]!;
      listed.push(labeledFamilyEntry(family, only));
      continue;
    }
    listed.push(...pinned);
  }
  return finalizeListed(listed);
}

/**
 * 仅为需要锁字重的别名生成 @font-face（font-weight: normal）。
 * 列表预览不走这里，避免异步加载闪烁。
 */
export function buildSystemFontFaceCss(fonts: readonly ListedSystemFont[]): string {
  const rules: string[] = [];
  for (const font of fonts) {
    if (!listedFontNeedsFacePin(font)) continue;
    const srcParts: string[] = [];
    const fileUrl = normalizeFontFileUrl(font.fileUrl);
    if (fileUrl) srcParts.push(`url(${JSON.stringify(fileUrl)})`);
    for (const name of font.locals) {
      srcParts.push(`local(${quoteCssFamily(name)})`);
    }
    if (srcParts.length === 0) continue;
    rules.push(
      `@font-face{font-family:${quoteCssFamily(font.cssFamily)};src:${srcParts.join(",")};font-weight:normal;font-style:normal;font-display:swap;}`,
    );
  }
  return rules.join("\n");
}
