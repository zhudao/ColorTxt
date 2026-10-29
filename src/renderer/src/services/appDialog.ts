import { nextTick, reactive } from "vue";

export type AppDialogKind = "alert" | "confirm" | "prompt" | "log";

export const appDialogModel = reactive({
  open: false,
  kind: "alert" as AppDialogKind,
  title: "提示",
  message: "",
  dangerouslyUseHTMLString: false,
  /** prompt：与输入框双向绑定（打开时由队列项初始化） */
  promptValue: "",
  promptPlaceholder: "",
  promptMultiline: false,
  /** 单行 prompt 的 input type（multiline 时忽略） */
  promptInputType: "text" as "text" | "number" | "password",
  promptNeutralLabel: "",
  /** 密码框：底栏显示「显示密码」 */
  promptShowPasswordToggle: false,
  /** 密码框：当前是否明文显示（与持久化勾选同步） */
  promptRevealPassword: false,
  /** 密码框：底栏显示「解密失败时跳过」（不持久化） */
  promptShowSkipOnFailToggle: false,
  /** 「解密失败时跳过」当前勾选 */
  promptSkipOnFail: false,
});

export type AppDialogHtmlOptions = {
  /** 为 true 时 title / message 按 HTML 渲染（仅传入可信内容） */
  dangerouslyUseHTMLString?: boolean;
};

type DialogQueueBase = {
  title: string;
  message: string;
  dangerouslyUseHTMLString: boolean;
};

type QAlert = DialogQueueBase & {
  kind: "alert";
  resolve: () => void;
};

type QLog = DialogQueueBase & {
  kind: "log";
  resolve: () => void;
};

type QConfirm = DialogQueueBase & {
  kind: "confirm";
  resolve: (ok: boolean) => void;
};

type QPrompt = DialogQueueBase & {
  kind: "prompt";
  defaultValue: string;
  placeholder: string;
  multiline: boolean;
  inputType: "text" | "number" | "password";
  /** 左下角中性按钮（点击不关闭对话框） */
  neutralLabel?: string;
  onNeutral?: () => void;
  /** 密码框底栏「显示密码」 */
  showPasswordToggle?: boolean;
  revealPassword?: boolean;
  onRevealPasswordChange?: (reveal: boolean) => void;
  /** 密码框底栏「解密失败时跳过」（不持久化） */
  showSkipOnFailToggle?: boolean;
  skipOnFail?: boolean;
  onSkipOnFailChange?: (skip: boolean) => void;
  resolve: (value: string | null) => void;
};

type Queued = QAlert | QConfirm | QPrompt | QLog;

const queue: Queued[] = [];

function applyQueuedToModel(item: Queued) {
  appDialogModel.kind = item.kind;
  appDialogModel.title = item.title;
  appDialogModel.message = item.message;
  appDialogModel.dangerouslyUseHTMLString = item.dangerouslyUseHTMLString;
  if (item.kind === "prompt") {
    appDialogModel.promptValue = item.defaultValue;
    appDialogModel.promptPlaceholder = item.placeholder;
    appDialogModel.promptMultiline = item.multiline;
    appDialogModel.promptInputType = item.inputType;
    appDialogModel.promptNeutralLabel = item.neutralLabel?.trim() || "";
    appDialogModel.promptShowPasswordToggle =
      item.showPasswordToggle === true && item.inputType === "password";
    appDialogModel.promptRevealPassword =
      appDialogModel.promptShowPasswordToggle && item.revealPassword === true;
    appDialogModel.promptShowSkipOnFailToggle =
      item.showSkipOnFailToggle === true && item.inputType === "password";
    appDialogModel.promptSkipOnFail =
      appDialogModel.promptShowSkipOnFailToggle && item.skipOnFail === true;
  } else {
    appDialogModel.promptInputType = "text";
    appDialogModel.promptNeutralLabel = "";
    appDialogModel.promptShowPasswordToggle = false;
    appDialogModel.promptRevealPassword = false;
    appDialogModel.promptShowSkipOnFailToggle = false;
    appDialogModel.promptSkipOnFail = false;
  }
}

function pump() {
  const next = queue[0];
  if (!next) {
    appDialogModel.open = false;
    return;
  }
  applyQueuedToModel(next);
  appDialogModel.open = true;
}

function pumpNext() {
  const next = queue[0];
  if (!next) {
    appDialogModel.open = false;
    return;
  }
  applyQueuedToModel(next);
}

function enqueue(item: Queued) {
  queue.push(item);
  if (!appDialogModel.open) {
    void nextTick(() => {
      if (appDialogModel.open) return;
      pump();
    });
  }
}

/** 密码框「显示密码」勾选变化（不关闭对话框） */
export function appDialogSetPromptRevealPassword(reveal: boolean) {
  appDialogModel.promptRevealPassword = reveal;
  const cur = queue[0];
  if (cur?.kind === "prompt" && cur.onRevealPasswordChange) {
    cur.onRevealPasswordChange(reveal);
  }
}

/** 密码框「解密失败时跳过」勾选变化（不关闭对话框） */
export function appDialogSetPromptSkipOnFail(skip: boolean) {
  appDialogModel.promptSkipOnFail = skip;
  const cur = queue[0];
  if (cur?.kind === "prompt" && cur.onSkipOnFailChange) {
    cur.onSkipOnFailChange(skip);
  }
}

/** 主按钮：alert / confirm 确定 / prompt 确定（允许空字符串） */
export function appDialogPrimary() {
  const cur = queue[0];
  if (!cur) return;
  queue.shift();
  const promptSnapshot =
    cur.kind === "prompt" ? appDialogModel.promptValue : "";
  if (cur.kind === "alert" || cur.kind === "log") cur.resolve();
  else if (cur.kind === "confirm") cur.resolve(true);
  else cur.resolve(promptSnapshot);
  pumpNext();
}

/** 次按钮：confirm 取消、prompt 取消（alert 无） */
export function appDialogSecondary() {
  const cur = queue[0];
  if (!cur || cur.kind === "alert" || cur.kind === "log") return;
  queue.shift();
  if (cur.kind === "confirm") cur.resolve(false);
  else cur.resolve(null);
  pumpNext();
}

/** prompt 左下角按钮：不关闭对话框 */
export function appDialogNeutral() {
  const cur = queue[0];
  if (!cur || cur.kind !== "prompt") return;
  cur.onNeutral?.();
}

/**
 * 蒙层 / Esc / 右上角关闭：alert 视为确定；confirm / prompt 视为取消。
 */
export function appDialogUserDismiss() {
  const cur = queue[0];
  if (!cur) {
    appDialogModel.open = false;
    return;
  }
  queue.shift();
  if (cur.kind === "alert" || cur.kind === "log") cur.resolve();
  else if (cur.kind === "confirm") cur.resolve(false);
  else cur.resolve(null);
  pumpNext();
}

export function appAlert(
  message: string,
  title = "提示",
  options?: AppDialogHtmlOptions,
): Promise<void> {
  return new Promise((resolve) => {
    enqueue({
      kind: "alert",
      title,
      message,
      dangerouslyUseHTMLString: options?.dangerouslyUseHTMLString === true,
      resolve,
    });
  });
}

/** 多行可选中日志弹窗，保留换行 */
export function appLog(
  message: string,
  title = "日志",
  options?: AppDialogHtmlOptions,
): Promise<void> {
  return new Promise((resolve) => {
    enqueue({
      kind: "log",
      title,
      message,
      dangerouslyUseHTMLString: options?.dangerouslyUseHTMLString === true,
      resolve,
    });
  });
}

export function appConfirm(
  message: string,
  title = "确认",
  options?: AppDialogHtmlOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    enqueue({
      kind: "confirm",
      title,
      message,
      dangerouslyUseHTMLString: options?.dangerouslyUseHTMLString === true,
      resolve,
    });
  });
}

export type AppPromptOptions = AppDialogHtmlOptions & {
  title?: string;
  defaultValue?: string;
  placeholder?: string;
  /** 多行编辑（如 Legado 变量对话框） */
  multiline?: boolean;
  /** 单行输入框 type，默认 text；页码等场景可传 number；书包密码传 password */
  inputType?: "text" | "number" | "password";
  /**
   * 左下角按钮文案（如「校验设置」）。
   * 点击不关闭对话框，调用 `onNeutral`（对齐 Legado AlertDialog.BUTTON_NEUTRAL）。
   */
  neutralLabel?: string;
  onNeutral?: () => void;
  /** 密码框底栏显示「显示密码」复选框（仅 inputType 为 password 时有效） */
  showPasswordToggle?: boolean;
  /** 「显示密码」初始勾选状态 */
  revealPassword?: boolean;
  /** 「显示密码」勾选变化（用于持久化） */
  onRevealPasswordChange?: (reveal: boolean) => void;
  /** 密码框底栏「解密失败时跳过」（不持久化） */
  showSkipOnFailToggle?: boolean;
  skipOnFail?: boolean;
  onSkipOnFailChange?: (skip: boolean) => void;
};

/** 确定返回输入文本（可为空串），取消 / 蒙层 / Esc 返回 `null` */
export function appPrompt(
  message: string,
  options?: AppPromptOptions,
): Promise<string | null> {
  const title = options?.title ?? "输入";
  const defaultValue = options?.defaultValue ?? "";
  const placeholder = options?.placeholder ?? "";
  const multiline = options?.multiline === true;
  const inputType =
    options?.inputType === "number"
      ? "number"
      : options?.inputType === "password"
        ? "password"
        : "text";
  const dangerouslyUseHTMLString = options?.dangerouslyUseHTMLString === true;
  const neutralLabel = options?.neutralLabel?.trim() || undefined;
  const onNeutral = options?.onNeutral;
  const showPasswordToggle =
    inputType === "password" && options?.showPasswordToggle === true;
  const revealPassword =
    showPasswordToggle && options?.revealPassword === true;
  const onRevealPasswordChange = options?.onRevealPasswordChange;
  const showSkipOnFailToggle =
    inputType === "password" && options?.showSkipOnFailToggle === true;
  const skipOnFail = showSkipOnFailToggle && options?.skipOnFail === true;
  const onSkipOnFailChange = options?.onSkipOnFailChange;
  return new Promise((resolve) => {
    enqueue({
      kind: "prompt",
      title,
      message,
      dangerouslyUseHTMLString,
      defaultValue,
      placeholder,
      multiline,
      inputType,
      neutralLabel,
      onNeutral,
      showPasswordToggle,
      revealPassword,
      onRevealPasswordChange,
      showSkipOnFailToggle,
      skipOnFail,
      onSkipOnFailChange,
      resolve,
    });
  });
}
