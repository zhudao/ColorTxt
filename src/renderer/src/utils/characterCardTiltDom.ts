import {
  CARD_SPRING_SNAP_ROTATE,
  CARD_SPRING_SNAP_ROTATE_KICK,
  isSpringSettled,
  stepSpringScalar,
} from "./characterCardSpring";

const TILT_DIVISOR = 3.5;
/** 与 CharacterRosterCard 列表小卡一致 */
export const ROSTER_CARD_TILT_SCALE = 0.4;

const GHOST_DRAG_SCALE = 1.1;
const GHOST_DRAG_SCALE_TRANSITION =
  "transform 0.26s cubic-bezier(0.25, 0.8, 0.25, 1), filter 0.26s cubic-bezier(0.25, 0.8, 0.25, 1)";
const GHOST_DRAG_SHADOW = "drop-shadow(0 16px 32px rgba(0, 0, 0, 0.32))";
const GHOST_RELEASE_MS = 280;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function applyFlyerBox(el: HTMLElement, rect: DOMRect) {
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.top}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
}

/** Sortable 挂上 dragClass 的同一帧无法触发 CSS 过渡，须先 reflow 再设目标值 */
export function animateGhostWrapScaleUp(wrapEl: HTMLElement) {
  wrapEl.style.transform = "scale(1)";
  wrapEl.style.filter = "none";
  wrapEl.style.transition = "none";
  void wrapEl.offsetWidth;
  wrapEl.style.transition = GHOST_DRAG_SCALE_TRANSITION;
  wrapEl.style.transform = `scale(${GHOST_DRAG_SCALE})`;
  wrapEl.style.filter = GHOST_DRAG_SHADOW;
}

/** pointerup 时克隆跟手层，待 onEnd 落位后再启动飞回动画。 */
export function prepareReleaseFlyerClone(ghostSlot: HTMLElement): HTMLElement {
  const flyer = ghostSlot.cloneNode(true) as HTMLElement;
  flyer.classList.remove("cardGridSlot--drag");
  flyer.classList.add("cardGridReleaseFlyer");
  Object.assign(flyer.style, {
    position: "fixed",
    margin: "0",
    boxSizing: "border-box",
    zIndex: "10051",
    pointerEvents: "none",
    visibility: "visible",
    opacity: "1",
    transformOrigin: "top left",
  });
  const wrap = flyer.querySelector<HTMLElement>(".cardShellWrap");
  if (wrap) {
    wrap.style.display = "block";
    wrap.style.visibility = "visible";
    wrap.style.transition = "none";
    wrap.style.transform = `scale(${GHOST_DRAG_SCALE})`;
    wrap.style.filter = GHOST_DRAG_SHADOW;
  }
  return flyer;
}

/**
 * 松手后飞回落位格：位置用 translate 直线插值，避免同时改 left/top/width/height 造成拐弯。
 */
export function playDragReleaseAnimation(opts: {
  flyer: HTMLElement;
  fromRect: DOMRect;
  targetRect: DOMRect;
  onDone?: () => void;
}): () => void {
  const { flyer, fromRect, targetRect, onDone } = opts;
  const from = fromRect;
  const to = targetRect;
  const dx = to.left - from.left;
  const dy = to.top - from.top;

  applyFlyerBox(flyer, from);
  flyer.style.transform = "translate(0px, 0px)";
  document.body.appendChild(flyer);

  const targetMarker = document.createElement("div");
  targetMarker.className = "cardGridReleaseTarget";
  Object.assign(targetMarker.style, {
    position: "fixed",
    margin: "0",
    boxSizing: "border-box",
    pointerEvents: "none",
    zIndex: "10040",
  });
  applyFlyerBox(targetMarker, to);
  document.body.appendChild(targetMarker);

  const wrap = flyer.querySelector<HTMLElement>(".cardShellWrap");

  let rafId = 0;
  const start = performance.now();
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    if (rafId) cancelAnimationFrame(rafId);
    flyer.remove();
    targetMarker.remove();
    onDone?.();
  };

  const tick = (now: number) => {
    const t = easeOutCubic(Math.min(1, (now - start) / GHOST_RELEASE_MS));
    flyer.style.transform = `translate(${dx * t}px, ${dy * t}px)`;
    flyer.style.width = `${from.width + (to.width - from.width) * t}px`;
    flyer.style.height = `${from.height + (to.height - from.height) * t}px`;

    if (wrap) {
      const s = GHOST_DRAG_SCALE + (1 - GHOST_DRAG_SCALE) * t;
      wrap.style.transform = `scale(${s})`;
      if (t >= 1) wrap.style.filter = "none";
    }

    if (t < 1) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    finish();
  };

  rafId = requestAnimationFrame(tick);
  return finish;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, n));
}

function round(n: number, places = 3): number {
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

function adjust(
  value: number,
  fromMin: number,
  fromMax: number,
  toMin: number,
  toMax: number,
): number {
  return toMin + ((toMax - toMin) * (value - fromMin)) / (fromMax - fromMin);
}

function parseDegVar(style: CSSStyleDeclaration, name: string): number {
  const n = parseFloat(style.getPropertyValue(name));
  return Number.isFinite(n) ? n : 0;
}

function applyTiltVars(
  shellEl: HTMLElement,
  rotateX: number,
  rotateY: number,
  rotateScale: number,
) {
  const scale = rotateScale || 1;
  const center = {
    x: (-rotateX * TILT_DIVISOR) / scale,
    y: (rotateY * TILT_DIVISOR) / scale,
  };
  const percent = {
    x: clamp(round(center.x + 50)),
    y: clamp(round(center.y + 50)),
  };
  const fromCenter = clamp(
    Math.sqrt(center.x * center.x + center.y * center.y) / 50,
    0,
    1,
  );

  shellEl.style.setProperty("--char-rotate-x", `${round(rotateX)}deg`);
  shellEl.style.setProperty("--char-rotate-y", `${round(rotateY)}deg`);
  shellEl.style.setProperty("--char-pointer-x", `${percent.x}%`);
  shellEl.style.setProperty("--char-pointer-y", `${percent.y}%`);
  shellEl.style.setProperty(
    "--char-pointer-from-center",
    String(round(fromCenter)),
  );
  shellEl.style.setProperty(
    "--char-pointer-from-top",
    String(round(percent.y / 100)),
  );
  shellEl.style.setProperty(
    "--char-pointer-from-left",
    String(round(percent.x / 100)),
  );
  shellEl.style.setProperty(
    "--char-background-x",
    `${round(adjust(percent.x, 0, 100, 37, 63))}%`,
  );
  shellEl.style.setProperty(
    "--char-background-y",
    `${round(adjust(percent.y, 0, 100, 33, 67))}%`,
  );
  shellEl.style.setProperty("--char-card-opacity", "1");
}

/** 对任意角色卡 shell（含 Sortable 拖动克隆层）做与 useCharacterCardTilt.resetIdle 相同的弹簧回正 */
export function snapResetShellTilt(
  shellEl: HTMLElement,
  rotateScale = ROSTER_CARD_TILT_SCALE,
): () => void {
  const cs = getComputedStyle(shellEl);
  let rotateX = parseDegVar(cs, "--char-rotate-x");
  let rotateY = parseDegVar(cs, "--char-rotate-y");
  let velX = 0;
  let velY = 0;
  const kick = CARD_SPRING_SNAP_ROTATE_KICK;
  if (Math.abs(rotateX) > 0.25) velX = -rotateX * kick;
  if (Math.abs(rotateY) > 0.25) velY = -rotateY * kick;

  let rafId = 0;
  let lastTs = 0;

  const tick = (ts: number) => {
    if (!lastTs) {
      lastTs = ts;
      rafId = requestAnimationFrame(tick);
      return;
    }

    const dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    if (dt <= 0) {
      rafId = requestAnimationFrame(tick);
      return;
    }

    const rx = stepSpringScalar(
      rotateX,
      0,
      velX,
      CARD_SPRING_SNAP_ROTATE,
      dt,
    );
    const ry = stepSpringScalar(
      rotateY,
      0,
      velY,
      CARD_SPRING_SNAP_ROTATE,
      dt,
    );
    rotateX = rx.value;
    velX = rx.velocity;
    rotateY = ry.value;
    velY = ry.velocity;

    applyTiltVars(shellEl, rotateX, rotateY, rotateScale);

    if (
      !isSpringSettled(rotateX, 0, velX, 0.15) ||
      !isSpringSettled(rotateY, 0, velY, 0.15)
    ) {
      rafId = requestAnimationFrame(tick);
      return;
    }

    applyTiltVars(shellEl, 0, 0, rotateScale);
    rafId = 0;
  };

  rafId = requestAnimationFrame(tick);
  return () => {
    if (rafId) cancelAnimationFrame(rafId);
  };
}
