import type { VoiceReadDialogueQuoteStyle } from "../../constants/voiceRead";
import type { VoiceReadQuoteAttribution } from "@shared/voiceReadSpeakerIpc";

export type VoiceReadSegmentKind = "narration" | "dialogue";

export type VoiceReadTextSegment = {
  kind: VoiceReadSegmentKind;
  text: string;
  /** 对白段在原文中使用的开/闭引号（合成拼回旁白时用） */
  quoteOpen?: string;
  quoteClose?: string;
  /** merge 后保留的对白段所对应的 AI 引号分类 */
  quoteAttr?: VoiceReadQuoteAttribution;
};

export type VoiceReadQuoteCarry = {
  style: VoiceReadDialogueQuoteStyle;
} | null;

type QuotePairDef = {
  style: VoiceReadDialogueQuoteStyle;
  open: string;
  close: string;
};

const QUOTE_PAIR_DEFS: QuotePairDef[] = [
  { style: "double", open: "\u201C", close: "\u201D" },
  { style: "single", open: "\u2018", close: "\u2019" },
  { style: "corner", open: "\u300C", close: "\u300D" },
  { style: "doubleCorner", open: "\u300E", close: "\u300F" },
];

function enabledPairs(
  quoteStyles: readonly VoiceReadDialogueQuoteStyle[],
): QuotePairDef[] {
  const set = new Set(quoteStyles);
  return QUOTE_PAIR_DEFS.filter((p) => set.has(p.style));
}

function findPairByStyle(
  style: VoiceReadDialogueQuoteStyle,
): QuotePairDef | undefined {
  return QUOTE_PAIR_DEFS.find((p) => p.style === style);
}

function tryMatchOpen(
  text: string,
  pos: number,
  pairs: QuotePairDef[],
): { pair: QuotePairDef; next: number } | null {
  for (const pair of pairs) {
    if (text.startsWith(pair.open, pos)) {
      return { pair, next: pos + pair.open.length };
    }
  }
  return null;
}

export type ParseVoiceSegmentsResult = {
  segments: VoiceReadTextSegment[];
  carry: VoiceReadQuoteCarry;
};

/**
 * 将一行文本按启用的引号对切分为旁白/对白段。
 * carry：上一行未闭合的对白引号状态。
 */
export function parseVoiceSegments(
  line: string,
  opts: {
    quoteStyles: readonly VoiceReadDialogueQuoteStyle[];
    carry?: VoiceReadQuoteCarry;
  },
): ParseVoiceSegmentsResult {
  const pairs = enabledPairs(opts.quoteStyles);
  const segments: VoiceReadTextSegment[] = [];
  let carry: VoiceReadQuoteCarry = null;

  const pushSegment = (
    kind: VoiceReadSegmentKind,
    text: string,
    quote?: { open: string; close: string },
  ) => {
    const t = text;
    if (!t) return;
    const last = segments[segments.length - 1];
    if (last && last.kind === kind) {
      last.text += t;
      if (kind === "dialogue" && quote) {
        last.quoteOpen = quote.open;
        last.quoteClose = quote.close;
      }
    } else {
      segments.push({
        kind,
        text: t,
        ...(kind === "dialogue" && quote
          ? { quoteOpen: quote.open, quoteClose: quote.close }
          : {}),
      });
    }
  };

  if (pairs.length === 0) {
    const t = line;
    if (t) pushSegment("narration", t);
    return { segments, carry };
  }

  let pos = 0;
  let inDialogue = false;
  let activePair: QuotePairDef | null = null;

  if (opts.carry) {
    const p = findPairByStyle(opts.carry.style);
    if (p && pairs.some((x) => x.style === p.style)) {
      inDialogue = true;
      activePair = p;
    }
  }

  while (pos < line.length) {
    if (inDialogue && activePair) {
      const closeIdx = line.indexOf(activePair.close, pos);
      if (closeIdx < 0) {
        pushSegment("dialogue", line.slice(pos), {
          open: activePair.open,
          close: activePair.close,
        });
        carry = { style: activePair.style };
        return { segments, carry };
      }
      pushSegment("dialogue", line.slice(pos, closeIdx), {
        open: activePair.open,
        close: activePair.close,
      });
      pos = closeIdx + activePair.close.length;
      inDialogue = false;
      activePair = null;
      continue;
    }

    const openHit = tryMatchOpen(line, pos, pairs);
    if (openHit) {
      inDialogue = true;
      activePair = openHit.pair;
      pos = openHit.next;
      continue;
    }

    let nextSpecial = line.length;
    for (const pair of pairs) {
      const idx = line.indexOf(pair.open, pos);
      if (idx >= 0 && idx < nextSpecial) nextSpecial = idx;
    }

    if (nextSpecial > pos) {
      pushSegment("narration", line.slice(pos, nextSpecial));
    }
    pos = nextSpecial;
  }

  if (inDialogue && activePair) {
    carry = { style: activePair.style };
  }

  return { segments, carry };
}

/** 合并相邻同类型段，并去掉空白段 */
export function normalizeVoiceSegments(
  segments: VoiceReadTextSegment[],
): VoiceReadTextSegment[] {
  const out: VoiceReadTextSegment[] = [];
  for (const seg of segments) {
    const t = seg.text;
    if (!t) continue;
    const last = out[out.length - 1];
    if (last && last.kind === seg.kind) {
      last.text += t;
    } else {
      out.push({ kind: seg.kind, text: t });
    }
  }
  return out;
}
