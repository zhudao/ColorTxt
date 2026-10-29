export type BookSourceErrorContext = {
  phase?: string;
  sourceName?: string;
  sourceUrl?: string;
  url?: string;
  method?: string;
  /** 附加说明，如页码、规则名等 */
  extra?: string;
};

function appendNodeErrorMeta(lines: string[], err: Error): void {
  const ne = err as NodeJS.ErrnoException & {
    address?: string;
    port?: number;
  };
  if (ne.code) lines.push(`错误码: ${ne.code}`);
  if (ne.syscall) lines.push(`系统调用: ${ne.syscall}`);
  if (ne.address) lines.push(`地址: ${ne.address}`);
  if (ne.port != null) lines.push(`端口: ${ne.port}`);
}

function formatStackLines(err: Error, maxLines = 12): string[] {
  if (!err.stack) return [];
  const lines = err.stack.split("\n").slice(1);
  const picked: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      trimmed.includes("node_modules") ||
      trimmed.includes("node:internal") ||
      trimmed.includes("undici")
    ) {
      continue;
    }
    picked.push(trimmed);
    if (picked.length >= maxLines) break;
  }
  if (picked.length === 0) {
    for (const line of lines.slice(0, maxLines)) {
      const trimmed = line.trim();
      if (trimmed) picked.push(trimmed);
    }
  }
  return picked;
}

function formatCauseChain(err: Error, maxDepth = 4): string[] {
  const lines: string[] = [];
  let current: unknown = err.cause;
  let depth = 0;
  while (current && depth < maxDepth) {
    const c = current instanceof Error ? current : new Error(String(current));
    lines.push(`Caused by: ${c.name}: ${c.message}`);
    appendNodeErrorMeta(lines, c);
    for (const sl of formatStackLines(c, 6)) {
      lines.push(`    at ${sl.replace(/^at\s+/, "")}`);
    }
    current = c.cause;
    depth += 1;
  }
  return lines;
}

/** 格式化书源错误，输出类似 Legado 的多行堆栈日志 */
export function formatBookSourceError(
  error: unknown,
  ctx: BookSourceErrorContext = {},
): string {
  const err = error instanceof Error ? error : new Error(String(error));
  const lines: string[] = [];

  lines.push(`${err.name}: ${err.message}`);
  appendNodeErrorMeta(lines, err);

  if (ctx.phase) lines.push(`阶段: ${ctx.phase}`);
  if (ctx.sourceName) lines.push(`书源: ${ctx.sourceName}`);
  if (ctx.sourceUrl) lines.push(`书源地址: ${ctx.sourceUrl}`);
  if (ctx.url) lines.push(`请求 URL: ${ctx.url}`);
  if (ctx.method) lines.push(`请求方法: ${ctx.method}`);
  if (ctx.extra) lines.push(ctx.extra);

  for (const sl of formatStackLines(err)) {
    lines.push(`    at ${sl.replace(/^at\s+/, "")}`);
  }

  lines.push(...formatCauseChain(err));

  return lines.join("\n");
}

export function appendBookSourceErrorLog(
  logs: string[],
  error: unknown,
  ctx: BookSourceErrorContext = {},
): string {
  const detail = formatBookSourceError(error, ctx);
  const head = detail.split("\n")[0] ?? detail;
  if (!logs.some((line) => line === head || line.includes(head))) {
    logs.push(detail);
  }
  return detail;
}

export function summarizeBookSourceError(error: unknown): string {
  const err = error instanceof Error ? error : new Error(String(error));
  const cause = err.cause instanceof Error ? err.cause : null;
  if (cause?.message && cause.message !== err.message) {
    return `${err.message} (${cause.message})`;
  }
  return err.message || String(error);
}
