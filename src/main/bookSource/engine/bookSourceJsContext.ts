import { AsyncLocalStorage } from "node:async_hooks";

import type { JsExtensionHost } from "./jsExtensions";

const hostStorage = new AsyncLocalStorage<JsExtensionHost>();

export function runWithBookSourceJsHost<T>(host: JsExtensionHost, fn: () => T): T {
  return hostStorage.run(host, fn);
}

export function runWithBookSourceJsHostAsync<T>(
  host: JsExtensionHost,
  fn: () => Promise<T>,
): Promise<T> {
  return hostStorage.run(host, fn);
}

export function getBookSourceJsHost(): JsExtensionHost | undefined {
  return hostStorage.getStore();
}
