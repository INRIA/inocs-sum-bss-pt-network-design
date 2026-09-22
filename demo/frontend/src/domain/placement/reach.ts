/**
 * reach.ts — what a layout puts "within reach".
 *
 * The live preview while the visitor places stations. A demand row is within
 * reach when at least one of its candidate paths has every station open — the
 * same availability test the LP applies (constraints.py:129-152 with y fixed),
 * so reach is an UPPER BOUND on served flow, never a service figure. Measured
 * overestimate: 1.04x at 80 k EUR, 1.90x at 20 k EUR. The counter in the UI
 * must read "within reach", never "served".
 *
 * Mirrors demo/experiments/fixed_design.py `reach_flow()` / `reach_options()`,
 * reading the table `coverage.json` carries.
 *
 * Pure domain: no React, no DOM, no fetch, no node imports.
 */
import type { Coverage, ReachRow } from '../evaluation/types';

/** True when every station of one of the row's sets is open. */
export function rowIsReachable(row: ReachRow, open: ReadonlySet<number>): boolean {
  for (const set of row.sets) {
    let all = true;
    for (const station of set) {
      if (!open.has(station)) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

/** Total demand within reach of `layout`. mirrors fixed_design.py `reach_flow()`. */
export function reachFlow(
  rows: readonly ReachRow[],
  layout: Iterable<number>,
): number {
  const open = new Set(layout);
  let total = 0;
  for (const row of rows) if (rowIsReachable(row, open)) total += row.flow;
  return total;
}

/** The same, split by period, for the little three-bar hint. */
export function reachByPeriod(
  rows: readonly ReachRow[],
  layout: Iterable<number>,
  periods: number,
): number[] {
  const open = new Set(layout);
  const totals = new Array<number>(periods).fill(0);
  for (const row of rows) {
    if (rowIsReachable(row, open)) totals[row.t] = (totals[row.t] ?? 0) + row.flow;
  }
  return totals;
}

/**
 * The extra demand one more candidate would bring within reach.
 *
 * A still-unreachable row becomes reachable by adding `candidate` only when it
 * is the single missing station of one of its sets, so this is exact — the same
 * reasoning `assistant.ts` and fixed_design.py `assistant_order()` rest on.
 */
export function marginalReach(
  rows: readonly ReachRow[],
  layout: Iterable<number>,
  candidate: number,
): number {
  const open = new Set(layout);
  if (open.has(candidate)) return 0;
  let gain = 0;
  for (const row of rows) {
    if (rowIsReachable(row, open)) continue;
    for (const set of row.sets) {
      let missing = 0;
      let missingStation = -1;
      for (const station of set) {
        if (!open.has(station)) {
          missing += 1;
          missingStation = station;
          if (missing > 1) break;
        }
      }
      if (missing === 1 && missingStation === candidate) {
        gain += row.flow;
        break;
      }
    }
  }
  return gain;
}

/** The static per-candidate score `coverage.json` carries. An upper bound. */
export function potentialFlow(coverage: Coverage, candidate: number): number {
  return coverage.potentialFlow[candidate] ?? 0;
}
