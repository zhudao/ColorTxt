/** IPC 只能传递可结构化克隆的纯对象，需剥离 Vue 响应式代理 */
export function ipcPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
