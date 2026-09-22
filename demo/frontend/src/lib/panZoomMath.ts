/**
 * Pure pan/zoom maths shared by usePanZoom and the game's placement hit-testing
 * (plan-technical.md §C.3). No React, no DOM — takes a measured client rect and a viewBox and
 * returns plain numbers, so it can be unit-tested without mounting anything.
 */

export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** px per user-space unit for `preserveAspectRatio="xMidYMid meet"` — the letterboxing scale. */
export function scaleOf(rect: ClientRect, vb: ViewBox): number {
  return Math.min(rect.width / vb.w, rect.height / vb.h);
}

/**
 * Client (screen) point -> user-space (map) point, honouring `preserveAspectRatio="xMidYMid
 * meet"`: the content is centred inside the element on whichever axis is not fully covered by the
 * scale (the letterbox). Same maths as the private `pt()` this replaces in usePanZoom.
 */
export function clientToMap(
  rect: ClientRect,
  vb: ViewBox,
  clientX: number,
  clientY: number
): { x: number; y: number; sc: number } {
  const sc = scaleOf(rect, vb);
  const ox = (rect.width - vb.w * sc) / 2;
  const oy = (rect.height - vb.h * sc) / 2;
  return {
    x: vb.x + (clientX - rect.left - ox) / sc,
    y: vb.y + (clientY - rect.top - oy) / sc,
    sc,
  };
}

export interface TapPoint {
  x: number;
  y: number;
  t: number;
}

/**
 * A tap is a pointer-up close to, and soon after, its pointer-down (ux B.3): within `maxMovePx`
 * screen pixels and `maxMs` milliseconds. Points are client (screen) coordinates, not map units —
 * the threshold is meant to stay constant regardless of zoom.
 */
export function isTap(down: TapPoint, up: TapPoint, maxMovePx = 8, maxMs = 300): boolean {
  const dist = Math.hypot(up.x - down.x, up.y - down.y);
  const dt = up.t - down.t;
  return dist <= maxMovePx && dt <= maxMs;
}
