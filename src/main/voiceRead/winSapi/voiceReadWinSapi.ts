/**
 * Windows SAPI5 语音枚举与合成（System.Speech）。
 * 可看到 NaturalVoiceSAPIAdapter 注册的讲述人/Edge 自然语音等经典 SAPI 音色。
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { VoiceReadVoiceOption } from "@shared/voiceReadSynthesis";

export type WinSapiVoiceInfo = VoiceReadVoiceOption & {
  gender?: "male" | "female";
};

function assertWindows(): void {
  if (process.platform !== "win32") {
    throw new Error("Windows SAPI 语音仅支持 Windows 平台");
  }
}

function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

async function runPowerShell(
  script: string,
  signal?: AbortSignal,
): Promise<string> {
  assertWindows();
  if (signal?.aborted) throw new Error("interrupted");

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodePowerShellCommand(script),
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const onAbort = () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error("interrupted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        reject(new Error("interrupted"));
        return;
      }
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `exit ${code}`;
        reject(new Error(`PowerShell SAPI 调用失败：${detail}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function psSingleQuoted(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function mapSapiRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  // ColorTxt 0.5～2.0 → SAPI -10～10
  return Math.max(-10, Math.min(10, Math.round((rate - 1) * 10)));
}

function normalizeGender(raw: unknown): "male" | "female" | undefined {
  const s = String(raw ?? "").toLowerCase();
  if (s === "male" || s === "1") return "male";
  if (s === "female" || s === "2") return "female";
  return undefined;
}

/** NaturalVoiceSAPIAdapter / 讲述人自然音：名称含 Natural，或非 Desktop 的微软神经中文名 */
export function isWinSapiNaturalVoiceLabel(label: string): boolean {
  if (/\(\s*Natural\s*\)/i.test(label) || /\bNatural\b/i.test(label)) {
    return true;
  }
  if (/Desktop/i.test(label)) return false;
  return /Microsoft\s+(Xiaoxiao|Yunxi|Yunjian|Yunyang|Xiaochen|Xiaoyi|Xiaoxuan|Yunxia)\b/i.test(
    label,
  );
}

function compareWinSapiVoices(a: WinSapiVoiceInfo, b: WinSapiVoiceInfo): number {
  const an = isWinSapiNaturalVoiceLabel(a.label) ? 0 : 1;
  const bn = isWinSapiNaturalVoiceLabel(b.label) ? 0 : 1;
  if (an !== bn) return an - bn;
  const al = (a.locale ?? "").toLowerCase();
  const bl = (b.locale ?? "").toLowerCase();
  const az = al.startsWith("zh") ? 0 : 1;
  const bz = bl.startsWith("zh") ? 0 : 1;
  if (az !== bz) return az - bz;
  return a.label.localeCompare(b.label, "zh");
}

let voicesCache: WinSapiVoiceInfo[] | null = null;
let voicesInflight: Promise<WinSapiVoiceInfo[]> | null = null;

export function clearWinSapiVoiceCache(): void {
  voicesCache = null;
  voicesInflight = null;
}

export async function listWinSapiVoices(
  signal?: AbortSignal,
): Promise<WinSapiVoiceInfo[]> {
  assertWindows();
  if (voicesCache) return voicesCache;
  if (voicesInflight) return voicesInflight;

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $rows = @(
    $synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
      $i = $_.VoiceInfo
      [PSCustomObject]@{
        id = [string]$i.Name
        label = [string]$i.Name
        locale = [string]$i.Culture.Name
        gender = [string]$i.Gender
      }
    }
  )
  if ($rows.Count -eq 0) { '[]' } else { $rows | ConvertTo-Json -Compress }
} finally {
  $synth.Dispose()
}
`.trim();

  voicesInflight = (async () => {
    try {
      const stdout = await runPowerShell(script, signal);
      const trimmed = stdout.trim();
      if (!trimmed) return [];
      const parsed = JSON.parse(trimmed) as unknown;
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const out: WinSapiVoiceInfo[] = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const o = row as Record<string, unknown>;
        const id = typeof o.id === "string" ? o.id.trim() : "";
        if (!id) continue;
        const label =
          typeof o.label === "string" && o.label.trim() ? o.label.trim() : id;
        out.push({
          id,
          label,
          locale:
            typeof o.locale === "string" && o.locale.trim()
              ? o.locale.trim()
              : undefined,
          gender: normalizeGender(o.gender),
        });
      }
      out.sort(compareWinSapiVoices);
      voicesCache = out;
      return out;
    } finally {
      voicesInflight = null;
    }
  })();

  return voicesInflight;
}

export function pickDefaultWinSapiVoiceId(
  voices: readonly WinSapiVoiceInfo[],
): string {
  const zhNatural = voices.find(
    (v) =>
      isWinSapiNaturalVoiceLabel(v.label) &&
      (v.locale ?? "").toLowerCase().startsWith("zh"),
  );
  if (zhNatural) return zhNatural.id;
  const natural = voices.find((v) => isWinSapiNaturalVoiceLabel(v.label));
  if (natural) return natural.id;
  const zh = voices.find((v) =>
    (v.locale ?? "").toLowerCase().startsWith("zh"),
  );
  if (zh) return zh.id;
  return voices[0]?.id ?? "";
}

/** SAPI COM 不宜并行；串行化合成 */
let synthChain: Promise<unknown> = Promise.resolve();

function enqueueSynth<T>(fn: () => Promise<T>): Promise<T> {
  const next = synthChain.then(fn, fn);
  synthChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function synthesizeWinSapiWav(opts: {
  text: string;
  voiceId: string;
  rate: number;
  signal?: AbortSignal;
}): Promise<ArrayBuffer> {
  assertWindows();
  const text = opts.text.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("合成文本为空");

  return enqueueSynth(async () => {
    if (opts.signal?.aborted) throw new Error("interrupted");

    const voices = await listWinSapiVoices(opts.signal);
    const voiceId =
      opts.voiceId.trim() || pickDefaultWinSapiVoiceId(voices);
    if (!voiceId) {
      throw new Error(
        "未找到可用的 SAPI5 音色。请安装 NaturalVoiceSAPIAdapter 与自然语音包后重试。",
      );
    }
    const hit = voices.find((v) => v.id === voiceId);
    if (!hit && voices.length > 0) {
      // 仍尝试 SelectVoice，兼容缓存过期
    }

    const tmpDir = os.tmpdir();
    const token = randomBytes(8).toString("hex");
    const textPath = path.join(tmpDir, `colortxt-sapi-text-${token}.txt`);
    const wavPath = path.join(tmpDir, `colortxt-sapi-out-${token}.wav`);
    const sapiRate = mapSapiRate(opts.rate);

    try {
      await fs.writeFile(textPath, text, "utf8");
      const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $synth.SelectVoice(${psSingleQuoted(voiceId)})
  $synth.Rate = ${sapiRate}
  $synth.Volume = 100
  $text = Get-Content -LiteralPath ${psSingleQuoted(textPath)} -Encoding UTF8 -Raw
  if ([string]::IsNullOrWhiteSpace($text)) { throw '合成文本为空' }
  $synth.SetOutputToWaveFile(${psSingleQuoted(wavPath)})
  $synth.Speak($text)
} finally {
  $synth.Dispose()
}
`.trim();
      await runPowerShell(script, opts.signal);
      if (opts.signal?.aborted) throw new Error("interrupted");
      const buf = await fs.readFile(wavPath);
      return buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer;
    } finally {
      await Promise.allSettled([fs.unlink(textPath), fs.unlink(wavPath)]);
    }
  });
}
