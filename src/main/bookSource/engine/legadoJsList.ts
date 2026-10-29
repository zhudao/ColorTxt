/** Legado/Rhino：java.getStringList / java.getElements 返回可 .toArray() 的列表 */
export type LegadoJsList<T = unknown> = {
  toArray(): T[];
  isEmpty(): boolean;
  size(): number;
  get(index: number): T | undefined;
  length: number;
  [Symbol.iterator](): Iterator<T>;
};

export function legadoJsList<T>(items: readonly T[]): LegadoJsList<T> {
  const arr = [...items];
  return {
    toArray: () => [...arr],
    isEmpty: () => arr.length === 0,
    size: () => arr.length,
    get: (index: number) => arr[index],
    length: arr.length,
    [Symbol.iterator]: () => arr[Symbol.iterator](),
  };
}

function isAsyncFunction(fn: unknown): boolean {
  return (
    typeof fn === "function" &&
    (fn as { constructor?: { name?: string } }).constructor?.name ===
      "AsyncFunction"
  );
}

/**
 * 给原生数组挂上 Legado `List.toArray()` 等 API（保持 `Array.isArray`）。
 * 规则链 JSONPath → `<js>` 时 result 常为数组，部分书源会调 `result.toArray()`。
 *
 * 另：`map(async …)` 改为串行 await（对齐 Rhino 同步 map）。
 * Node 把 `await java.ajax` 升成 async 后若仍用原生 map，会一次打出全部请求
 *（如搜索 list 对每项再 ajax 详情 → 限流 / TimeoutError）。
 */
/** 挂到数组上的 List API 必须不可枚举：书源常用 `for (i in $)`，可枚举方法会当成 $[i] */
function defineLegadoListMethod(
  arr: object,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(arr, key, {
    configurable: true,
    writable: true,
    enumerable: false,
    value,
  });
}

export function ensureLegadoListApi<T = unknown>(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const arr = value as T[] &
    Partial<LegadoJsList<T>> & {
      __legadoSequentialAsyncMap?: boolean;
      map: typeof Array.prototype.map;
    };
  if (typeof arr.toArray !== "function") {
    defineLegadoListMethod(arr, "toArray", function (this: T[]) {
      return this.slice();
    });
    defineLegadoListMethod(arr, "isEmpty", function (this: T[]) {
      return this.length === 0;
    });
    defineLegadoListMethod(arr, "size", function (this: T[]) {
      return this.length;
    });
    defineLegadoListMethod(arr, "get", function (this: T[], index: number) {
      return this[index];
    });
  }
  if (!arr.__legadoSequentialAsyncMap) {
    defineLegadoListMethod(
      arr,
      "map",
      function (
        this: T[],
        callback: (item: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ) {
        if (!isAsyncFunction(callback)) {
          return Array.prototype.map.call(this, callback as never, thisArg);
        }
        const list = this;
        return (async () => {
          const out: unknown[] = [];
          for (let i = 0; i < list.length; i++) {
            out.push(
              await (
                callback as (
                  item: T,
                  index: number,
                  array: T[],
                ) => Promise<unknown>
              ).call(thisArg, list[i]!, i, list),
            );
          }
          return out;
        })();
      },
    );
    defineLegadoListMethod(arr, "__legadoSequentialAsyncMap", true);
  }
  return arr;
}

export async function legadoJsListFrom<T>(
  value: unknown,
): Promise<LegadoJsList<T>> {
  if (value && typeof value === "object" && "toArray" in value) {
    return value as LegadoJsList<T>;
  }
  if (Array.isArray(value)) return legadoJsList(value as T[]);
  if (value == null || value === "") return legadoJsList<T>([]);
  return legadoJsList([value as T]);
}
