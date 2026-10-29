/** 全屏取色 IPC；覆盖层窗口与主窗共用 preload。 */

export const EYEDROPPER_IPC = {
  pick: "eyedropper:pick",
  init: "eyedropper:init",
  ready: "eyedropper:ready",
  pointer: "eyedropper:pointer",
  submit: "eyedropper:submit",
  cancel: "eyedropper:cancel",
  copy: "eyedropper:copy",
  sample: "eyedropper:sample",
  copied: "eyedropper:copied",
  toggleFormat: "eyedropper:toggleFormat",
  format: "eyedropper:format",
  hover: "eyedropper:hover",
  inactive: "eyedropper:inactive",
} as const;

export type EyedropperFormat = "hex" | "rgb";

export type EyedropperInitPayload = {
  dataUrl: string;
  format: EyedropperFormat;
  /** 本屏左上角的物理像素坐标（dipToScreenPoint，混 DPI 下各屏不同） */
  originX: number;
  originY: number;
  /** 本屏物理宽高（与截图一致；坐标用这套，不用被拉大的缩略图尺寸） */
  physWidth: number;
  physHeight: number;
};

export type EyedropperPointerPayload = {
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
};
