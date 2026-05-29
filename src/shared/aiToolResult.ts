/** 根据工具消息 JSON 是否含 error 字段推断成功/失败（DB 重载与流式 tool_result 共用） */
export function inferToolResultOk(content: string): boolean {
  const raw = content.trim();
  if (!raw) return true;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return true;
    const err = (o as Record<string, unknown>).error;
    return !(typeof err === "string" && err.trim() !== "");
  } catch {
    return true;
  }
}
