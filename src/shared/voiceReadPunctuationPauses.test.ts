import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPunctuationPausesToPcm,
  clonePausePoints,
  collectPauseRuns,
  computePausePoints,
  scaledPauseDurationMs,
  type EdgeTtsWordBoundary,
} from "./voiceReadPunctuationPauses.ts";

function word(
  text: string,
  offsetMs: number,
  durationMs: number,
): EdgeTtsWordBoundary {
  return {
    text,
    offsetNs: offsetMs * 10000,
    durationNs: durationMs * 10000,
  };
}

describe("collectPauseRuns", () => {
  it("merges consecutive punctuation and prefers sentence", () => {
    const runs = collectPauseRuns("完了……，然后");
    assert.equal(runs.length, 1);
    assert.equal(runs[0]!.isSentence, true);
    assert.equal(runs[0]!.start, "完了".length);
    assert.equal(runs[0]!.end, "完了……，".length);
  });

  it("swallows a closing quote after punctuation", () => {
    const text = "他说：「好。」然后";
    const runs = collectPauseRuns(text);
    assert.equal(runs.length, 2);
    assert.equal(runs[0]!.isSentence, false);
    assert.equal(text.slice(runs[0]!.start, runs[0]!.end), "：");
    assert.equal(runs[1]!.isSentence, true);
    assert.equal(text.slice(runs[1]!.start, runs[1]!.end), "。」");
  });

  it("ignores ASCII punctuation", () => {
    assert.deepEqual(collectPauseRuns("Hi, 12.5! http://a.com"), []);
  });

  it("uses UTF-16 indices so emoji does not desync", () => {
    const text = "你好😀。世界";
    const runs = collectPauseRuns(text);
    assert.equal(runs.length, 1);
    assert.equal(text.slice(runs[0]!.start, runs[0]!.end), "。");
    assert.equal(runs[0]!.start, text.indexOf("。"));
  });
});

describe("computePausePoints", () => {
  it("maps a gap between speech words when punctuation is not a word", () => {
    const text = "你好。世界";
    const points = computePausePoints(text, [
      word("你", 0, 100),
      word("好", 100, 100),
      word("世", 280, 100),
      word("界", 380, 100),
    ]);
    assert.equal(points.length, 1);
    assert.equal(points[0]!.kind, "sentence");
    assert.equal(points[0]!.fromMs, 200);
    assert.equal(points[0]!.toMs, 280);
  });

  it("covers punctuation-word audio between neighboring speech words", () => {
    const text = "你好。世界";
    const points = computePausePoints(text, [
      word("你", 0, 100),
      word("好", 100, 100),
      word("。", 210, 40),
      word("世", 280, 100),
      word("界", 380, 100),
    ]);
    assert.equal(points.length, 1);
    assert.equal(points[0]!.fromMs, 200);
    assert.equal(points[0]!.toMs, 280);
  });

  it("interpolates when punctuation is attached to the previous word", () => {
    const text = "你好。世界";
    const points = computePausePoints(text, [
      word("你", 0, 100),
      word("好。", 100, 120),
      word("世", 280, 100),
      word("界", 380, 100),
    ]);
    assert.equal(points.length, 1);
    assert.equal(points[0]!.fromMs, 160);
    assert.equal(points[0]!.toMs, 280);
  });

  it("extends a trailing pause to end-of-audio", () => {
    const text = "完了。";
    const points = computePausePoints(text, [
      word("完", 0, 80),
      word("了", 80, 80),
    ]);
    assert.equal(points.length, 1);
    assert.equal(points[0]!.fromMs, 160);
    assert.equal(points[0]!.toMs, 1e9);
  });

  it("keeps pause after emoji on the period, not the emoji", () => {
    const text = "你好😀。世界";
    const points = computePausePoints(text, [
      word("你", 0, 50),
      word("好", 50, 50),
      word("😀", 100, 80),
      word("世", 220, 50),
      word("界", 270, 50),
    ]);
    assert.equal(points.length, 1);
    assert.equal(points[0]!.fromMs, 180);
    assert.equal(points[0]!.toMs, 220);
  });
});

describe("applyPunctuationPausesToPcm", () => {
  it("replaces the gap instead of inserting on top of it", () => {
    const sr = 1000;
    const src = new Float32Array(1000);
    src.fill(1);
    const out = applyPunctuationPausesToPcm(
      [src],
      sr,
      [{ fromMs: 100, toMs: 150, kind: "sentence" }],
      { pauseSentenceMs: 200, pauseCommaMs: 0, rate: 1 },
    );
    assert.equal(out[0]!.length, 1000 - 50 + 200);
    assert.notEqual(out[0]!.length, 1000 + 200);
    assert.equal(out[0]![50], 1);
    assert.equal(out[0]![200], 0);
  });

  it("scales pause duration with playback rate", () => {
    const sr = 1000;
    const src = new Float32Array(1000);
    const out = applyPunctuationPausesToPcm(
      [src],
      sr,
      [{ fromMs: 100, toMs: 150, kind: "sentence" }],
      { pauseSentenceMs: 200, pauseCommaMs: 0, rate: 2 },
    );
    assert.equal(out[0]!.length, 1000 - 50 + 100);
  });

  it("is a no-op when configured duration is 0", () => {
    const src = new Float32Array(100);
    const out = applyPunctuationPausesToPcm(
      [src],
      1000,
      [{ fromMs: 10, toMs: 20, kind: "comma" }],
      { pauseSentenceMs: 600, pauseCommaMs: 0, rate: 1 },
    );
    assert.equal(out[0], src);
  });
});

describe("clonePausePoints", () => {
  it("deep-copies pause objects", () => {
    const src = [{ fromMs: 1, toMs: 2, kind: "comma" as const }];
    const cloned = clonePausePoints(src);
    cloned[0]!.fromMs = 99;
    assert.equal(src[0]!.fromMs, 1);
  });
});

describe("scaledPauseDurationMs", () => {
  it("halves pause at 2x so speech+pause scale together", () => {
    assert.equal(scaledPauseDurationMs(600, 2), 300);
    assert.equal(scaledPauseDurationMs(250, 0.5), 500);
    assert.equal(scaledPauseDurationMs(0, 1), 0);
  });
});
