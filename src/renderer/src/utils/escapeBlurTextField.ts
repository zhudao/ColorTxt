import { appLoadingModel } from "../services/appLoading";

const SKIP_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "radio",
  "file",
  "submit",
  "reset",
  "hidden",
  "image",
  "range",
  "color",
]);

/**
 * 焦点在文本输入上时 Esc 只失焦并吞掉事件，不关菜单 / 蒙版 / 浮动栏。
 * 文件重命名、阅读器 Monaco（查找栏除外）、加载蒙层中止 Esc 除外。
 */
export function isEscapeBlurTextField(
  target: EventTarget | null,
): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target.classList.contains("fileItemRenameInput")) return false;
  if (target.closest(".find-widget")) return true;
  if (target.closest(".monaco-editor")) return false;
  const tag = target.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = ((target as HTMLInputElement).type || "text").toLowerCase();
    return !SKIP_INPUT_TYPES.has(type);
  }
  return target.isContentEditable;
}

/** @returns 已失焦并吞掉该次 Esc */
export function tryBlurFocusedTextFieldOnEscape(ev: KeyboardEvent): boolean {
  if (ev.key !== "Escape" || ev.repeat) return false;
  if (appLoadingModel.open) return false;
  if (!isEscapeBlurTextField(ev.target)) return false;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  ev.target.blur();
  return true;
}

let installed = false;

/** 在入口尽早安装捕获监听，早于模态 / 菜单 / chrome 的 document 监听。 */
export function installEscapeBlurTextFieldListener(): void {
  if (installed) return;
  if (typeof document === "undefined") return;
  installed = true;
  document.addEventListener(
    "keydown",
    (ev) => {
      tryBlurFocusedTextFieldOnEscape(ev);
    },
    true,
  );
}
