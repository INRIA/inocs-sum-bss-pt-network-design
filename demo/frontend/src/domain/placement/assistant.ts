/**
 * assistant.ts — the "follow the demand" rule, openly labelled in the UI.
 *
 * Repeatedly add the candidate that brings the most ADDITIONAL demand within
 * reach; ties are broken by the smallest candidate id, so the order is
 * deterministic and reproducible.
 *
 * This MUST reproduce demo/experiments/fixed_design.py `assistant_order()`
 * exactly: `references.json` records the layout that rule produces at each
 * budget, and the game shows the visitor's result against it. assistant.test.ts
 * checks the two agree on all four budgets.
 *
 * It is a greedy rule, not the optimiser. The spike measured it at 0.96x to
 * 1.00x of the optimiser's served flow — which is the honest framing: thought
 * beats random by a lot, and lands close to the optimiser.
 *
 * Pure domain: no React, no DOM, no fetch, no node imports.
 */
import type { ReachRow } from '../evaluation/types';
import { rowIsReachable } from './reach';

/**
 * The order the assistant would place stations in.
 *
 * @param rows        the reach table from `coverage.json`.
 * @param candidates  how many candidates exist (ids are 0..candidates-1).
 * @param limit       how many to pick.
 * @param already     stations the visitor has already placed; kept, and the
 *                    rule continues from there.
 * @returns the chosen candidate ids, in the order they were chosen (excluding
 *          `already`).
 */
export function assistantOrder(
  rows: readonly ReachRow[],
  candidates: number,
  limit: number,
  already: Iterable<number> = [],
): number[] {
  const chosen = new Set(already);
  const order: number[] = [];
  const covered = rows.map((row) => rowIsReachable(row, chosen));

  const target = Math.min(limit, candidates - chosen.size);
  for (let step = 0; step < target; step += 1) {
    // Exact marginal gain: an uncovered row becomes covered by adding `c` only
    // when `c` is the single missing station of one of its sets.
    const gain = new Map<number, number>();
    for (let index = 0; index < rows.length; index += 1) {
      if (covered[index]) continue;
      for (const set of rows[index]!.sets) {
        let missing = 0;
        let missingStation = -1;
        for (const station of set) {
          if (!chosen.has(station)) {
            missing += 1;
            missingStation = station;
            if (missing > 1) break;
          }
        }
        if (missing === 1) {
          gain.set(missingStation, (gain.get(missingStation) ?? 0) + rows[index]!.flow);
        }
      }
    }

    let best = -1;
    let bestGain = -1;
    for (let candidate = 0; candidate < candidates; candidate += 1) {
      if (chosen.has(candidate)) continue;
      const value = gain.get(candidate) ?? 0;
      // Strictly greater: the first (smallest) id wins a tie.
      if (best < 0 || value > bestGain) {
        best = candidate;
        bestGain = value;
      }
    }
    if (best < 0) break;

    chosen.add(best);
    order.push(best);
    for (let index = 0; index < rows.length; index += 1) {
      if (!covered[index] && rowIsReachable(rows[index]!, chosen)) covered[index] = true;
    }
  }
  return order;
}

/**
 * The single next station the assistant would add. Used by the "suggest one"
 * button, so one tap and a full run agree by construction.
 */
export function nextSuggestion(
  rows: readonly ReachRow[],
  candidates: number,
  already: Iterable<number>,
): number | null {
  const order = assistantOrder(rows, candidates, 1, already);
  return order.length ? order[0]! : null;
}
