export type HexColorPickerMode = "hsv" | "hsl";

/** 本窗口内所有拾色器共用：色盘 / HSL */
let sharedMode: HexColorPickerMode = "hsv";

export function getHexColorPickerMode(): HexColorPickerMode {
  return sharedMode;
}

export function setHexColorPickerMode(mode: HexColorPickerMode): void {
  sharedMode = mode;
}
