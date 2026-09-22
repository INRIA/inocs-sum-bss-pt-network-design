/**
 * hitTest.ts — turn a tap on the map into a candidate station.
 *
 * Pointer capture on the SVG makes per-element `onClick` unreliable
 * (usePanZoom.ts:89), so placement is driven by one tap event from the camera
 * hook plus this pure function. Everything is in MAP units; the caller converts
 * the screen radius with the current scale, which keeps the touch target the
 * same physical size at every zoom.
 *
 * The ambiguous case is deliberate (plan-technical §B.3): two candidates inside
 * the radius place nothing and ask the map to zoom, rather than guessing and
 * making the visitor undo.
 *
 * Pure domain: no React, no DOM, no fetch, no node imports.
 */

export interface MapPoint {
  readonly x: number;
  readonly y: number;
}

/** A candidate as the hit test sees it: an id and a position in map units. */
export interface HitCandidate extends MapPoint {
  readonly id: number;
}

export type HitResult =
  | { readonly kind: 'hit'; readonly id: number }
  | { readonly kind: 'ambiguous'; readonly ids: readonly number[] }
  | { readonly kind: 'miss' };

/**
 * The candidate under `point`.
 *
 * @param candidates every candidate, in map units.
 * @param point      where the visitor tapped, in map units.
 * @param radius     the touch radius, in map units.
 * @returns `hit` when exactly one candidate is inside the radius (the nearest,
 *          if one is clearly nearest); `ambiguous` when two or more are within
 *          the radius AND within `ambiguityRatio` of each other's distance;
 *          `miss` when none is.
 */
export function hitTest(
  candidates: readonly HitCandidate[],
  point: MapPoint,
  radius: number,
  ambiguityRatio = 1.35,
): HitResult {
  if (radius <= 0) return { kind: 'miss' };
  const radiusSquared = radius * radius;
  const inside: { id: number; distanceSquared: number }[] = [];
  for (const candidate of candidates) {
    const dx = candidate.x - point.x;
    const dy = candidate.y - point.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared <= radiusSquared) inside.push({ id: candidate.id, distanceSquared });
  }
  if (inside.length === 0) return { kind: 'miss' };
  // Sort by distance, then by id, so the answer never depends on input order.
  inside.sort((a, b) => a.distanceSquared - b.distanceSquared || a.id - b.id);
  if (inside.length === 1) return { kind: 'hit', id: inside[0]!.id };

  const nearest = Math.sqrt(inside[0]!.distanceSquared);
  const contenders = inside.filter(
    (entry) => Math.sqrt(entry.distanceSquared) <= Math.max(nearest, 1e-12) * ambiguityRatio,
  );
  if (contenders.length > 1) {
    return { kind: 'ambiguous', ids: contenders.map((entry) => entry.id) };
  }
  return { kind: 'hit', id: inside[0]!.id };
}

/**
 * A tap is a pointer-up close to, and soon after, the pointer-down; a drag
 * never places. Mirrors plan-technical §B.3: 8 px and 300 ms.
 */
export function isTap(
  downX: number,
  downY: number,
  upX: number,
  upY: number,
  elapsedMs: number,
  movementPx = 8,
  holdMs = 300,
): boolean {
  return (
    Math.hypot(upX - downX, upY - downY) <= movementPx && elapsedMs <= holdMs
  );
}
