/**
 * ports.ts — the contracts the application layer depends on (plan-technical §C.4).
 *
 * Dependency inversion, without a container: the domain declares what it needs,
 * `infra/` provides it, and `PlayApp` constructs the implementations once.
 * `HighsEvaluator` and `EstimateEvaluator` are substitutable — same contract,
 * including the `quality` field the UI is required to display.
 *
 * Pure domain: no React, no DOM, no fetch, no node imports.
 */

/** A flow the LP put on a path: `[pathIndex, period, flow]`. Feeds trips/sprites.ts. */
export type AssignedFlow = readonly [number, number, number];

/** Demand that never moves, split by cause. Mirrors fixed_design.py `losses()`. */
export interface Losses {
  /** The OD pair has paths, but every one needs a station the layout leaves closed. */
  readonly noStation: number;
  /** A path was available but no bike could be put on it (docks, fleet, budget, 30-dock cap). */
  readonly noStock: number;
  /** The OD pair has no path at all — no layout can ever serve it (upstream issue #3). */
  readonly unreachable: number;
}

/**
 * One evaluation of one layout.
 *
 * Mirrors the dict demo/experiments/fixed_design.py `evaluate()` returns; the
 * golden vectors under results/shared/game/golden/ pin the two together.
 */
export interface Evaluation {
  /**
   * `exact` — the LP was solved (HiGHS). `estimate` — the fallback ran; the UI
   * must say so. Never silently swapped.
   */
  readonly quality: 'exact' | 'estimate';
  /**
   * False when the capex cannot even pay `MIN_CAPACITY_IF_BUILT` docks for the
   * stations placed. Everything scores zero; nothing throws.
   */
  readonly feasible: boolean;
  readonly served: number;
  readonly servedRatio: number;
  readonly demandTotal: number;
  readonly demandByPeriod: readonly number[];
  readonly servedByPeriod: readonly number[];
  readonly bikeOnlyByPeriod: readonly number[];
  readonly bikePtByPeriod: readonly number[];
  /** `flow_bike_pt / served`. Mirrors demo/experiments/evaluate.py:183. */
  readonly ptShare: number;
  readonly docks: number;
  readonly bikes: number;
  readonly capexEur: number;
  readonly nStations: number;
  readonly nTransfer: number;
  readonly losses: Losses;
  /** Empty for an estimate: only a solved LP assigns flow to paths. */
  readonly flows: readonly AssignedFlow[];
  /** Wall-clock milliseconds the solve took. Diagnostics only, never pinned. */
  readonly solveMs?: number;
}

export interface EvaluateOptions {
  /**
   * False removes every rebalancing variable AND zeroes the operating budget:
   * "the same network, operated without trucks".
   */
  readonly trucks: boolean;
}

/**
 * Evaluate a layout at a budget. The layout is a list of candidate INDICES.
 *
 * Implementations must resolve, not throw, for a layout the budget cannot pay
 * for: that is a legitimate answer the game shows.
 */
export interface Evaluator {
  evaluate(
    layout: readonly number[],
    budgetEur: number,
    opts: EvaluateOptions,
  ): Promise<Evaluation>;
}
