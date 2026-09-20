/**
 * types.ts — the decoded shape of the game payload, and of one evaluation.
 *
 * Pure domain: no React, no DOM, no fetch, no node imports. Every id here is an
 * INTEGER, interned by demo/experiments/game_export.py: a station is its index
 * in `candidates`, a cell its index in `cells`, a path its index in `paths`.
 * That is the contract the Python reference and this engine share, so a `flows`
 * row read off either side means the same thing.
 *
 * Mirrors demo/experiments/fixed_design.py (the normative definition) and the
 * files demo/experiments/game_export.py writes under
 * demo/experiments/results/shared/game/.
 */

/** A candidate station the visitor may open. Index in `GameData.candidates` = its id. */
export interface Candidate {
  readonly id: string;
  /** `BikeStation` or `TransferStation` (a candidate sitting at a PT stop). */
  readonly type: string;
  readonly lon: number;
  readonly lat: number;
}

/** An H3 r9 zone centre. Index in `GameData.cells` = its id. */
export interface Cell {
  readonly id: string;
  readonly lon: number;
  readonly lat: number;
  /**
   * False for a cell the demand names but the model kept no candidate station
   * in (AGENTS.md known upstream issue #3). Its trips can never be served.
   */
  readonly buildable: boolean;
}

/** `0` = bike only, `1` = bike + public transport. walk+PT paths are not exported. */
export type PathCategory = 0 | 1;

/** One ride leg: `[fromStation, toStation]`, one per bike arc of the path. */
export type BikeLeg = readonly [number, number];

/**
 * A candidate path, enumerated once by the frozen model over ALL candidates.
 * With the station set fixed, it is usable iff every station on `legs` is open
 * (network-design-bss/src/model/constraints.py:129-152).
 */
export interface GamePath {
  readonly o: number;
  readonly d: number;
  readonly cat: PathCategory;
  /** Feeds the objective's `(1 - PENALTY_COEFFICIENT * rank)` weight. */
  readonly rank: number;
  readonly timeMin: number;
  readonly distanceKm: number;
  readonly gainMin: number;
  readonly legs: readonly BikeLeg[];
}

/** `[originCell, destCell, period, flow]`. */
export type DemandRow = readonly [number, number, number, number];

/** A truck move the operating budget prices: `dispatch_fixed + unit * km`. */
export interface RideArc {
  readonly from: number;
  readonly to: number;
  readonly km: number;
}

/** One demand row and the station sets that would make it servable. */
export interface ReachRow {
  readonly o: number;
  readonly d: number;
  readonly t: number;
  readonly flow: number;
  /** One de-duplicated, sorted station set per candidate path. */
  readonly sets: readonly (readonly number[])[];
}

export interface Coverage {
  readonly walkCatchmentKm: number;
  /** Per candidate: the cells whose centre is inside its walk catchment. */
  readonly cells: readonly (readonly number[])[];
  /** Per candidate: the demand any path through it could carry. An upper bound. */
  readonly potentialFlow: readonly number[];
  readonly reach: readonly ReachRow[];
}

/** The model constants, read from `network-design-bss/src/` at export time. */
export interface ModelConstants {
  readonly station_setup_cost: number;
  readonly dock_cost: number;
  readonly unit_bike_cost: number;
  readonly dispatch_fixed_cost: number;
  readonly rebalancing_unit_cost: number;
  readonly PENALTY_COEFFICIENT: number;
  readonly CAPACITY_UB: number;
  readonly MIN_CAPACITY_IF_BUILT: number;
  readonly CAPACITY_REBALANCING_VEHICLE: number;
  readonly NUM_SHORTEST_PATHS: number;
  readonly EPSILON: number;
  readonly WALK_CATCHMENT_RADIUS: number;
  readonly TIME_PERIODS: number;
}

/** One of the four budgets the game offers. */
export interface GameBudget {
  /** The committed run this budget borrows its demand and envelopes from. */
  readonly scenario: string;
  readonly capexEur: number;
  readonly opsBudgetEur: number;
  readonly epsilon: number;
  /** How many stations the capex could pay for at all. See placement/budget.ts. */
  readonly maxStations: number;
}

/** Everything the engine needs, decoded. Built by infra/gameData.ts. */
export interface GameData {
  readonly constants: ModelConstants;
  readonly periods: number;
  readonly budgets: readonly GameBudget[];
  readonly candidates: readonly Candidate[];
  readonly cells: readonly Cell[];
  readonly paths: readonly GamePath[];
  readonly arcs: readonly RideArc[];
  readonly demand: readonly DemandRow[];
  readonly coverage: Coverage;
  readonly references: References;
}

/** What the game compares a visitor to, per budget. From `references.json`. */
export interface BudgetReference {
  readonly scenario: string;
  readonly budgetEur: number;
  readonly nStations: number;
  readonly optimiserStations: readonly number[];
  readonly optimiserServed: number;
  readonly optimiserServedNoTrucks: number;
  /** The optimiser's own PT-assisted share at this budget, by the same engine. */
  readonly optimiserPtShare: number;
  readonly optimiserPtShareNoTrucks: number;
  readonly publishedServedTotal: number;
  readonly randomServedMedian: number;
  readonly demandRuleStations: readonly number[];
  readonly demandRuleServed: number;
  /** served / within-reach on the optimiser's layout: the estimate factor. */
  readonly reachCalibration: number;
}

export interface References {
  readonly byBudget: ReadonlyMap<number, BudgetReference>;
}
