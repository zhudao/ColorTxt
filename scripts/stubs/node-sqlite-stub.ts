/**
 * Rollup 打包 undici 时会静态引入 node:sqlite（SqliteCacheStore），触发 ExperimentalWarning。
 * ColorTxt 不使用 undici 的 SQLite 缓存，提供空实现即可。
 */
export class DatabaseSync {
  constructor(_location?: string) {
    throw new Error("node:sqlite stub: SqliteCacheStore is not used in ColorTxt");
  }

  exec(_sql: string): void {}

  prepare(_sql: string): StatementSync {
    return new StatementSync();
  }

  close(): void {}
}

export class StatementSync {
  run(..._args: unknown[]): { changes: number } {
    return { changes: 0 };
  }

  get(..._args: unknown[]): Record<string, unknown> {
    return {};
  }

  all(..._args: unknown[]): unknown[] {
    return [];
  }
}
