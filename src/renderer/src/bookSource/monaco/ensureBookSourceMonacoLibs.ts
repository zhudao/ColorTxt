/**
 * 幂等注入书源运行时 lib，供全屏 Monaco JS 字段补全 / hover。
 * 诊断仍由调用方关闭；本函数只挂 ExtraLib。
 */

import type * as Monaco from "monaco-editor";
import {
  BOOK_SOURCE_RUNTIME_DTS,
  BOOK_SOURCE_RUNTIME_LIB_PATH,
} from "./bookSourceRuntimeLib";

let registered = false;

type MonacoTypescript = {
  javascriptDefaults: {
    addExtraLib: (content: string, filePath?: string) => { dispose: () => void };
  };
};

function getTypescriptApi(monaco: typeof Monaco): MonacoTypescript | null {
  const top = (
    monaco as unknown as { typescript?: MonacoTypescript }
  ).typescript;
  if (top?.javascriptDefaults?.addExtraLib) return top;

  const legacy = (
    monaco as unknown as {
      languages?: { typescript?: MonacoTypescript };
    }
  ).languages?.typescript;
  if (legacy?.javascriptDefaults?.addExtraLib) return legacy;

  return null;
}

/** 在 language === "javascript" 的全屏书源编辑器打开时调用 */
export function ensureBookSourceMonacoLibs(monaco: typeof Monaco): void {
  const ts = getTypescriptApi(monaco);
  if (!ts) return;

  // 同 path 再次 addExtraLib 会替换；已注册则跳过
  if (registered) return;

  ts.javascriptDefaults.addExtraLib(
    BOOK_SOURCE_RUNTIME_DTS,
    BOOK_SOURCE_RUNTIME_LIB_PATH,
  );
  registered = true;
}
