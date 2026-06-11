import { nextTick, onBeforeUnmount, onMounted, type Ref } from "vue";
import type ReaderMain from "../components/ReaderMain.vue";
import { isSupportedBookPath } from "../ebook/ebookFormat";
import {
  collectFsPathsFromDataTransfer,
  dataTransferLikelyHasExternalFiles,
} from "../utils/dragDropFsPaths";
import { formatTextEncodingLabel } from "@shared/textEncodingDisplay";
import { appAlert } from "../services/appDialog";
import {
  bindAppShortcuts,
  EDIT_MODE_MONACO_DEFERRED_ACTIONS,
} from "../services/shortcutService";
import { hasModalOrEscBeforeModalLayer } from "../utils/modalStack";
import { useAppFileSession } from "./useAppFileSession";
import { useTxtStreamPipeline } from "./useTxtStreamPipeline";
import type { ShortcutBindingMap } from "../services/shortcutRegistry";

type FileSession = ReturnType<typeof useAppFileSession>;
type Stream = ReturnType<typeof useTxtStreamPipeline>;

/** 侧栏任意区域拖入均合并进文件列表，不显示阅读区「打开文件」蒙层 */
function isOverSidebarImportDropZone(ev: DragEvent): boolean {
  for (const n of ev.composedPath()) {
    if (n instanceof HTMLElement && n.dataset.dropZone === "reader-sidebar") {
      return true;
    }
  }
  return false;
}

/** 键盘事件是否起源于阅读侧栏（活动栏 + 面板）；与全局快捷键捕获监听配合，避免侧栏输入触发阅读器快捷键 */
function keyboardEventFromReaderSidebar(ev: KeyboardEvent): boolean {
  for (const n of ev.composedPath()) {
    if (
      n instanceof HTMLElement &&
      n.hasAttribute("data-reader-sidebar-root")
    ) {
      return true;
    }
  }
  return false;
}

/** 焦点是否在主阅读器 Monaco 编辑器内（用于编辑模式下判断是否让出冲突快捷键） */
function keyboardTargetInsideReaderMonacoEditor(
  ev: KeyboardEvent,
  readerRef: Ref<InstanceType<typeof ReaderMain> | null>,
): boolean {
  const t = ev.target;
  if (!(t instanceof Node)) return false;
  const root = readerRef.value?.getReaderEditorDomNode?.() ?? null;
  return Boolean(root && root.contains(t));
}

export function useAppWindowBindings(deps: {
  readerRef: Ref<InstanceType<typeof ReaderMain> | null>;
  stream: Stream;
  fileSession: FileSession;
  persistWindowUnloadState: () => void;
  persistFileListCache: () => void;
  persistSettings: () => void;
  isFullscreenView: Ref<boolean>;
  showSidebar: Ref<boolean>;
  sidebarWidth: Ref<number>;
  /** 全屏时非 null，与 sidebarWidth 分离；拖拽只改此值 */
  fullscreenSidebarWidth: Ref<number | null>;
  resizingSidebar: Ref<boolean>;
  getSidebarMaxWidth: () => number;
  getSidebarMinWidth: () => number;
  clampSidebarWidthToViewport: () => void;
  updateFullscreenHeaderHover: (ev: MouseEvent) => void;
  updateFullscreenFooterHover: (ev: MouseEvent) => void;
  updateFullscreenSidebarHover: (ev: MouseEvent) => void;
  endSidebarResize: () => void;
  dismissFullscreenChromeForNativeExit: () => void;
  /** 全屏下鼠标移动时重置「空闲隐藏光标」计时 */
  bumpFullscreenCursorIdle: () => void;
  /** 全屏下记录指针坐标，供侧栏浮层关闭后判断是否应收起 */
  recordFullscreenPointer?: (ev: MouseEvent) => void;
  enterOrExitFullscreenView: () => Promise<void>;
  pulseChapterListCenter: (smooth: boolean) => void;
  syncChaptersAfterViewportSettled: () => void | Promise<void>;
  currentTheme: Ref<string>;
  readerFontSize: Ref<number>;
  readerLineHeightMultiple: Ref<number>;
  monacoFontFamily: Ref<string>;
  fileEncoding: Ref<string>;
  loading: Ref<boolean>;
  /** 打开文件流式读取进度 0–100；无总大小时为 null */
  loadingProgressPercent: Ref<number | null>;
  pendingRestorePhysicalLine: Ref<number | null>;
  pendingRestoreEditorViewState: Ref<unknown | null>;
  pendingRestoreViewportTopPhysicalLine: Ref<number | null>;
  pendingRestoreViewportAnchor: Ref<
    import("../reader/readerViewportAnchor").ReaderViewportRestoreAnchor | null
  >;
  compressBlankLines: Ref<boolean>;
  suppressFileListCenterAfterLoad: Ref<boolean>;
  suppressChapterListAutoScroll: Ref<boolean>;
  txtFiles: Ref<Array<{ name: string; path: string; size: number }>>;
  sidebarTab: Ref<import("../constants/readerSidebarTab").ReaderSidebarTab>;
  currentFile: Ref<string | null>;
  dirListScanning: Ref<boolean>;
  dirListCurrentName: Ref<string>;
  chapterRuleErrorText: Ref<string>;
  showChapterRulePanel: Ref<boolean>;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
  increaseLineHeight: () => void;
  decreaseLineHeight: () => void;
  openNewWindow: () => void;
  openFileViaDialog: () => Promise<void>;
  pickTxtDirectory: () => Promise<void>;
  onBookmarkClick: () => void;
  skipNextThemeNativeIpc: Ref<boolean>;
  jumpToPrevChapter: () => void;
  jumpToNextChapter: () => void;
  openSettings: () => void;
  openColorScheme: () => void;
  toggleFind: () => void;
  scrollDownLine: () => void;
  scrollUpLine: () => void;
  scrollPageUp: () => void;
  scrollPageDown: () => void;
  shortcutBindings: Ref<ShortcutBindingMap>;
  activeStreamRequestId: Ref<number | null>;
  activeStreamFilePath: Ref<string | null>;
  /** 流结束并完成阅读进度同步后为 true，此前 persistFileMeta 不写盘 */
  readingProgressSynced: Ref<boolean>;
  /** 拖入阅读区时，在阅读区容器上显示「打开文件」局部蒙层 */
  readerDropOverlayVisible: Ref<boolean>;
  /** 主进程拦截关窗后由渲染进程决定是否 `proceedCloseWindow` */
  handleWindowCloseRequest: () => Promise<void>;
  /** 编辑模式：焦点在 Monaco 内时，仅滚屏/查找等冲突快捷键交给编辑器，其余窗口快捷键仍生效 */
  readerEditMode: Ref<boolean>;
  /** 语音朗读播放中：禁用窗口级滚动/翻页快捷键 */
  voiceReadScrollLocked?: Ref<boolean>;
}) {
  const unsubscribers: Array<() => void> = [];

  onMounted(async () => {
    deps.readerRef.value?.setTheme(deps.currentTheme.value);
    deps.readerRef.value?.setFontSize(deps.readerFontSize.value);
    deps.readerRef.value?.setLineHeightMultiple(
      deps.readerLineHeightMultiple.value,
    );
    deps.readerRef.value?.setFontFamily(deps.monacoFontFamily.value);

    const flushChapterListAfterFullscreenMs = 50;

    const onFullscreenChange = (payload: { isFullscreen: boolean }) => {
      const inFs = payload.isFullscreen;
      deps.isFullscreenView.value = inFs;
      if (inFs) {
        void nextTick(() => {
          requestAnimationFrame(() => {
            deps.readerRef.value?.focusEditor?.();
            window.setTimeout(() => {
              deps.pulseChapterListCenter(false);
            }, flushChapterListAfterFullscreenMs);
          });
        });
        return;
      }
      if (!inFs) {
        deps.dismissFullscreenChromeForNativeExit();
        void nextTick(() => {
          requestAnimationFrame(() => {
            window.setTimeout(() => {
              deps.pulseChapterListCenter(false);
            }, flushChapterListAfterFullscreenMs);
          });
        });
      }
    };
    unsubscribers.push(window.colorTxt.onFullscreenChanged(onFullscreenChange));

    const onDocumentKeydownEscapeFullscreen = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (!deps.isFullscreenView.value) return;
      const target = ev.target;
      if (
        target instanceof HTMLElement &&
        target.classList.contains("fileItemRenameInput")
      ) {
        // 文件重命名输入框优先处理 Esc（取消重命名），不应触发退出全屏。
        return;
      }
      // 有模态时仅由 modalStack 的捕获监听 resolve 一次；此处再 resolve 会关两层
      if (hasModalOrEscBeforeModalLayer()) return;
      if (keyboardEventFromReaderSidebar(ev)) return;
      if (
        deps.readerEditMode.value &&
        keyboardTargetInsideReaderMonacoEditor(ev, deps.readerRef)
      ) {
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      if (deps.readerRef.value?.isFindWidgetRevealed?.()) {
        deps.readerRef.value?.toggleFindWidget?.();
        return;
      }
      void window.colorTxt.setFullscreen(false).catch(() => {});
    };
    document.addEventListener(
      "keydown",
      onDocumentKeydownEscapeFullscreen,
      true,
    );
    unsubscribers.push(() =>
      document.removeEventListener(
        "keydown",
        onDocumentKeydownEscapeFullscreen,
        true,
      ),
    );

    unsubscribers.push(
      window.colorTxt.onThemeSync((theme) => {
        if (theme !== "vs" && theme !== "vs-dark") return;
        if (theme === deps.currentTheme.value) return;
        deps.skipNextThemeNativeIpc.value = true;
        deps.currentTheme.value = theme;
      }),
    );

    unsubscribers.push(
      bindAppShortcuts(
        {
          openSettings: deps.openSettings,
          openColorScheme: deps.openColorScheme,
          toggleFullscreen: deps.enterOrExitFullscreenView,
          increaseFontSize: deps.increaseFontSize,
          decreaseFontSize: deps.decreaseFontSize,
          increaseLineHeight: deps.increaseLineHeight,
          decreaseLineHeight: deps.decreaseLineHeight,
          toggleSidebar: () => {
            deps.showSidebar.value = !deps.showSidebar.value;
          },
          openNewWindow: deps.openNewWindow,
          openFile: deps.openFileViaDialog,
          pickTxtDirectory: deps.pickTxtDirectory,
          openChapterRules: () => {
            deps.chapterRuleErrorText.value = "";
            deps.showChapterRulePanel.value = true;
          },
          toggleBookmark: deps.onBookmarkClick,
          jumpToPrevChapter: deps.jumpToPrevChapter,
          jumpToNextChapter: deps.jumpToNextChapter,
          toggleFind: deps.toggleFind,
          scrollDownLine: deps.scrollDownLine,
          scrollUpLine: deps.scrollUpLine,
          scrollPageUp: deps.scrollPageUp,
          scrollPageDown: deps.scrollPageDown,
        },
        () => deps.shortcutBindings.value,
        (ev) =>
          !hasModalOrEscBeforeModalLayer() &&
          !keyboardEventFromReaderSidebar(ev) &&
          !deps.voiceReadScrollLocked?.value,
        (action, ev) =>
          deps.readerEditMode.value &&
          keyboardTargetInsideReaderMonacoEditor(ev, deps.readerRef) &&
          EDIT_MODE_MONACO_DEFERRED_ACTIONS.has(action),
      ),
    );

    if (!window.colorTxt) {
      await appAlert(
        `preload 未注入（__COLORTXT_PRELOAD__=${String(
          (window as unknown as { __COLORTXT_PRELOAD__?: unknown })
            .__COLORTXT_PRELOAD__,
        )}）`,
      );
      return;
    }
    const globalShortcutResult = await window.colorTxt.setGlobalShortcut(
      deps.shortcutBindings.value.toggleAllWindowsVisibility,
    );
    if (!globalShortcutResult.ok) {
      await appAlert(globalShortcutResult.message || "系统级快捷键设置失败");
    }

    const streamMatchesCurrent = (payload: {
      filePath: string;
      sessionFilePath?: string;
    }) =>
      (payload.sessionFilePath ?? payload.filePath) === deps.currentFile.value;

    unsubscribers.push(
      window.colorTxt.onStreamStart((payload) => {
        if (!streamMatchesCurrent(payload)) return;
        deps.activeStreamRequestId.value = payload.requestId;
        deps.activeStreamFilePath.value = payload.filePath;
        deps.fileEncoding.value = formatTextEncodingLabel(
          payload.encoding || "-",
        );
        const total = payload.totalBytes;
        deps.loadingProgressPercent.value = total > 0 ? 0 : null;
      }),
      window.colorTxt.onStreamChunk((payload) => {
        if (!streamMatchesCurrent(payload)) return;
        if (
          deps.activeStreamRequestId.value == null ||
          payload.requestId !== deps.activeStreamRequestId.value ||
          payload.filePath !== deps.activeStreamFilePath.value
        ) {
          return;
        }
        deps.stream.processChunk(payload.text);
        const total = payload.totalBytes;
        if (total > 0) {
          deps.loadingProgressPercent.value = Math.min(
            100,
            Math.round((payload.readBytes / total) * 100),
          );
        }
      }),
      window.colorTxt.onStreamEnd((payload) => {
        void (async () => {
          if (!streamMatchesCurrent(payload)) return;
          if (
            deps.activeStreamRequestId.value == null ||
            payload.requestId !== deps.activeStreamRequestId.value ||
            payload.filePath !== deps.activeStreamFilePath.value
          ) {
            return;
          }
          deps.activeStreamRequestId.value = null;
          deps.activeStreamFilePath.value = null;
          await deps.stream.flushCarry();
          deps.loading.value = false;
          deps.loadingProgressPercent.value = null;
          const restoreVs = deps.pendingRestoreEditorViewState.value;
          deps.pendingRestoreEditorViewState.value = null;
          const restoreAnchorPhy =
            deps.pendingRestoreViewportTopPhysicalLine.value;
          deps.pendingRestoreViewportTopPhysicalLine.value = null;
          const restorePhys = deps.pendingRestorePhysicalLine.value;
          deps.pendingRestorePhysicalLine.value = null;
          const restoreViewportAnchor = deps.pendingRestoreViewportAnchor.value;
          deps.pendingRestoreViewportAnchor.value = null;
          const totalPhysical = Math.max(1, deps.stream.getPhysicalLineCount());

          const markReadingProgressSynced = () => {
            deps.readingProgressSynced.value = true;
          };

          const finishReadingSync = () => {
            deps.readerRef.value?.normalizeScrollAfterEmbeddedViewZones?.();
            deps.readerRef.value?.emitProbeLine();
            const runChapterSync = () => {
              void Promise.resolve(deps.syncChaptersAfterViewportSettled()).then(
                () => {
                  markReadingProgressSynced();
                },
              );
            };
            const ric = (
              globalThis as typeof globalThis & {
                requestIdleCallback?: (
                  cb: () => void,
                  opts?: { timeout: number },
                ) => number;
              }
            ).requestIdleCallback;
            if (typeof ric === "function") {
              ric(() => runChapterSync(), { timeout: 3000 });
            } else {
              window.setTimeout(runChapterSync, 0);
            }
          };

          if (
            restoreVs != null &&
            typeof restoreVs === "object" &&
            !Array.isArray(restoreVs) &&
            restoreAnchorPhy != null &&
            Number.isFinite(restoreAnchorPhy)
          ) {
            const anchor = Math.max(1, Math.floor(restoreAnchorPhy));
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                deps.readerRef.value?.restoreEditorViewState?.(restoreVs);
                void nextTick(() => {
                  const reader = deps.readerRef.value;
                  if (!reader?.getViewportTopLine || !reader.jumpToLine) {
                    finishReadingSync();
                    return;
                  }
                  const current = deps.stream.viewportDisplayLineToPhysicalLine(
                    reader.getViewportTopLine(),
                  );
                  if (current === anchor) {
                    finishReadingSync();
                    return;
                  }
                  if (anchor >= totalPhysical) {
                    reader.scrollToBottom?.(false);
                    void nextTick(finishReadingSync);
                    return;
                  }
                  let displayLine =
                    deps.stream.physicalLineToDisplayForReader(anchor);
                  const maxDisplay = Math.max(1, deps.stream.getLineCount());
                  displayLine = Math.min(Math.max(1, displayLine), maxDisplay);
                  if (displayLine <= 1) {
                    reader.jumpToLine?.(1, false);
                  } else {
                    reader.jumpToLine(displayLine, false);
                  }
                  void nextTick(finishReadingSync);
                });
              });
            });
            return;
          }

          if (restoreViewportAnchor != null) {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const map = deps.stream.getDisplayLineToPhysicalLine();
                void Promise.resolve(
                  deps.readerRef.value?.restoreViewportToRestoreAnchor?.(
                    restoreViewportAnchor,
                    map.length > 0 ? [...map] : undefined,
                  ),
                ).then(() => {
                  void nextTick(() => {
                    deps.readerRef.value?.normalizeScrollAfterEmbeddedViewZones?.();
                    deps.readerRef.value?.emitProbeLine();
                    void Promise.resolve(
                      deps.syncChaptersAfterViewportSettled(),
                    ).then(() => {
                      markReadingProgressSynced();
                    });
                  });
                });
              });
            });
            return;
          }

          let jumpLine: number | null = null;
          if (restorePhys != null && restorePhys >= totalPhysical) {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                deps.readerRef.value?.scrollToBottom?.(false);
                void nextTick(() => {
                  deps.readerRef.value?.normalizeScrollAfterEmbeddedViewZones?.();
                  deps.readerRef.value?.emitProbeLine();
                  void Promise.resolve(
                    deps.syncChaptersAfterViewportSettled(),
                  ).then(() => {
                    markReadingProgressSynced();
                  });
                });
              });
            });
            return;
          }

          if (restorePhys != null) {
            jumpLine = deps.stream.physicalLineToBottomDisplayForReader(
              Math.min(restorePhys, totalPhysical),
            );
            const maxDisplay = Math.max(1, deps.stream.getLineCount());
            jumpLine = Math.min(Math.max(1, jumpLine), maxDisplay);
          }

          if (jumpLine != null) {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const reader = deps.readerRef.value;
                if (reader) {
                  /** 篇首：用顶对齐 jumpToLine(1)；随后 nextTick 里 normalize 会把「篇首插图」时的 scrollTop≈top1 钳到 0。 */
                  if (jumpLine <= 1) {
                    reader.jumpToLine?.(1, false);
                  } else {
                    reader.scrollLineToBottom?.(jumpLine, false);
                  }
                }
                void nextTick(() => {
                  deps.readerRef.value?.normalizeScrollAfterEmbeddedViewZones?.();
                  deps.readerRef.value?.emitProbeLine();
                  void Promise.resolve(
                    deps.syncChaptersAfterViewportSettled(),
                  ).then(() => {
                    markReadingProgressSynced();
                  });
                });
              });
            });
          } else {
            void nextTick(() => {
              deps.readerRef.value?.normalizeScrollAfterEmbeddedViewZones?.();
              deps.readerRef.value?.emitProbeLine();
              void Promise.resolve(deps.syncChaptersAfterViewportSettled()).then(
                () => {
                  markReadingProgressSynced();
                },
              );
            });
          }
        })();
      }),
      window.colorTxt.onStreamError((e) => {
        if (!streamMatchesCurrent(e)) return;
        if (
          deps.activeStreamRequestId.value == null ||
          e.requestId !== deps.activeStreamRequestId.value ||
          e.filePath !== deps.activeStreamFilePath.value
        ) {
          return;
        }
        deps.activeStreamRequestId.value = null;
        deps.activeStreamFilePath.value = null;
        deps.loading.value = false;
        deps.loadingProgressPercent.value = null;
        deps.pendingRestorePhysicalLine.value = null;
        deps.pendingRestoreEditorViewState.value = null;
        deps.pendingRestoreViewportTopPhysicalLine.value = null;
        deps.pendingRestoreViewportAnchor.value = null;
        deps.suppressFileListCenterAfterLoad.value = false;
        deps.suppressChapterListAutoScroll.value = false;
        deps.readingProgressSynced.value = true;
        void appAlert(`读取失败：${e.message}`);
      }),
    );

    /** 非文件列表区域 drop：仅打开拖入列表中最外层第一个支持的文件 */
    async function openFirstSupportedTopLevelPath(paths: string[]) {
      for (const p of paths) {
        try {
          const st = await window.colorTxt.stat(p);
          if (!st.isFile) continue;
          if (!isSupportedBookPath(p)) continue;
          await deps.fileSession.openFilePath(p);
          return;
        } catch {
          /* 跳过该路径 */
        }
      }
    }

    function clearReaderDropOverlay() {
      deps.readerDropOverlayVisible.value = false;
    }

    function syncReaderDropOverlayFromEvent(ev: DragEvent) {
      const dt = ev.dataTransfer;
      if (!dataTransferLikelyHasExternalFiles(dt)) {
        clearReaderDropOverlay();
        return;
      }
      if (isOverSidebarImportDropZone(ev)) {
        clearReaderDropOverlay();
        return;
      }
      /** 侧栏以外（含顶栏、底栏、阅读区等）在阅读区容器上提示「打开文件」 */
      deps.readerDropOverlayVisible.value = true;
    }

    const onDragOver = (ev: DragEvent) => {
      if (!dataTransferLikelyHasExternalFiles(ev.dataTransfer)) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
      syncReaderDropOverlayFromEvent(ev);
    };

    const onDragEnter = (ev: DragEvent) => {
      if (!dataTransferLikelyHasExternalFiles(ev.dataTransfer)) return;
      ev.preventDefault();
      syncReaderDropOverlayFromEvent(ev);
    };

    const onWindowDragLeave = (ev: DragEvent) => {
      if (!dataTransferLikelyHasExternalFiles(ev.dataTransfer)) return;
      const related = ev.relatedTarget;
      if (
        related instanceof Node &&
        document.documentElement.contains(related)
      ) {
        return;
      }
      clearReaderDropOverlay();
    };

    const onWindowDragEnd = () => {
      clearReaderDropOverlay();
    };

    const onDrop = (ev: DragEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      clearReaderDropOverlay();

      const paths = collectFsPathsFromDataTransfer(ev.dataTransfer);
      if (paths.length === 0) return;

      void openFirstSupportedTopLevelPath(paths);
    };

    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("dragenter", onDragEnter, true);
    window.addEventListener("dragleave", onWindowDragLeave, true);
    document.addEventListener("drop", onDrop, false);
    window.addEventListener("dragend", onWindowDragEnd, false);
    unsubscribers.push(() =>
      window.removeEventListener("dragover", onDragOver, true),
    );
    unsubscribers.push(() =>
      window.removeEventListener("dragenter", onDragEnter, true),
    );
    unsubscribers.push(() =>
      window.removeEventListener("dragleave", onWindowDragLeave, true),
    );
    unsubscribers.push(() =>
      document.removeEventListener("drop", onDrop, false),
    );
    unsubscribers.push(() =>
      window.removeEventListener("dragend", onWindowDragEnd, false),
    );

    const onMouseMove = (ev: MouseEvent) => {
      if (deps.resizingSidebar.value) {
        const next = Math.min(
          deps.getSidebarMaxWidth(),
          Math.max(deps.getSidebarMinWidth(), ev.clientX),
        );
        if (
          deps.isFullscreenView.value &&
          deps.fullscreenSidebarWidth.value != null
        ) {
          deps.fullscreenSidebarWidth.value = next;
        } else {
          deps.sidebarWidth.value = next;
        }
      }
      deps.updateFullscreenHeaderHover(ev);
      deps.updateFullscreenFooterHover(ev);
      deps.updateFullscreenSidebarHover(ev);
      if (deps.isFullscreenView.value) {
        deps.recordFullscreenPointer?.(ev);
      }
      if (deps.isFullscreenView.value && !deps.resizingSidebar.value) {
        deps.bumpFullscreenCursorIdle();
      }
    };
    const onResize = () => {
      deps.clampSidebarWidthToViewport();
    };
    window.addEventListener("resize", onResize);
    const onMouseUp = () => {
      const wasResizing = deps.resizingSidebar.value;
      deps.endSidebarResize();
      if (wasResizing) {
        deps.persistSettings();
      }
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    unsubscribers.push(() =>
      document.removeEventListener("mousemove", onMouseMove),
    );
    unsubscribers.push(() =>
      document.removeEventListener("mouseup", onMouseUp),
    );
    unsubscribers.push(() => window.removeEventListener("resize", onResize));

    const flushPersistence = () => {
      deps.persistWindowUnloadState();
      deps.persistSettings();
    };
    window.addEventListener("pagehide", flushPersistence);
    unsubscribers.push(() =>
      window.removeEventListener("pagehide", flushPersistence),
    );
    // Electron/Windows 下个别关闭路径对 pagehide 不可靠，beforeunload 作兜底
    window.addEventListener("beforeunload", flushPersistence);
    unsubscribers.push(() =>
      window.removeEventListener("beforeunload", flushPersistence),
    );

    deps.clampSidebarWidthToViewport();
    await nextTick();

    unsubscribers.push(
      window.colorTxt.onOpenTxtFromShell((filePath) => {
        void deps.fileSession.openFilePath(filePath);
      }),
    );

    unsubscribers.push(
      window.colorTxt.onWindowRequestClose(() => {
        void deps.handleWindowCloseRequest();
      }),
    );

    const pendingShellTxt = await window.colorTxt.consumePendingOpenTxtPath();
    if (pendingShellTxt) {
      await deps.fileSession.openFilePath(pendingShellTxt);
    }

    // 文件列表独立持久化：始终恢复，和“恢复上次阅读会话”开关解耦
    deps.fileSession.restoreFileListFromSession();

    const shouldRestoreSession = await window.colorTxt.shouldRestoreSession();
    if (shouldRestoreSession) {
      await deps.fileSession.tryRestoreSession();
    }
  });

  onBeforeUnmount(() => {
    deps.persistWindowUnloadState();
    for (const u of unsubscribers) u();
  });
}
