const BASE_Z_INDEX = 6000
const Z_INDEX_STEP = 10

/** 与 `registerModal` 首层蒙层一致，供阅读器浮层等压在蒙层之下 */
export const MODAL_STACK_BASE_Z_INDEX = BASE_Z_INDEX

/**
 * ReaderMain `.hlFloatRoot`（高亮笔尖/色盘，fixed 全视口）；
 * 须低于 `MODAL_STACK_BASE_Z_INDEX`。
 */
export const READER_HL_FLOAT_ROOT_Z_INDEX = MODAL_STACK_BASE_Z_INDEX - 20

/**
 * 顶栏等与阅读区 fixed 高亮浮层重叠的弹出层（如高亮词菜单）；
 * 须高于 `READER_HL_FLOAT_ROOT_Z_INDEX`，且低于 `registerModal` 首层（6000）。
 */
export const APP_CHROME_POPOVER_Z_INDEX = MODAL_STACK_BASE_Z_INDEX - 5

type StackEntry = {
  instanceId: number
  close: () => void
  getEscClosable: () => boolean
  setZIndex: (z: number) => void
}

const stack: StackEntry[] = []
/** 须在模态栈之前响应 ESC 的层（如大图灯箱），栈顶优先 */
const escBeforeModalCloseStack: Array<() => void> = []
let nextInstanceId = 0
let escListenerAttached = false

const modalStackListeners = new Set<() => void>()

function emitModalStackChange() {
  for (const fn of modalStackListeners) fn()
}

function zIndexForDepth(depth: number): number {
  return BASE_Z_INDEX + depth * Z_INDEX_STEP
}

function reassignStackZIndices() {
  for (let i = 0; i < stack.length; i++) {
    stack[i]!.setZIndex(zIndexForDepth(i))
  }
}

/** 模态入栈/出栈时回调（用于关闭与蒙层叠放无关的浮层） */
export function subscribeModalStackChange(listener: () => void): () => void {
  modalStackListeners.add(listener)
  return () => modalStackListeners.delete(listener)
}

/** 供全屏 ESC 等：有模态或有「先于模态」的 ESC 层时，不交给外层处理 */
export function hasModalOrEscBeforeModalLayer(): boolean {
  return stack.length > 0 || escBeforeModalCloseStack.length > 0
}

/** 仅模态栈（不含灯箱等 ESC 前置层） */
export function hasModalOnStack(): boolean {
  return stack.length > 0
}

/** 当前模态栈层数（供嵌套模态场景判断是否有更上层对话框） */
export function getModalStackDepth(): number {
  return stack.length
}

export type ModalStackEscResult = "closed" | "swallow" | "none"

/** 先于 AppModal 消费一次 ESC（栈顶关闭）；无层则 false */
function tryCloseEscBeforeModalTop(): boolean {
  const top = escBeforeModalCloseStack[escBeforeModalCloseStack.length - 1]
  if (!top) return false
  top()
  return true
}

/**
 * 注册在模态对话框之前响应 Esc 的关闭回调（如 `ReaderImageLightbox`）。
 * 打开时 push，须在关闭时调用返回的 unregister（与 `registerModal` 对称）。
 */
export function pushEscBeforeModal(close: () => void): () => void {
  escBeforeModalCloseStack.push(close)
  ensureEscListener()
  emitModalStackChange()
  return () => {
    const i = escBeforeModalCloseStack.lastIndexOf(close)
    if (i >= 0) escBeforeModalCloseStack.splice(i, 1)
    removeEscListenerIfIdle()
    emitModalStackChange()
  }
}

/** 供全屏 ESC 等逻辑判断 */
export function hasEscBeforeModalLayers(): boolean {
  return escBeforeModalCloseStack.length > 0
}

/** 栈顶无模态为 none；禁止 ESC 关闭为 swallow（应吞掉事件）；否则关闭并 closed */
export function resolveEscapeOnModalStack(): ModalStackEscResult {
  const top = stack[stack.length - 1]
  if (!top) return "none"
  if (!top.getEscClosable()) return "swallow"
  top.close()
  return "closed"
}

/** 若栈顶模态可用 ESC 关闭则关闭并返回 true（供全屏 ESC 链路与 document 监听共用） */
export function tryCloseTopModalFromEsc(): boolean {
  return resolveEscapeOnModalStack() === "closed"
}

function onDocumentKeydown(ev: KeyboardEvent) {
  if (ev.key !== "Escape") return
  if (tryCloseEscBeforeModalTop()) {
    ev.preventDefault()
    ev.stopPropagation()
    return
  }
  const r = resolveEscapeOnModalStack()
  if (r === "none") return
  ev.preventDefault()
  // 仅在实际关闭顶层模态时阻断冒泡；swallow 时让事件继续到达内部控件（如先清空再关）
  if (r === "closed") {
    ev.stopPropagation()
  }
}

function ensureEscListener() {
  if (escListenerAttached) return
  document.addEventListener("keydown", onDocumentKeydown, true)
  escListenerAttached = true
}

function removeEscListenerIfIdle() {
  if (
    stack.length > 0 ||
    escBeforeModalCloseStack.length > 0 ||
    !escListenerAttached
  ) {
    return
  }
  document.removeEventListener("keydown", onDocumentKeydown, true)
  escListenerAttached = false
}

/**
 * 打开模态时注册：栈顶优先响应 ESC（仅关闭最顶层，不会跳过上层去关下层）；z-index 随栈深递增。
 * 关闭时必须调用返回的 unregister（通常在 v-model 变为 false 时）。
 * `bringToFront`：已打开的模态移到栈顶并抬升 z-index（不销毁重开）。
 */
export function registerModal(opts: {
  close: () => void
  getEscClosable: () => boolean
  setZIndex: (z: number) => void
}): { zIndex: number; unregister: () => void; bringToFront: () => void } {
  const instanceId = ++nextInstanceId
  const zIndex = zIndexForDepth(stack.length)
  const entry: StackEntry = {
    instanceId,
    close: opts.close,
    getEscClosable: opts.getEscClosable,
    setZIndex: opts.setZIndex,
  }
  stack.push(entry)
  ensureEscListener()
  emitModalStackChange()

  return {
    zIndex,
    bringToFront: () => {
      const idx = stack.findIndex((e) => e.instanceId === instanceId)
      if (idx < 0) return
      if (idx === stack.length - 1) return
      stack.splice(idx, 1)
      stack.push(entry)
      reassignStackZIndices()
      emitModalStackChange()
    },
    unregister: () => {
      const idx = stack.findIndex((e) => e.instanceId === instanceId)
      if (idx >= 0) stack.splice(idx, 1)
      reassignStackZIndices()
      removeEscListenerIfIdle()
      emitModalStackChange()
    },
  }
}

/**
 * 点击是否落在 z-index **高于** `belowZ` 的 AppModal 上。
 * 查词/翻译浮层点外部关闭时：忽略叠在其上的「词典管理 / 翻译设置」，
 * 但不把找书阅读器等**下层** AppModal 误判为「上层」。
 */
export function isPointerOnAppModalAbove(
  target: EventTarget | null,
  belowZ: number,
): boolean {
  if (!(target instanceof Element)) return false
  const backdrop = target.closest(".appModalBackdrop")
  if (!(backdrop instanceof HTMLElement)) return false
  const z = Number.parseInt(getComputedStyle(backdrop).zIndex, 10)
  return Number.isFinite(z) && z > belowZ
}
