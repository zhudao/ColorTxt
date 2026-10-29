import type { FindBookDownloadAfterAction } from "../constants/findBookSettings";
import { addFindBookDownloadToMainFileList } from "./findBookDownloadToFileList";
import { appToast } from "../../services/appToast";

export type FindBookDownloadPostActionOptions = {
  addToMainFileList: boolean;
  defaultCategory: string;
  afterAction: FindBookDownloadAfterAction;
};

export async function runFindBookDownloadAfterAction(
  filePath: string,
  size: number,
  options: FindBookDownloadPostActionOptions,
) {
  if (options.addToMainFileList) {
    addFindBookDownloadToMainFileList(
      filePath,
      size,
      options.defaultCategory,
    );
  }

  switch (options.afterAction) {
    case "none":
      appToast(
        options.addToMainFileList
          ? "下载完成，已加入主界面文件列表"
          : "下载完成",
        { kind: "success" },
      );
      return;
    case "openMain":
      await window.colorTxt.openFileInMainWindow(filePath);
      appToast("下载完成，已在主界面打开", { kind: "success" });
      return;
    case "openNewWindow":
      window.colorTxt.openFileInNewWindow(filePath);
      appToast("下载完成，已在新窗口打开", { kind: "success" });
      return;
  }
}
