/**
 * Decode Ogg Speex (.spx) dictionary audio to PCM WAV.
 * Chromium cannot play Speex; convert before handing data URLs to the renderer.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

type SpeexWasmModule = {
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _speex_js_decoder_create(sampleRate: number): number;
  _speex_js_decoder_frame_size(handle: number): number;
  _speex_js_decode(
    handle: number,
    framePtr: number,
    frameLen: number,
    pcmPtr: number,
  ): number;
  _speex_js_decoder_destroy(handle: number): void;
};

let wasmModulePromise: Promise<SpeexWasmModule> | null = null;

async function getSpeexWasm(): Promise<SpeexWasmModule> {
  if (!wasmModulePromise) {
    wasmModulePromise = (async () => {
      const wasmPath = require.resolve(
        "@caitun/speex/wasm/speex-wasm.wasm",
      );
      const jsPath = require.resolve("@caitun/speex/wasm/speex-wasm.js");
      const wasmBinary = readFileSync(wasmPath);
      const href = pathToFileURL(jsPath).href;
      // vite-ignore: load from packaged node_modules, not bundle
      const factory = (await import(/* @vite-ignore */ href)).default as (
        opts: Record<string, unknown>,
      ) => Promise<SpeexWasmModule>;
      return factory({
        instantiateWasm(
          info: WebAssembly.Imports,
          receiveInstance: (
            instance: WebAssembly.Instance,
            module?: WebAssembly.Module,
          ) => SpeexWasmModule,
        ) {
          const module = new WebAssembly.Module(wasmBinary);
          const instance = new WebAssembly.Instance(module, info);
          return receiveInstance(instance, module);
        },
      });
    })().catch((e) => {
      wasmModulePromise = null;
      throw e;
    });
  }
  return wasmModulePromise;
}

function parseOggPackets(buf: Buffer): Buffer[] {
  let offset = 0;
  const packets: Buffer[] = [];
  let current: Buffer[] = [];
  while (offset + 27 <= buf.length) {
    if (buf.toString("ascii", offset, offset + 4) !== "OggS") break;
    const nseg = buf[offset + 26]!;
    const segs = [...buf.subarray(offset + 27, offset + 27 + nseg)];
    let bodyStart = offset + 27 + nseg;
    for (const size of segs) {
      current.push(buf.subarray(bodyStart, bodyStart + size));
      bodyStart += size;
      if (size < 255) {
        packets.push(Buffer.concat(current));
        current = [];
      }
    }
    offset = bodyStart;
  }
  if (current.length) packets.push(Buffer.concat(current));
  return packets;
}

type SpeexIdHeader = {
  rate: number;
  mode: number;
  nbChannels: number;
  frameSize: number;
  framesPerPacket: number;
  extraHeaders: number;
};

/** Speex WASM only initializes at these rates (nb / wb / uwb). */
const SPEEX_DECODER_RATES = [8000, 16000, 32000] as const;

/**
 * Pick a rate the WASM decoder accepts.
 * Some dict packs (e.g. LDOCE5) put 22050 in the Speex ID header while
 * encoding as wideband (mode=1, frameSize=320); create(22050) returns null.
 */
function resolveDecoderSampleRate(header: SpeexIdHeader): number {
  if ((SPEEX_DECODER_RATES as readonly number[]).includes(header.rate)) {
    return header.rate;
  }
  // Prefer Speex mode: 0=nb, 1=wb, 2=uwb
  if (header.mode === 0) return 8000;
  if (header.mode === 1) return 16000;
  if (header.mode === 2) return 32000;
  // frameSize is samples per frame at the true codec rate
  if (header.frameSize === 160) return 8000;
  if (header.frameSize === 320) return 16000;
  if (header.frameSize === 640) return 32000;
  return SPEEX_DECODER_RATES.reduce((best, r) =>
    Math.abs(r - header.rate) < Math.abs(best - header.rate) ? r : best,
  );
}

function parseSpeexIdHeader(packet: Buffer): SpeexIdHeader | null {
  if (packet.length < 80) return null;
  if (packet.toString("ascii", 0, 8) !== "Speex   ") return null;
  const rate = packet.readInt32LE(36);
  const mode = packet.readInt32LE(40);
  const nbChannels = packet.readInt32LE(48);
  const frameSize = packet.readInt32LE(56);
  const framesPerPacket = packet.readInt32LE(64);
  const extraHeaders = packet.readInt32LE(68);
  if (rate <= 0 || frameSize <= 0) return null;
  return {
    rate,
    mode,
    nbChannels: Math.max(1, nbChannels || 1),
    frameSize,
    framesPerPacket: Math.max(1, framesPerPacket || 1),
    extraHeaders: Math.max(0, extraHeaders || 0),
  };
}

function encodeWavPcm16Mono(pcm: Int16Array, sampleRate: number): Buffer {
  const data = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    data.writeInt16LE(pcm[i]!, i * 2);
  }
  const channels = 1;
  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + data.length, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * 2, 28);
  wav.writeUInt16LE(channels * 2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return wav;
}

/** Detect Ogg Speex by magic (works even when extension is wrong). */
export function looksLikeOggSpeex(buf: Buffer): boolean {
  if (buf.length < 40) return false;
  if (buf.toString("ascii", 0, 4) !== "OggS") return false;
  // first page body usually starts soon after header; search early window
  const window = buf.subarray(0, Math.min(buf.length, 256)).toString("latin1");
  return window.includes("Speex   ");
}

/**
 * Convert Ogg Speex bytes to WAV. Returns null if not Speex or decode fails.
 */
export async function oggSpeexToWav(input: Buffer): Promise<Buffer | null> {
  if (!looksLikeOggSpeex(input)) return null;
  const packets = parseOggPackets(input);
  if (packets.length < 3) return null;
  const header = parseSpeexIdHeader(packets[0]!);
  if (!header) return null;

  const sampleRate = resolveDecoderSampleRate(header);
  const mod = await getSpeexWasm();
  const handle = mod._speex_js_decoder_create(sampleRate);
  if (!handle) return null;
  try {
    const decFrameSize = mod._speex_js_decoder_frame_size(handle);
    if (decFrameSize <= 0) return null;
    const framePtr = mod._malloc(512);
    const pcmPtr = mod._malloc(decFrameSize * 2);
    if (!framePtr || !pcmPtr) return null;
    try {
      const chunks: Int16Array[] = [];
      const start = 2 + header.extraHeaders;
      for (let i = start; i < packets.length; i++) {
        const frame = packets[i]!;
        if (!frame.length || frame.length > 512) continue;
        // Most dict .spx packs one coded frame per Ogg packet.
        mod.HEAPU8.set(frame, framePtr);
        const sampleCount = mod._speex_js_decode(
          handle,
          framePtr,
          frame.length,
          pcmPtr,
        );
        if (sampleCount <= 0) continue;
        chunks.push(
          Int16Array.from(
            mod.HEAP16.subarray(pcmPtr >> 1, (pcmPtr >> 1) + sampleCount),
          ),
        );
      }
      if (!chunks.length) return null;
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const pcm = new Int16Array(total);
      let o = 0;
      for (const c of chunks) {
        pcm.set(c, o);
        o += c.length;
      }
      // WAV rate must match decoded PCM (not the possibly nonstandard ID header rate).
      return encodeWavPcm16Mono(pcm, sampleRate);
    } finally {
      mod._free(framePtr);
      mod._free(pcmPtr);
    }
  } finally {
    mod._speex_js_decoder_destroy(handle);
  }
}
