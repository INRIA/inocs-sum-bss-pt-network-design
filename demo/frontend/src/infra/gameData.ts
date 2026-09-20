/**
 * gameData.ts — fetch and decode the game payload.
 *
 * The files under `public/data/game/` are written by
 * `python3 -m demo.experiments.game_export` and copied by
 * `scripts/prepare-data.mjs`. They are interned (a station IS its index) and
 * stored as arrays rather than objects to keep the download small; this module
 * is the one place that knows that encoding.
 *
 * Every URL is built from a base the caller passes in, which the site derives
 * from `import.meta.env.BASE_URL`, so the GitHub Pages project path is
 * respected. No other layer fetches anything.
 */
import type {
  Candidate,
  Cell,
  Coverage,
  DemandRow,
  GameBudget,
  GameData,
  GamePath,
  ModelConstants,
  PathCategory,
  ReachRow,
  References,
  RideArc,
  BudgetReference,
  OptimiserRun,
} from '../domain/evaluation/types';

/** The eight files the engine needs. `golden/` is a test fixture and is not shipped. */
export const GAME_FILES = [
  'constants',
  'candidates',
  'cells',
  'paths',
  'arcs',
  'demand_reference',
  'coverage',
  'references',
] as const;

export type GameFile = (typeof GAME_FILES)[number];

/** Anything that can read a game file. `fetch` in the browser, `fs` in tests. */
export type ReadGameFile = (name: GameFile) => Promise<unknown>;

/** Join a base URL and a path without doubling or dropping the separator. */
export function gameUrl(baseUrl: string, name: GameFile): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}data/game/${name}.json`;
}

/** The default reader: `fetch`, relative to the site's base URL. */
export function fetchGameFile(baseUrl: string): ReadGameFile {
  return async (name) => {
    const url = gameUrl(baseUrl, name);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`game data: ${url} responded ${response.status}`);
    }
    return response.json();
  };
}

const asRecord = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`game data: ${what} is not an object`);
  }
  return value as Record<string, unknown>;
};

const asArray = (value: unknown, what: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`game data: ${what} is not an array`);
  return value;
};

export function decodeConstants(raw: unknown): {
  constants: ModelConstants;
  periods: number;
  budgets: GameBudget[];
} {
  const file = asRecord(raw, 'constants.json');
  const costs = asRecord(file.costs, 'constants.costs');
  const model = asRecord(file.model, 'constants.model');
  const constants = { ...costs, ...model } as unknown as ModelConstants;
  const budgets = asArray(file.budgets, 'constants.budgets').map((entry) => {
    const block = asRecord(entry, 'constants.budgets[]');
    return {
      scenario: String(block.scenario),
      capexEur: Number(block.capex_eur),
      opsBudgetEur: Number(block.ops_budget_eur),
      epsilon: Number(block.epsilon),
      maxStations: Number(block.max_stations),
    } satisfies GameBudget;
  });
  return { constants, periods: Number(file.periods), budgets };
}

export function decodeCandidates(raw: unknown): Candidate[] {
  const file = asRecord(raw, 'candidates.json');
  const types = asArray(file.types, 'candidates.types').map(String);
  return asArray(file.candidates, 'candidates.candidates').map((entry) => {
    const row = entry as [string, number, number, number];
    return { id: row[0], type: types[row[1]] ?? 'BikeStation', lon: row[2], lat: row[3] };
  });
}

export function decodeCells(raw: unknown): Cell[] {
  const file = asRecord(raw, 'cells.json');
  return asArray(file.cells, 'cells.cells').map((entry) => {
    const row = entry as [string, number, number, number];
    return { id: row[0], lon: row[1], lat: row[2], buildable: row[3] === 1 };
  });
}

export function decodePaths(raw: unknown): GamePath[] {
  const file = asRecord(raw, 'paths.json');
  return asArray(file.paths, 'paths.paths').map((entry) => {
    const row = entry as [number, number, number, number, number, number, number, number[][]];
    return {
      o: row[0],
      d: row[1],
      cat: row[2] as PathCategory,
      rank: row[3],
      timeMin: row[4],
      distanceKm: row[5],
      gainMin: row[6],
      legs: row[7].map((leg) => [leg[0]!, leg[1]!] as const),
    };
  });
}

export function decodeArcs(raw: unknown): RideArc[] {
  const file = asRecord(raw, 'arcs.json');
  return asArray(file.arcs, 'arcs.arcs').map((entry) => {
    const row = entry as [number, number, number];
    return { from: row[0], to: row[1], km: row[2] };
  });
}

export function decodeDemand(raw: unknown): { demand: DemandRow[]; periods: number } {
  const file = asRecord(raw, 'demand_reference.json');
  const demand = asArray(file.demand, 'demand_reference.demand').map(
    (entry) => entry as DemandRow,
  );
  return { demand, periods: Number(file.periods) };
}

export function decodeCoverage(raw: unknown): Coverage {
  const file = asRecord(raw, 'coverage.json');
  const reachBlock = asRecord(file.reach, 'coverage.reach');
  const reach: ReachRow[] = asArray(reachBlock.rows, 'coverage.reach.rows').map((entry) => {
    const row = entry as [number, number, number, number, number[][]];
    return { o: row[0], d: row[1], t: row[2], flow: row[3], sets: row[4] };
  });
  return {
    walkCatchmentKm: Number(file.walk_catchment_km),
    cells: asArray(file.cells, 'coverage.cells') as number[][],
    potentialFlow: asArray(file.potential_flow, 'coverage.potential_flow') as number[],
    reach,
  };
}

/**
 * One `with_trucks` / `without_trucks` block of references.json.
 *
 * `fixed_design.py` writes every KPI it computes here, so the decoder reads
 * them all: dropping them would force the "You \u00b7 Optimiser" column to mix
 * this engine's numbers for the visitor with the published run's for the
 * optimiser, which is exactly what decision 4 forbids.
 */
function decodeOptimiserRun(raw: unknown, what: string): OptimiserRun {
  const block = asRecord(raw, what);
  const losses = asRecord(block.losses, `${what}.losses`);
  const series = (key: string): number[] =>
    asArray(block[key] ?? [], `${what}.${key}`).map(Number);
  return {
    feasible: block.feasible !== false,
    served: Number(block.served),
    servedRatio: Number(block.served_ratio),
    demandTotal: Number(block.demand_total),
    demandByPeriod: series('demand_by_period'),
    servedByPeriod: series('served_by_period'),
    bikeOnlyByPeriod: series('bike_only_by_period'),
    bikePtByPeriod: series('bike_pt_by_period'),
    ptShare: Number(block.pt_share),
    docks: Number(block.docks),
    bikes: Number(block.bikes),
    capexEur: Number(block.capex_eur),
    nStations: Number(block.n_stations),
    nTransfer: Number(block.n_transfer),
    bikesRebalanced: Number(block.bikes_rebalanced ?? 0),
    dispatchesRelaxed: Number(block.dispatches_relaxed ?? 0),
    dispatchCostEur: Number(block.dispatch_cost_eur ?? 0),
    losses: {
      noStation: Number(losses.no_station ?? 0),
      noStock: Number(losses.no_stock ?? 0),
      unreachable: Number(losses.unreachable ?? 0),
    },
  };
}

export function decodeReferences(raw: unknown): References {
  const file = asRecord(raw, 'references.json');
  const byBudget = new Map<number, BudgetReference>();
  for (const entry of asArray(file.budgets, 'references.budgets')) {
    const block = asRecord(entry, 'references.budgets[]');
    const optimiser = asRecord(block.optimiser, 'references.optimiser');
    const withTrucks = asRecord(optimiser.with_trucks, 'references.with_trucks');
    const without = asRecord(optimiser.without_trucks, 'references.without_trucks');
    const random = asRecord(block.random, 'references.random');
    const rule = asRecord(block.demand_rule, 'references.demand_rule');
    const calibration = asRecord(block.reach_calibration, 'references.reach_calibration');
    const budgetEur = Number(block.budget_eur);
    const runWith = decodeOptimiserRun(withTrucks, 'references.with_trucks');
    const runWithout = decodeOptimiserRun(without, 'references.without_trucks');
    byBudget.set(budgetEur, {
      scenario: String(block.scenario),
      budgetEur,
      nStations: Number(block.n_stations),
      optimiserStations: optimiser.stations as number[],
      optimiserServed: Number(withTrucks.served),
      optimiserServedNoTrucks: Number(without.served),
      optimiserPtShare: Number(withTrucks.pt_share),
      optimiserPtShareNoTrucks: Number(without.pt_share),
      publishedServedTotal: Number(optimiser.published_served_total),
      randomServedMedian: Number(random.served_median),
      demandRuleStations: rule.stations as number[],
      demandRuleServed: Number(rule.served),
      reachCalibration: Number(calibration.factor),
      opsBudgetEur: Number(block.ops_budget_eur),
      epsilon: Number(block.epsilon),
      publishedServedRatio: Number(optimiser.published_served_ratio),
      randomServedRatioMedian: Number(random.served_ratio_median),
      randomServedMin: Number(random.served_min),
      randomServedMax: Number(random.served_max),
      randomLayouts: Number(random.layouts),
      demandRuleServedRatio: Number(rule.served_ratio),
      demandRulePtShare: Number(rule.pt_share),
      reachCalibrationReach: Number(calibration.reach),
      reachCalibrationServed: Number(calibration.served),
      optimiserWithTrucks: runWith,
      optimiserWithoutTrucks: runWithout,
    });
  }
  return { byBudget };
}

/**
 * Load and decode everything.
 *
 * @param read how to get one file; `fetchGameFile(base)` in the browser.
 */
export async function loadGameData(read: ReadGameFile): Promise<GameData> {
  const [
    constantsRaw,
    candidatesRaw,
    cellsRaw,
    pathsRaw,
    arcsRaw,
    demandRaw,
    coverageRaw,
    referencesRaw,
  ] = await Promise.all(GAME_FILES.map((name) => read(name)));

  const { constants, periods, budgets } = decodeConstants(constantsRaw);
  const { demand, periods: demandPeriods } = decodeDemand(demandRaw);
  return {
    constants,
    periods: demandPeriods || periods,
    budgets,
    candidates: decodeCandidates(candidatesRaw),
    cells: decodeCells(cellsRaw),
    paths: decodePaths(pathsRaw),
    arcs: decodeArcs(arcsRaw),
    demand,
    coverage: decodeCoverage(coverageRaw),
    references: decodeReferences(referencesRaw),
  };
}
