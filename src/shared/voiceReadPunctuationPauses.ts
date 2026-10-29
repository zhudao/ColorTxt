import type { VoiceReadPausePoint } from "./voiceReadSynthesis";

/** 句末停顿标点（。！？…） */
const SENTENCE_PUNCT_RE = /[。！？…]/u;
/** 句中停顿标点（，；：、） */
const COMMA_PUNCT_RE = /[，；：、]/u;
/** 停顿后可跟随吞入的右引号（停顿点放到引号之后） */
const CLOSING_QUOTE_RE = /[」』”’"']/u;

const NS_PER_MS = 10000;
const END_OF_AUDIO_MS = 1e9;
/** 缩放后单次停顿上限，避免极端语速把缓冲区撑爆 */
const MAX_SCALED_PAUSE_MS = 10000;
const FADE_SEC = 0.002;

export type EdgeTtsWordBoundary = {
  text: string;
  /** 音频偏移，100ns 单位 */
  offsetNs: number;
  durationNs: number;
};

export type PauseRun = { start: number; end: number; isSentence: boolean };

export type PunctuationPausePlayback = {
  pauseSentenceMs: number;
  pauseCommaMs: number;
  rate: number;
};

type AlignedWord = EdgeTtsWordBoundary & {
  textStart: number;
  textEnd: number;
};

function codePointAt(text: string, index: number): string {
  const cp = text.codePointAt(index);
  return cp === undefined ? "" : String.fromCodePoint(cp);
}

/**
 * 收集文本中标点停顿段。下标为 UTF-16，便于与 `String.indexOf` 对齐。
 * 连续标点合并为一段（句末优先，如「……，」→句末）；停顿后紧跟右引号
 * （如「。」）时并入同一段。仅处理全角标点，ASCII 的 . , ! ? : 不参与。
 */
export function collectPauseRuns(text: string): PauseRun[] {
  const runs: PauseRun[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = codePointAt(text, i);
    if (!ch) break;
    if (!SENTENCE_PUNCT_RE.test(ch) && !COMMA_PUNCT_RE.test(ch)) {
      i += ch.length;
      continue;
    }
    let j = i;
    let sawSentence = false;
    while (j < text.length) {
      const c = codePointAt(text, j);
      if (!c) break;
      if (SENTENCE_PUNCT_RE.test(c)) {
        sawSentence = true;
        j += c.length;
      } else if (COMMA_PUNCT_RE.test(c)) {
        j += c.length;
      } else if (CLOSING_QUOTE_RE.test(c)) {
        j += c.length;
      } else {
        break;
      }
    }
    runs.push({ start: i, end: j, isSentence: sawSentence });
    i = j;
  }
  return runs;
}

function alignWords(
  text: string,
  words: readonly EdgeTtsWordBoundary[],
): AlignedWord[] {
  const aligned: AlignedWord[] = [];
  let cursor = 0;
  for (const w of words) {
    if (!w.text) continue;
    const idx = text.indexOf(w.text, cursor);
    if (idx < 0) continue;
    const textEnd = idx + w.text.length;
    aligned.push({
      text: w.text,
      offsetNs: w.offsetNs,
      durationNs: w.durationNs,
      textStart: idx,
      textEnd,
    });
    cursor = textEnd;
  }
  return aligned;
}

function wordStartMs(w: AlignedWord): number {
  return w.offsetNs / NS_PER_MS;
}

function wordEndMs(w: AlignedWord): number {
  return (w.offsetNs + w.durationNs) / NS_PER_MS;
}

function interpolateMs(w: AlignedWord, textIndex: number): number {
  const len = w.textEnd - w.textStart;
  if (len <= 0) return wordStartMs(w);
  const t = Math.min(1, Math.max(0, (textIndex - w.textStart) / len));
  return wordStartMs(w) + t * (wordEndMs(w) - wordStartMs(w));
}

/**
 * 把标点停顿段映射为音频内待替换区间，与停顿时长无关。
 * 区间 = 标点前语音结束 → 标点后语音开始（含标点词自身的音频，便于消掉气息声）。
 * 词与标点粘在同一 WordBoundary 时按文本比例插值，避免把最后一个字一起抹掉。
 */
export function computePausePoints(
  text: string,
  words: readonly EdgeTtsWordBoundary[],
): VoiceReadPausePoint[] {
  const runs = collectPauseRuns(text);
  if (runs.length === 0 || words.length === 0) return [];
  const aligned = alignWords(text, words);
  if (aligned.length === 0) return [];

  const out: VoiceReadPausePoint[] = [];
  for (const run of runs) {
    let prev: AlignedWord | null = null;
    let next: AlignedWord | null = null;
    for (const w of aligned) {
      if (w.textStart < run.start) prev = w;
      if (next === null && w.textStart >= run.end) {
        next = w;
        break;
      }
    }

    let fromMs: number;
    if (prev && prev.textEnd > run.start) {
      fromMs = interpolateMs(prev, run.start);
    } else if (prev) {
      fromMs = wordEndMs(prev);
    } else {
      fromMs = next ? wordStartMs(next) : 0;
    }

    let toMs: number;
    const overlappingAfter = aligned.find(
      (w) => w.textStart < run.end && w.textEnd > run.end,
    );
    if (overlappingAfter) {
      toMs = interpolateMs(overlappingAfter, run.end);
    } else if (next) {
      toMs = wordStartMs(next);
    } else {
      toMs = END_OF_AUDIO_MS;
    }

    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) continue;
    out.push({
      fromMs,
      toMs: Math.max(fromMs, toMs),
      kind: run.isSentence ? "sentence" : "comma",
    });
  }
  return out;
}

export function clonePausePoints(
  pauses: readonly VoiceReadPausePoint[] | undefined,
): VoiceReadPausePoint[] {
  if (!pauses?.length) return [];
  return pauses.map((x) => ({
    fromMs: x.fromMs,
    toMs: x.toMs,
    kind: x.kind,
  }));
}

/** 停顿为 1x 语速下的绝对时长，播放时除以当前语速，使整段（语音+停顿）同比缩放。 */
export function scaledPauseDurationMs(
  configuredMs: number,
  rate: number,
): number {
  if (!Number.isFinite(configuredMs) || configuredMs <= 0) return 0;
  const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
  return Math.min(MAX_SCALED_PAUSE_MS, configuredMs / r);
}

type PauseSampleRange = {
  fromSample: number;
  toSample: number;
  durationSamples: number;
};

function mergePauseSampleRanges(
  items: PauseSampleRange[],
): PauseSampleRange[] {
  const merged: PauseSampleRange[] = [];
  for (const it of items) {
    const last = merged[merged.length - 1];
    if (last && it.fromSample <= last.toSample) {
      last.toSample = Math.max(last.toSample, it.toSample);
      last.durationSamples = Math.max(
        last.durationSamples,
        it.durationSamples,
      );
    } else {
      merged.push({ ...it });
    }
  }
  return merged;
}

/**
 * 把 [from, to) 自然间隙替换为 kind 对应时长的干净静音（已按语速缩放）。
 * 新长度 = 原长 − 被替换区间 + 停顿时长；静音边缘 2ms 淡入淡出。
 */
export function applyPunctuationPausesToPcm(
  channels: readonly Float32Array[],
  sampleRate: number,
  pauses: readonly VoiceReadPausePoint[],
  playback: PunctuationPausePlayback,
): Float32Array[] {
  const srcLen = channels[0]?.length ?? 0;
  if (channels.length === 0 || srcLen <= 0 || sampleRate <= 0) {
    return channels as Float32Array[];
  }

  const items: PauseSampleRange[] = pauses
    .map((p) => {
      const durationMs = scaledPauseDurationMs(
        p.kind === "sentence"
          ? playback.pauseSentenceMs
          : playback.pauseCommaMs,
        playback.rate,
      );
      const fromSample = Math.max(
        0,
        Math.min(srcLen, Math.round((p.fromMs / 1000) * sampleRate)),
      );
      const toSample = Math.max(
        fromSample,
        Math.min(srcLen, Math.round((p.toMs / 1000) * sampleRate)),
      );
      return {
        fromSample,
        toSample,
        durationSamples: Math.round((durationMs / 1000) * sampleRate),
      };
    })
    .filter((x) => x.durationSamples > 0)
    .sort((a, b) => a.fromSample - b.fromSample);

  if (items.length === 0) return channels as Float32Array[];

  const merged = mergePauseSampleRanges(items);
  let newLen = srcLen;
  for (const it of merged) {
    newLen += it.durationSamples - (it.toSample - it.fromSample);
  }
  if (newLen <= 0) return channels as Float32Array[];

  const fade = Math.max(1, Math.round(FADE_SEC * sampleRate));
  const out = channels.map(() => new Float32Array(newLen));

  const copySegment = (
    dst: Float32Array,
    dstPos: number,
    src: Float32Array,
    srcPos: number,
    len: number,
    fadeIn: boolean,
    fadeOut: boolean,
  ) => {
    if (len <= 0) return;
    dst.set(src.subarray(srcPos, srcPos + len), dstPos);
    const n = Math.min(fade, len);
    if (fadeIn) {
      for (let k = 0; k < n; k++) {
        dst[dstPos + k] = dst[dstPos + k]! * (k / n);
      }
    }
    if (fadeOut) {
      for (let k = 0; k < n; k++) {
        dst[dstPos + len - 1 - k] = dst[dstPos + len - 1 - k]! * (k / n);
      }
    }
  };

  let srcPos = 0;
  let dstPos = 0;
  for (const it of merged) {
    const from = it.fromSample;
    const to = it.toSample;
    const speechLen = from - srcPos;
    for (let c = 0; c < channels.length; c++) {
      copySegment(
        out[c]!,
        dstPos,
        channels[c]!,
        srcPos,
        speechLen,
        dstPos > 0,
        true,
      );
    }
    dstPos += speechLen;
    dstPos += it.durationSamples;
    srcPos = to;
  }
  const tailLen = srcLen - srcPos;
  for (let c = 0; c < channels.length; c++) {
    copySegment(
      out[c]!,
      dstPos,
      channels[c]!,
      srcPos,
      tailLen,
      dstPos > 0,
      false,
    );
  }
  return out;
}
