import { appConfirm } from "../../services/appDialog";
import { appToast } from "../../services/appToast";
import { APP_DISPLAY_NAME } from "../../constants/appUi";

/** 确认后清除单本书离线章节缓存；成功返回 true */
export async function confirmClearBookChapterCache(opts: {
  name: string;
  bookUrl: string;
  cacheDir?: string;
}): Promise<boolean> {
  const bookUrl = opts.bookUrl.trim();
  if (!bookUrl) {
    appToast("书籍 URL 为空", { kind: "warning" });
    return false;
  }
  const ok = await appConfirm("是否清除本书的离线章节缓存？", "清除缓存");
  if (!ok) return false;
  try {
    const res = await window.colorTxt.bookSourceClearChapterCache({
      name: opts.name.trim(),
      bookUrl,
      cacheDir: opts.cacheDir?.trim() || undefined,
    });
    if (!res.ok) {
      appToast(res.message || "清除缓存失败", { kind: "warning" });
      return false;
    }
    appToast("已清除本书缓存", { kind: "success", duration: 1200 });
    return true;
  } catch {
    appToast("清除缓存失败", { kind: "warning" });
    return false;
  }
}

/** 确认后清除缓存目录下的全部章节正文离线缓存；成功返回 true */
export async function confirmClearAllChapterCache(opts?: {
  cacheDir?: string;
}): Promise<boolean> {
  const r = await window.colorTxt.showMessageBox({
    type: "warning",
    title: APP_DISPLAY_NAME,
    buttons: ["取消", "清除"],
    defaultId: 1,
    cancelId: 0,
    message: "是否清除全部章节正文离线缓存？",
    detail: "将删除缓存目录下的全部章节正文缓存；下载的整书文件不受影响。",
    noLink: true,
  });
  if (r.response !== 1) return false;
  try {
    const res = await window.colorTxt.bookSourceClearAllChapterCache({
      cacheDir: opts?.cacheDir?.trim() || undefined,
    });
    if (!res.ok) {
      appToast(res.message || "清除缓存失败", { kind: "warning" });
      return false;
    }
    appToast("已清除全部缓存", { kind: "success", duration: 1200 });
    return true;
  } catch {
    appToast("清除缓存失败", { kind: "warning" });
    return false;
  }
}
