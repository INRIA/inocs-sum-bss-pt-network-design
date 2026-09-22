/**
 * losses.ts — why demand never moved.
 *
 * Mirrors demo/experiments/fixed_design.py `losses()` line for line. The three
 * causes are exclusive and sum, with the served flow, to the total demand —
 * which is what makes them safe to draw as a stacked bar.
 *
 * Pure domain: no React, no DOM, no fetch, no node imports.
 */
import type { DemandRow, GamePath } from './types';
import type { Losses } from './ports';

/** `paths` grouped by OD pair, as `"o:d" -> path indices`. Built once per data load. */
export type PathsByOd = ReadonlyMap<string, readonly number[]>;

export const odKey = (o: number, d: number): string => `${o}:${d}`;

/** Group the path catalogue by OD pair. Mirrors fixed_design.py `Instance.paths_by_od`. */
export function groupPathsByOd(paths: readonly GamePath[]): PathsByOd {
  const grouped = new Map<string, number[]>();
  for (let index = 0; index < paths.length; index += 1) {
    const key = odKey(paths[index]!.o, paths[index]!.d);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(index);
    else grouped.set(key, [index]);
  }
  return grouped;
}

/** True when every station on every bike leg of `path` is open. */
export function pathIsOpen(path: GamePath, open: ReadonlySet<number>): boolean {
  for (const leg of path.legs) {
    if (!open.has(leg[0]) || !open.has(leg[1])) return false;
  }
  return true;
}

/**
 * Demand on OD pairs with no path at all: no layout can ever serve it.
 * Mirrors fixed_design.py `Instance.unreachable_flow` (upstream issue #3).
 */
export function unreachableFlow(
  demand: readonly DemandRow[],
  pathsByOd: PathsByOd,
): number {
  let total = 0;
  for (const [o, d, , flow] of demand) {
    if (!pathsByOd.get(odKey(o, d))?.length) total += flow;
  }
  return total;
}

/**
 * Split the demand that never moved into its three causes.
 *
 * Mirrors fixed_design.py `losses()`:
 *   unreachable — no path in the catalogue
 *   noStation   — paths exist, none fully open under this layout
 *   noStock     — the rest: a path was available, no bike could take it
 */
export function computeLosses(
  demand: readonly DemandRow[],
  paths: readonly GamePath[],
  pathsByOd: PathsByOd,
  layout: readonly number[],
  served: number,
  demandTotal: number,
): Losses {
  const open = new Set(layout);
  let noStation = 0;
  let unreachable = 0;
  for (const [o, d, , flow] of demand) {
    const options = pathsByOd.get(odKey(o, d));
    if (!options || options.length === 0) {
      unreachable += flow;
      continue;
    }
    let reachable = false;
    for (const index of options) {
      if (pathIsOpen(paths[index]!, open)) {
        reachable = true;
        break;
      }
    }
    if (!reachable) noStation += flow;
  }
  return {
    noStation,
    noStock: Math.max(0, demandTotal - served - unreachable - noStation),
    unreachable,
  };
}
