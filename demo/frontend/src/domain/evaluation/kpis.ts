/**
 * kpis.ts — read an Evaluation off a solved LP.
 *
 * Each line below carries the line of demo/experiments/fixed_design.py it
 * mirrors (`_read_kpis`). That function is the normative definition; this is a
 * transcription, pinned by the golden vectors.
 *
 * Pure domain: no React, no DOM, no fetch, no node imports.
 */
import type { LpProblem } from './lpModel';
import type { Evaluation, AssignedFlow } from './ports';
import type { DemandRow, GameData } from './types';
import { computeLosses, groupPathsByOd } from './losses';

/** Anything at or below this is LP dust. Mirrors fixed_design.py `FLOW_EPS`. */
export const FLOW_EPS = 1e-6;

export interface ReadOptions {
  readonly layout: readonly number[];
  readonly demand?: readonly DemandRow[];
  readonly quality?: 'exact' | 'estimate';
  readonly solveMs?: number;
}

/** Total demand per period. mirrors fixed_design.py `Instance.demand_by_period`. */
export function demandByPeriod(
  demand: readonly DemandRow[],
  periods: number,
): number[] {
  const totals = new Array<number>(periods).fill(0);
  for (const [, , t, flow] of demand) totals[t] = (totals[t] ?? 0) + flow;
  return totals;
}

/**
 * The evaluation of a layout that serves nothing: no station placed, or a
 * capex that cannot pay for the stations placed.
 *
 * mirrors fixed_design.py `_empty()`. `feasible` distinguishes the two: an
 * empty layout is a legitimate answer, an unpayable one is not.
 */
export function emptyEvaluation(
  data: GameData,
  options: ReadOptions & { feasible: boolean },
): Evaluation {
  const demand = options.demand ?? data.demand;
  const periods = data.periods;
  const zeros = (): number[] => new Array<number>(periods).fill(0);
  const layout = [...new Set(options.layout)].sort((a, b) => a - b);
  const demandTotal = demand.reduce((sum, row) => sum + row[3], 0);
  const pathsByOd = groupPathsByOd(data.paths);
  return {
    quality: options.quality ?? 'exact',
    feasible: options.feasible,
    served: 0,
    servedRatio: 0,
    demandTotal,
    demandByPeriod: demandByPeriod(demand, periods),
    servedByPeriod: zeros(),
    bikeOnlyByPeriod: zeros(),
    bikePtByPeriod: zeros(),
    ptShare: 0,
    docks: 0,
    bikes: 0,
    // mirrors fixed_design.py `_empty`: the stations are still paid for.
    capexEur: data.constants.station_setup_cost * layout.length,
    nStations: layout.length,
    nTransfer: countTransfer(data, layout),
    losses: computeLosses(demand, data.paths, pathsByOd, layout, 0, demandTotal),
    flows: [],
    solveMs: options.solveMs,
  };
}

/** How many of the open stations sit at a public-transport stop. */
export function countTransfer(data: GameData, layout: readonly number[]): number {
  let count = 0;
  for (const station of layout) {
    if (data.candidates[station]?.type === 'TransferStation') count += 1;
  }
  return count;
}

/**
 * Turn a primal solution into an Evaluation.
 *
 * @param values the solver's `colValue`, one per LP column.
 * mirrors fixed_design.py `_read_kpis()`.
 */
export function readEvaluation(
  data: GameData,
  problem: LpProblem,
  values: ArrayLike<number>,
  options: ReadOptions,
): Evaluation {
  const { layout: shape } = problem;
  const demand = options.demand ?? data.demand;
  const periods = shape.periods;
  const zeros = (): number[] => new Array<number>(periods).fill(0);

  // served flow, per period and per category
  // mirrors demo/experiments/evaluate.py:149-183 (paper_kpis) and
  // network-design-bss/src/output_handler/metrics_evaluator.py:84-85
  let served = 0;
  const servedByPeriod = zeros();
  const bikeOnlyByPeriod = zeros();
  const bikePtByPeriod = zeros();
  const flows: AssignedFlow[] = [];
  for (let column = 0; column < shape.nX; column += 1) {
    const flow = values[column] ?? 0;
    if (flow <= FLOW_EPS) continue;
    const [, , period, pathIndex] = shape.columns[column]!;
    served += flow;
    servedByPeriod[period] = (servedByPeriod[period] ?? 0) + flow;
    if (data.paths[pathIndex]!.cat === 1) {
      bikePtByPeriod[period] = (bikePtByPeriod[period] ?? 0) + flow;
    } else {
      bikeOnlyByPeriod[period] = (bikeOnlyByPeriod[period] ?? 0) + flow;
    }
    flows.push([pathIndex, period, flow]);
  }
  flows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const flowBikePt = bikePtByPeriod.reduce((a, b) => a + b, 0);

  let docks = 0;
  let bikes = 0;
  for (let i = 0; i < shape.stations.length; i += 1) {
    docks += values[shape.wAt + i] ?? 0;   // mirrors model_plan.py "docks"
    bikes += values[shape.vAt + i] ?? 0;   // mirrors model_plan.py "bikes_initial"
  }

  const c = data.constants;
  // capex — constraints.py:296-301, unit costs from util/cost.py
  const capexEur =
    c.station_setup_cost * shape.stations.length +
    c.dock_cost * docks +
    c.unit_bike_cost * bikes;

  const demandTotal = shape.demandTotal;
  const pathsByOd = groupPathsByOd(data.paths);
  return {
    quality: options.quality ?? 'exact',
    feasible: true,
    served,
    servedRatio: demandTotal > 0 ? served / demandTotal : 0,
    demandTotal,
    demandByPeriod: demandByPeriod(demand, periods),
    servedByPeriod,
    bikeOnlyByPeriod,
    bikePtByPeriod,
    // mirrors evaluate.py:183 — pt_assisted_share = flow_bike_pt / served
    ptShare: served > FLOW_EPS ? flowBikePt / served : 0,
    docks,
    bikes,
    capexEur,
    nStations: shape.stations.length,
    nTransfer: countTransfer(data, shape.stations),
    // mirrors fixed_design.py `losses()`
    losses: computeLosses(
      demand,
      data.paths,
      pathsByOd,
      shape.stations,
      served,
      demandTotal,
    ),
    flows,
    solveMs: options.solveMs,
  };
}
