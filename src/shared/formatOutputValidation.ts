import type { AiSmartFormatUnifyDialogueQuotes } from "./aiSmartFormatTypes";

const CORE_STRIP_PUNCT_RE =
  /[\u201c\u201d\u2018\u2019，。！？、；：""''「」『』《》【】（）()\[\]{}…—\-·,.!?;:'"`~@#$%^&*+=|\\/<>]/;
const CORE_STRIP_WS_RE = /[\s\r\n\t\u3000\u00a0]/;
/** 结构助词「的/地/得」：网络小说口语常混用，智能排版不应互替 */
const DE_DI_DE_PARTICLES = new Set(["的", "地", "得"]);

function isFormatCoreChar(ch: string): boolean {
  return !CORE_STRIP_WS_RE.test(ch) && !CORE_STRIP_PUNCT_RE.test(ch);
}

/** 提取用于保真校验的核心字序（去空白与常见标点） */
export function extractCoreCharSequence(text: string): string {
  let out = "";
  for (const ch of text) {
    if (isFormatCoreChar(ch)) out += ch;
  }
  return out;
}

/**
 * 将输出中相对输入发生的「的/地/得」互替还原为原文用字。
 * 按核心字序双指针对齐；遇删增时小窗前瞻重同步，避免误伤乱码/屏蔽还原。
 */
export function revertDeDiDeParticleSubstitutions(
  input: string,
  output: string,
): string {
  if (!input || !output || input === output) return output;
  const inn = Array.from(input);
  const out = Array.from(output);
  let i = 0;
  let j = 0;
  const LOOK = 12;

  const nextCore = (
    chars: string[],
    start: number,
  ): { ch: string; idx: number } | null => {
    for (let k = start; k < chars.length; k++) {
      const ch = chars[k]!;
      if (isFormatCoreChar(ch)) return { ch, idx: k };
    }
    return null;
  };

  while (i < inn.length && j < out.length) {
    const a = nextCore(inn, i);
    const b = nextCore(out, j);
    if (!a || !b) break;
    i = a.idx;
    j = b.idx;
    if (a.ch === b.ch) {
      i++;
      j++;
      continue;
    }
    if (DE_DI_DE_PARTICLES.has(a.ch) && DE_DI_DE_PARTICLES.has(b.ch)) {
      out[j] = a.ch;
      i++;
      j++;
      continue;
    }
    // 输入侧被删：在后续窗口内找与当前输出字对齐的位置
    let resynced = false;
    for (let k = 1; k <= LOOK && i + k < inn.length; k++) {
      const ch = inn[i + k]!;
      if (!isFormatCoreChar(ch)) continue;
      if (
        ch === b.ch ||
        (DE_DI_DE_PARTICLES.has(ch) && DE_DI_DE_PARTICLES.has(b.ch))
      ) {
        i = i + k;
        resynced = true;
        break;
      }
    }
    if (resynced) continue;
    // 输出侧插入：跳过输出窗口
    for (let k = 1; k <= LOOK && j + k < out.length; k++) {
      const ch = out[j + k]!;
      if (!isFormatCoreChar(ch)) continue;
      if (
        ch === a.ch ||
        (DE_DI_DE_PARTICLES.has(ch) && DE_DI_DE_PARTICLES.has(a.ch))
      ) {
        j = j + k;
        resynced = true;
        break;
      }
    }
    if (resynced) continue;
    // 其它一对一替换（乱码/屏蔽还原等）：保留输出，继续对齐
    i++;
    j++;
  }
  return out.join("");
}

export type FormatOutputValidationResult = {
  ok: boolean;
  reason?: string;
  similarity?: number;
};

function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 0),
  );
  for (let i = 0; i < rows; i++) matrix[i]![0] = i;
  for (let j = 0; j < cols; j++) matrix[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }
  const dist = matrix[a.length]![b.length]!;
  const maxLen = Math.max(a.length, b.length);
  return 1 - dist / maxLen;
}

/** 输出核心字序是否为输入的子序列（仅允许删字，顺序不变） */
export function isCoreCharSubsequence(input: string, output: string): boolean {
  const coreIn = extractCoreCharSequence(input);
  const coreOut = extractCoreCharSequence(output);
  if (coreOut.length === 0) return true;
  let j = 0;
  for (let i = 0; i < coreOut.length; i++) {
    const ch = coreOut[i]!;
    while (j < coreIn.length && coreIn[j] !== ch) j++;
    if (j >= coreIn.length) return false;
    j++;
  }
  return true;
}

function coreSimilarityMin(opts?: {
  restoreGarbledChars?: boolean;
  restoreAsteriskMasks?: boolean;
}): number {
  if (opts?.restoreGarbledChars && opts?.restoreAsteriskMasks) return 0.96;
  if (opts?.restoreGarbledChars) return 0.98;
  if (opts?.restoreAsteriskMasks) return 0.97;
  return 1;
}

export function validateFormatOutputPreserved(
  input: string,
  output: string,
  opts?: {
    restoreGarbledChars?: boolean;
    restoreAsteriskMasks?: boolean;
    fixPunctuation?: boolean;
    unifyDialogueQuotes?: AiSmartFormatUnifyDialogueQuotes;
    removePromotionalContent?: boolean;
    removePiracyWatermarks?: boolean;
    maxLengthDeviationRatio?: number;
  },
): FormatOutputValidationResult {
  const allowsPunctuationEdits =
    opts?.fixPunctuation === true ||
    (opts?.unifyDialogueQuotes != null && opts.unifyDialogueQuotes !== "none");
  const allowsDeletion =
    opts?.removePromotionalContent === true ||
    opts?.removePiracyWatermarks === true;
  const allowsCoreSubstitution =
    opts?.restoreGarbledChars === true || opts?.restoreAsteriskMasks === true;
  const minCoreSim = coreSimilarityMin(opts);

  let maxIncreaseDev =
    opts?.maxLengthDeviationRatio ??
    (allowsPunctuationEdits ? 0.28 : allowsDeletion ? 0.1 : 0.15);
  if (opts?.restoreAsteriskMasks && !allowsPunctuationEdits) {
    maxIncreaseDev = Math.max(maxIncreaseDev, 0.12);
  }
  const maxDecreaseDev = allowsDeletion ? 0.5 : maxIncreaseDev;

  if (input.length > 0) {
    const diff = output.length - input.length;
    if (diff > 0 && diff / input.length > maxIncreaseDev) {
      return {
        ok: false,
        reason: `输出长度增加 ${((diff / input.length) * 100).toFixed(0)}% 超过阈值`,
      };
    }
    if (diff < 0 && -diff / input.length > maxDecreaseDev) {
      return {
        ok: false,
        reason: `输出长度减少 ${((-diff / input.length) * 100).toFixed(0)}% 超过阈值`,
      };
    }
  }

  const coreIn = extractCoreCharSequence(input);
  const coreOut = extractCoreCharSequence(output);

  if (allowsDeletion) {
    if (isCoreCharSubsequence(input, output)) {
      return { ok: true };
    }
    if (allowsCoreSubstitution) {
      const sim = levenshteinRatio(coreIn, coreOut);
      if (sim >= Math.min(minCoreSim, 0.96)) {
        return { ok: true, similarity: sim };
      }
      return {
        ok: false,
        reason: `删改后字序无法对应原文（相似度 ${(sim * 100).toFixed(1)}%）`,
        similarity: sim,
      };
    }
    return { ok: false, reason: "删改后正文汉字须保持原有顺序" };
  }

  if (allowsCoreSubstitution) {
    if (coreIn === coreOut) return { ok: true };
    const sim = levenshteinRatio(coreIn, coreOut);
    if (sim >= minCoreSim) {
      return { ok: true, similarity: sim };
    }
    return {
      ok: false,
      reason: `核心字序相似度 ${(sim * 100).toFixed(1)}% 不足`,
      similarity: sim,
    };
  }

  if (coreIn !== coreOut) {
    return { ok: false, reason: "核心字序与输入不一致" };
  }
  return { ok: true };
}

export type RecoverFormatOutputScopeOpts = Parameters<
  typeof validateFormatOutputPreserved
>[2];

/**
 * 模型偶发把上下文参考续写进输出时，尝试截断到与输入相同的行数后再校验。
 * 仅处理「输出行数多于输入」的扩写；合并硬换行导致的行数减少不在此处理。
 */
export function tryRecoverFormatOutputScope(
  input: string,
  output: string,
  opts?: RecoverFormatOutputScopeOpts,
): { text: string; recovered: boolean } {
  if (validateFormatOutputPreserved(input, output, opts).ok) {
    return { text: output, recovered: false };
  }
  const inputLineCount = input.split("\n").length;
  const outLines = output.split("\n");
  if (outLines.length <= inputLineCount) {
    return { text: output, recovered: false };
  }
  const trimmed = outLines.slice(0, inputLineCount).join("\n");
  if (!validateFormatOutputPreserved(input, trimmed, opts).ok) {
    return { text: output, recovered: false };
  }
  return { text: trimmed, recovered: true };
}
