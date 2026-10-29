import { reactive } from "vue";
import type { BookSourceCaptchaRequest } from "@shared/bookSource/ipc";

export const appCaptchaModel = reactive({
  open: false,
  requestId: "",
  sourceName: "",
  imageDataUrl: "",
  code: "",
});

/** 程序性关窗（确定/取消按钮）时避免 v-model 再次提交「取消」 */
let closingAfterSubmit = false;

export function isAppCaptchaClosingAfterSubmit(): boolean {
  return closingAfterSubmit;
}

export function openAppCaptcha(payload: BookSourceCaptchaRequest): void {
  appCaptchaModel.requestId = payload.requestId;
  appCaptchaModel.sourceName = payload.sourceName;
  appCaptchaModel.imageDataUrl = payload.imageDataUrl;
  appCaptchaModel.code = "";
  appCaptchaModel.open = true;
}

export function dismissAppCaptcha(requestId?: string): void {
  if (requestId && appCaptchaModel.requestId !== requestId) return;
  appCaptchaModel.open = false;
  appCaptchaModel.code = "";
}

export async function submitAppCaptcha(ok: boolean): Promise<void> {
  const requestId = appCaptchaModel.requestId;
  if (!requestId) return;
  const code = appCaptchaModel.code;
  closingAfterSubmit = true;
  appCaptchaModel.open = false;
  appCaptchaModel.requestId = "";
  appCaptchaModel.code = "";
  try {
    await window.colorTxt.bookSourceCaptchaReply({
      requestId,
      ok,
      code: ok ? code.trim() : "",
    });
  } finally {
    closingAfterSubmit = false;
  }
}
