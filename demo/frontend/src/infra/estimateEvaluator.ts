/**
 * estimateEvaluator.ts — the fallback, when HiGHS cannot run.
 *
 * Honours the same `Evaluator` contract as `HighsEvaluator` and reports
 * `quality: 'estimate'`, which the UI is required to display. It is used when
 * the solver fails to load, or a solve exceeds its 8 s budget on a low-end
 * device. It is NEVER used silently in place of a solve that worked.
 *
 * HOW THE ESTIMATE IS BUILT, stated exactly because the UI quotes it:
 *
 *   served ~= withinReach(layout) * factor(budget)
 *
 * `withinReach` is the exact availability bound (domain/placement/reach.ts):
 * the demand whose OD pair has at least one path with every station open. It is
 * an UPPER bound on service — 1.04x at 80 k EUR, 1.90x at 20 k EUR — so it must
 * be scaled down.
 *
 * `factor(budget)` is `served / withinReach` measured by the Python reference
 * on the OPTIMISER's own layout at that budget, and written into
 * references.json as `reach_calibration.factor`. One number per budget, not a
 * fitted curve: at low budget the binding constraint is money and the factor is
 * small; at high budget it approaches the LP's own 1.0.
 *
 * Its accuracy is therefore only as good as the assumption that the visitor's
 * layout converts reach into service like the optimiser's does. Measured
 * against the exact engine in estimateEvaluator.test.ts; expect tens of per
 * cent, not per cent. This is why the plan forbids ranking layouts with it.
 *
 * What it deliberately does NOT do: assign flow to paths. `flows` is empty, so
 * the run animation falls back to its demand-driven form.
 */
import { demandByPeriod, countTransfer } from '../domain/evaluation/kpis';
import { computeLosses, groupPathsByOd } from '../domain/evaluation/losses';
import type {
  EvaluateOptions,
  Evaluation,
  Evaluator,
} from '../domain/evaluation/ports';
import type { DemandRow, GameData } from '../domain/evaluation/types';
import { reachByPeriod, reachFlow } from '../domain/placement/reach';
import { budgetState } from '../domain/placement/budget';

/**
 * The PT-assisted share the fallback reports: the OPTIMISER's own share at that
 * budget, measured by the reference engine and carried in references.json.
 *
 * It does not vary with the visitor's layout, because nothing short of an
 * assignment can tell how much of their service leans on public transport. The
 * tile is therefore marked as an estimate like every other number here, and the
 * category split (bike only vs bike + PT) is left empty rather than invented.
 */
function ptShareFor(data: GameData, budgetEur: number, trucks: boolean): number {
  const reference = data.references.byBudget.get(budgetEur);
  if (!reference) return 0;
  return trucks ? reference.optimiserPtShare : reference.optimiserPtShareNoTrucks;
}

export class EstimateEvaluator implements Evaluator {
  constructor(
    private readonly data: GameData,
    private readonly demand?: readonly DemandRow[],
  ) {}

  async evaluate(
    layout: readonly number[],
    budgetEur: number,
    opts: EvaluateOptions,
  ): Promise<Evaluation> {
    const data = this.data;
    const demand = this.demand ?? data.demand;
    const stations = [...new Set(layout)].sort((a, b) => a - b);
    const demandTotal = demand.reduce((sum, row) => sum + row[3], 0);
    const periods = data.periods;

    const meter = budgetState(budgetEur, stations.length, data.constants);
    const reference = data.references.byBudget.get(budgetEur);
    const factor = reference?.reachCalibration ?? 1;
    // Without trucks the optimiser loses 0 to 9 % of its served flow across the
    // committed runs (spike/RESULTS.md variant D, mean 0.969). One constant,
    // applied openly, rather than a second fitted model.
    const truckFactor = opts.trucks
      ? 1
      : reference && reference.optimiserServed > 0
        ? reference.optimiserServedNoTrucks / reference.optimiserServed
        : 1;

    const reach = reachFlow(data.coverage.reach, stations);
    const served = meter.overBudget ? 0 : Math.min(demandTotal, reach * factor * truckFactor);
    const reachPerPeriod = reachByPeriod(data.coverage.reach, stations, periods);
    const reachTotal = reachPerPeriod.reduce((a, b) => a + b, 0);
    const servedByPeriod = reachPerPeriod.map((value) =>
      reachTotal > 0 ? (served * value) / reachTotal : 0,
    );
    const ptShare = served > 0 ? ptShareFor(data, budgetEur, opts.trucks) : 0;

    return {
      quality: 'estimate',
      feasible: !meter.overBudget,
      served,
      servedRatio: demandTotal > 0 ? served / demandTotal : 0,
      demandTotal,
      demandByPeriod: demandByPeriod(demand, periods),
      servedByPeriod,
      // Without an assignment there is no split; both arrays stay at zero and
      // the UI hides the category breakdown for an estimate.
      bikeOnlyByPeriod: new Array<number>(periods).fill(0),
      bikePtByPeriod: new Array<number>(periods).fill(0),
      ptShare,
      // The model sizes these; an estimate does not pretend to.
      docks: 0,
      bikes: 0,
      capexEur: meter.stationsEur,
      nStations: stations.length,
      nTransfer: countTransfer(data, stations),
      losses: computeLosses(
        demand,
        data.paths,
        groupPathsByOd(data.paths),
        stations,
        served,
        demandTotal,
      ),
      flows: [],
    };
  }
}
