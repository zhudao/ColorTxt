import "./eyedropper.css";
import { rgbToHex } from "./utils/color";
import type { EyedropperFormat } from "@shared/eyedropperIpc";

const GRID = 15;
const CELL = 12;
const LOUPE = GRID * CELL;
const LOUPE_GAP = 18;
/** 取样框 / 网格容器：0.5px 黑框 + 0.5px 白内边距 */
const HAIR = 0.5;
const FRAME = HAIR * 4;

const shot = document.createElement("img");
shot.id = "shot";
shot.alt = "";
shot.draggable = false;

const sample = document.createElement("canvas");
const sampleCtx = sample.getContext("2d", { willReadFrequently: true });

const grid = document.createElement("canvas");
grid.id = "grid";
grid.style.width = `${LOUPE}px`;
grid.style.height = `${LOUPE}px`;
const gridCtx = grid.getContext("2d");

function syncGridCanvas(): { cell: number; hair: number; size: number } | null {
  if (!gridCtx) return null;
  const dpr = window.devicePixelRatio || 1;
  const cell = Math.round(CELL * dpr);
  const hair = Math.max(1, Math.round(HAIR * dpr));
  const size = cell * GRID;
  if (grid.width !== size || grid.height !== size) {
    grid.width = size;
    grid.height = size;
  }
  gridCtx.setTransform(1, 0, 0, 1, 0, 0);
  gridCtx.imageSmoothingEnabled = false;
  return { cell, hair, size };
}

function fillInsetRing(
  x: number,
  y: number,
  size: number,
  width: number,
  color: string,
): void {
  if (!gridCtx) return;
  gridCtx.fillStyle = color;
  gridCtx.fillRect(x, y, size, width);
  gridCtx.fillRect(x, y + size - width, size, width);
  gridCtx.fillRect(x, y, width, size);
  gridCtx.fillRect(x + size - width, y, width, size);
}

const gridFrame = document.createElement("div");
gridFrame.id = "gridFrame";
gridFrame.append(grid);

const loupe = document.createElement("div");
loupe.id = "loupe";

const info = document.createElement("div");
info.id = "info";

const coordsEl = document.createElement("div");
coordsEl.id = "coords";
const colorRow = document.createElement("div");
colorRow.id = "colorRow";
const swatch = document.createElement("span");
swatch.id = "swatch";
const valueEl = document.createElement("span");
valueEl.id = "value";
const hintCopy = document.createElement("div");
hintCopy.id = "hintCopy";
hintCopy.innerHTML = "按 <b>C</b> 复制颜色值";
const hintShift = document.createElement("div");
hintShift.id = "hintShift";
hintShift.innerHTML = "按 <b>Shift</b> 切换 RGB/HEX";

colorRow.append(swatch, valueEl);
info.append(coordsEl, colorRow, hintCopy, hintShift);
loupe.append(gridFrame, info);

document.body.append(shot, loupe);

let format: EyedropperFormat = "hex";
let lastRgb = { r: 0, g: 0, b: 0 };
let originX = 0;
let originY = 0;
let physWidth = 0;
let physHeight = 0;
let readySent = false;
let copyHintUntil = 0;
let pixels: Uint8ClampedArray | null = null;

function currentHex(): string {
  return rgbToHex(lastRgb.r, lastRgb.g, lastRgb.b);
}

function currentLabel(): string {
  if (format === "rgb") {
    return `${lastRgb.r}, ${lastRgb.g}, ${lastRgb.b}`;
  }
  return currentHex();
}

function paintHints(): void {
  if (Date.now() < copyHintUntil) {
    hintCopy.textContent = "已复制";
    return;
  }
  hintCopy.innerHTML = "按 <b>C</b> 复制颜色值";
}

let pointerHere = false;

function hasSample(): boolean {
  return pixels != null && sample.width > 0 && sample.height > 0;
}

let sampleRaf = 0;
function scheduleSample(): void {
  if (!pointerHere || !hasSample()) return;
  if (sampleRaf) return;
  sampleRaf = requestAnimationFrame(() => {
    sampleRaf = 0;
    if (!pointerHere || !hasSample()) return;
    window.colorTxt.eyedropperSample(currentLabel());
  });
}

function applyFormat(next: EyedropperFormat): void {
  if (next !== "hex" && next !== "rgb") return;
  format = next;
  valueEl.textContent = currentLabel();
  scheduleSample();
}

function showLoupe(): void {
  if (!pointerHere) {
    pointerHere = true;
    window.colorTxt.eyedropperHover();
  }
  loupe.classList.add("is-on");
}

function hideLoupe(): void {
  pointerHere = false;
  loupe.classList.remove("is-on");
}

function displaySize(): { w: number; h: number } {
  return {
    w: physWidth > 0 ? physWidth : sample.width || 1,
    h: physHeight > 0 ? physHeight : sample.height || 1,
  };
}

function samplePixel(
  px: number,
  py: number,
): { r: number; g: number; b: number } {
  if (!pixels || sample.width < 1 || sample.height < 1) {
    return { r: 0, g: 0, b: 0 };
  }
  const { w, h } = displaySize();
  const ix = Math.max(
    0,
    Math.min(
      sample.width - 1,
      Math.floor(((px + 0.5) / w) * sample.width),
    ),
  );
  const iy = Math.max(
    0,
    Math.min(
      sample.height - 1,
      Math.floor(((py + 0.5) / h) * sample.height),
    ),
  );
  const i = (iy * sample.width + ix) * 4;
  return { r: pixels[i]!, g: pixels[i + 1]!, b: pixels[i + 2]! };
}

function drawLoupe(px: number, py: number): void {
  if (!pixels || sample.width < 1) return;
  const g = syncGridCanvas();
  if (!g || !gridCtx) return;
  const { cell, hair, size } = g;
  const half = (GRID - 1) / 2;
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const c = samplePixel(px - half + i, py - half + j);
      gridCtx.fillStyle = `rgb(${c.r}, ${c.g}, ${c.b})`;
      gridCtx.fillRect(i * cell, j * cell, cell, cell);
    }
  }
  gridCtx.fillStyle = "rgba(0, 0, 0, 0.28)";
  for (let i = 1; i < GRID; i++) {
    const p = i * cell;
    gridCtx.fillRect(p, 0, hair, size);
    gridCtx.fillRect(0, p, size, hair);
  }
  const ox = half * cell;
  fillInsetRing(ox, ox, cell, hair, "#000");
  fillInsetRing(ox + hair, ox + hair, cell - hair * 2, hair, "#fff");
}

function placeLoupe(clientX: number, clientY: number): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const infoH = info.offsetHeight || 72;
  const boxW = LOUPE + FRAME;
  const boxH = LOUPE + FRAME + infoH;
  let left = clientX + LOUPE_GAP;
  let top = clientY + LOUPE_GAP;
  if (left + boxW > vw - 8) left = clientX - LOUPE_GAP - boxW;
  if (top + boxH > vh - 8) top = clientY - LOUPE_GAP - boxH;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  loupe.style.left = `${Math.round(left)}px`;
  loupe.style.top = `${Math.round(top)}px`;
}

function clientToPixel(clientX: number, clientY: number): { px: number; py: number } {
  const { w, h } = displaySize();
  const px = Math.floor((clientX / window.innerWidth) * w);
  const py = Math.floor((clientY / window.innerHeight) * h);
  return {
    px: Math.max(0, Math.min(w - 1, px)),
    py: Math.max(0, Math.min(h - 1, py)),
  };
}

function updateAt(clientX: number, clientY: number): void {
  const { px, py } = clientToPixel(clientX, clientY);
  lastRgb = samplePixel(px, py);
  drawLoupe(px, py);
  coordsEl.textContent = `(${originX + px}, ${originY + py})`;
  swatch.style.background = currentHex();
  valueEl.textContent = currentLabel();
  paintHints();
  showLoupe();
  placeLoupe(clientX, clientY);
  scheduleSample();
}

function onMove(ev: MouseEvent): void {
  updateAt(ev.clientX, ev.clientY);
}

function onClick(ev: MouseEvent): void {
  ev.preventDefault();
  ev.stopPropagation();
  if (ev.button !== 0) {
    window.colorTxt.eyedropperCancel();
    return;
  }
  window.colorTxt.eyedropperSubmit(currentHex());
}

function onKeyDown(ev: KeyboardEvent): void {
  if (ev.key === "Escape") {
    ev.preventDefault();
    window.colorTxt.eyedropperCancel();
    return;
  }
  if (ev.key === "Shift") {
    if (ev.repeat) return;
    ev.preventDefault();
    window.colorTxt.eyedropperToggleFormat();
    return;
  }
  if (ev.key === "c" || ev.key === "C") {
    if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    ev.preventDefault();
    if (pointerHere && hasSample()) {
      window.colorTxt.eyedropperSample(currentLabel());
    }
    window.colorTxt.eyedropperCopy();
  }
}

function startFromDataUrl(dataUrl: string): void {
  shot.onload = () => {
    sample.width = shot.naturalWidth;
    sample.height = shot.naturalHeight;
    if (sampleCtx) {
      sampleCtx.drawImage(shot, 0, 0);
      pixels = sampleCtx.getImageData(0, 0, sample.width, sample.height).data;
    }
    if (!readySent) {
      readySent = true;
      window.colorTxt.eyedropperReady();
    }
  };
  shot.onerror = () => {
    if (!readySent) {
      readySent = true;
      window.colorTxt.eyedropperReady();
    }
  };
  shot.src = dataUrl;
}

window.colorTxt.eyedropperOnInit((payload) => {
  originX = Number.isFinite(payload.originX) ? Math.round(payload.originX) : 0;
  originY = Number.isFinite(payload.originY) ? Math.round(payload.originY) : 0;
  physWidth =
    Number.isFinite(payload.physWidth) && payload.physWidth > 0
      ? Math.round(payload.physWidth)
      : 0;
  physHeight =
    Number.isFinite(payload.physHeight) && payload.physHeight > 0
      ? Math.round(payload.physHeight)
      : 0;
  applyFormat(payload.format);
  startFromDataUrl(payload.dataUrl);
});
window.colorTxt.eyedropperOnFormat(applyFormat);
window.colorTxt.eyedropperOnPointer((p) => {
  updateAt(p.clientX, p.clientY);
});
window.colorTxt.eyedropperOnInactive(hideLoupe);
window.colorTxt.eyedropperOnCopied(() => {
  if (!pointerHere) return;
  copyHintUntil = Date.now() + 1200;
  paintHints();
  window.setTimeout(paintHints, 1300);
});

window.addEventListener("mousemove", onMove);
window.addEventListener("mouseenter", () => {
  window.focus();
});
window.addEventListener("mouseleave", () => {
  hideLoupe();
});
window.addEventListener("mousedown", onClick);
window.addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  window.colorTxt.eyedropperCancel();
});
window.addEventListener("keydown", onKeyDown);
window.addEventListener("blur", () => {
  /* 多屏时焦点会转到另一块覆盖层，不要取消 */
});
