/**
 * vite-plugin-monaco-editor 只为 languageWorkers 列表注册 getWorkerUrl。
 * 未知 label 若回退到 editorWorkerService，JS/JSON 语言服务会向纯编辑器 worker
 * 调用 getSyntacticDiagnostics 等方法并报错。
 * 此处仅在「完全没有 MonacoEnvironment」时补上 editor worker；已知语言不回退。
 */
const EDITOR_WORKER_PATH = "/monacoeditorwork/editor.worker.bundle.js";

export function ensureMonacoWorkerFallback(): void {
  const g = globalThis as typeof globalThis & {
    MonacoEnvironment?: {
      getWorkerUrl?: (moduleId: string, label: string) => string;
      __colortxtWorkerEnv?: boolean;
    };
  };

  if (g.MonacoEnvironment?.__colortxtWorkerEnv) return;

  if (g.MonacoEnvironment?.getWorkerUrl) {
    // 插件已注入：勿把 javascript/json 指到 editorWorkerService
    g.MonacoEnvironment.__colortxtWorkerEnv = true;
    return;
  }

  g.MonacoEnvironment = {
    __colortxtWorkerEnv: true,
    getWorkerUrl(_moduleId: string, label: string) {
      // 无插件注入时的兜底；正常应由 vite-plugin 提供 typescript/json 路径
      if (label === "typescript" || label === "javascript") {
        return "/monacoeditorwork/ts.worker.bundle.js";
      }
      if (label === "json") {
        return "/monacoeditorwork/json.worker.bundle.js";
      }
      return EDITOR_WORKER_PATH;
    },
  };
}
