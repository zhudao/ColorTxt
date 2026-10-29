/**
 * 打包裁剪会删掉 `@huggingface/transformers` 的 `types/`。
 * 此处只声明 Worker 实际用到的 `pipeline` / `env`，避免 typecheck 依赖未裁剪的 node_modules。
 */
declare module "@huggingface/transformers" {
  export const env: {
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    cacheDir: string;
    useFSCache: boolean;
    useBrowserCache: boolean;
    remoteHost: string;
    backends: { onnx: Record<string, unknown> };
  };

  export function pipeline(
    task: string,
    model: string,
    options?: {
      progress_callback?: (p: { status?: string; progress?: number }) => void;
    },
  ): Promise<
    (
      text: string,
      opts: { pooling: "mean"; normalize: boolean },
    ) => Promise<{ data: Float32Array | number[]; dims: number[] }>
  >;
}
