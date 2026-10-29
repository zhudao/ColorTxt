/**
 * 全屏取色（渲染进程入口）。
 * 主进程截屏 + 覆盖层取样；其它功能只需调这一处，不必碰 IPC / 覆盖层。
 *
 * @returns 取样 `#rrggbb`；Esc / 右键取消或失败为 `null`
 */
export async function pickScreenColor(): Promise<string | null> {
  const pick = window.colorTxt?.eyedropperPick;
  if (typeof pick !== "function") return null;
  try {
    const hex = await pick();
    return typeof hex === "string" && /^#[0-9a-fA-F]{6}$/.test(hex)
      ? hex.toLowerCase()
      : null;
  } catch {
    return null;
  }
}
