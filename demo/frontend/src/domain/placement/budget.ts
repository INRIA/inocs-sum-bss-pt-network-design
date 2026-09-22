/**
 * budget.ts — what a capex envelope buys.
 *
 * The visitor only places stations; the model sizes the docks and the fleet.
 * These helpers are the arithmetic behind the meter that shows how much of the
 * budget the stations themselves have already eaten.
 *
 * Mirrors demo/experiments/fixed_design.py `max_stations()` and the capex
 * constraint of network-design-bss/src/model/constraints.py:296-301:
 *   station_setup_cost * stations + dock_cost * docks + unit_bike_cost * bikes <= budget
 *
 * Pure domain: no React, no DOM, no fetch, no node imports.
 */
import type { ModelConstants } from '../evaluation/types';

/** What one open station costs before it holds a single bike. */
export function stationFloorCostEur(c: ModelConstants): number {
  return c.station_setup_cost + c.dock_cost * c.MIN_CAPACITY_IF_BUILT;
}

/** What the stations alone cost. */
export function stationsCostEur(c: ModelConstants, count: number): number {
  return c.station_setup_cost * count;
}

/**
 * How many stations the budget can pay for at all — every one of them needs
 * `MIN_CAPACITY_IF_BUILT` docks (constraints.py:285-293). Placing more makes
 * the LP infeasible, which the engine reports as `feasible: false`.
 *
 * mirrors fixed_design.py `max_stations()`.
 */
export function maxStations(budgetEur: number, c: ModelConstants): number {
  const floor = stationFloorCostEur(c);
  return floor > 0 ? Math.floor(budgetEur / floor) : 0;
}

/**
 * A GAME rule, not a model constant: how many stations a visitor may place at
 * each budget. They are the optimiser's own station counts rounded to a tidy
 * number (33, 67, 83 and 90 stations at 20 / 60 / 80 / 120 k EUR), so a bigger
 * budget visibly lets the city grow while the 100 candidate sites stay more
 * than any budget fills. Kept here, in the game layer, rather than in the
 * exported model constants: the frozen model has no such cap and the
 * golden-pinned game payload is not regenerated for a presentation rule.
 */
const GAME_STATION_CAP: Readonly<Record<number, number>> = {
  20000: 30,
  60000: 60,
  80000: 80,
  120000: 90,
};

/** Most stations a visitor may place at this budget: the game cap, never above what the money pays for. */
export function stationLimit(budgetEur: number, c: ModelConstants): number {
  const cap = GAME_STATION_CAP[budgetEur];
  const affordable = maxStations(budgetEur, c);
  return cap === undefined ? affordable : Math.min(cap, affordable);
}

export interface BudgetState {
  readonly placed: number;
  readonly maxStations: number;
  /** Spent on the stations themselves. */
  readonly stationsEur: number;
  /** The least the docks those stations must carry will cost. */
  readonly minimumDocksEur: number;
  /** Left for the model to spend on docks above the minimum, and on bikes. */
  readonly remainingEur: number;
  /** 0..1, for the meter. Clamped. */
  readonly usedFraction: number;
  /** True once the layout costs more than the budget: the LP is infeasible. */
  readonly overBudget: boolean;
  /** True once more stations are placed than the budget's station limit allows. */
  readonly overLimit: boolean;
  /** How many more stations still fit. Never negative. */
  readonly roomLeft: number;
}

/**
 * The state of the budget meter for a layout of `placed` stations.
 *
 * `remainingEur` is deliberately the money left AFTER the minimum docks: it is
 * what the model still has to work with, which is the honest number to show
 * next to "the model decides the docks and the bikes".
 */
export function budgetState(
  budgetEur: number,
  placed: number,
  c: ModelConstants,
): BudgetState {
  const stationsEur = stationsCostEur(c, placed);
  const minimumDocksEur = c.dock_cost * c.MIN_CAPACITY_IF_BUILT * placed;
  const committed = stationsEur + minimumDocksEur;
  const limit = stationLimit(budgetEur, c);
  return {
    placed,
    maxStations: limit,
    stationsEur,
    minimumDocksEur,
    remainingEur: budgetEur - committed,
    usedFraction: budgetEur > 0 ? Math.min(1, Math.max(0, committed / budgetEur)) : 0,
    overBudget: committed > budgetEur,
    overLimit: placed > limit,
    roomLeft: Math.max(0, limit - placed),
  };
}
