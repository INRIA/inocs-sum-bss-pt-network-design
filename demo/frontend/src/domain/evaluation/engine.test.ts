/**
 * engine.test.ts — the TypeScript engine must reproduce the Python reference.
 *
 * demo/experiments/fixed_design.py is normative; this file is the transcription
 * check. For every one of the 21 committed designs, HiGHS-in-node solves the LP
 * this code builds and the result is compared with the golden vector Python
 * wrote — with trucks and without.
 *
 * The two solve the SAME program, so the tolerances are tight on purpose
 * (0.5 % on served, 0.005 on PT share). A wider gap is a transcription bug, not
 * numerical noise, and must be investigated rather than accommodated.
 */
import { describe, expect, it } from 'vitest';

import { buildLp } from './lpModel';
import { emptyEvaluation, readEvaluation } from './kpis';
import { createHighsLoader, solveWith } from '../../infra/highsEvaluator';
import {
  goldenScenarios,
  loadFixtureGameData,
  loadGolden,
  loadScenarioDemand,
  type GoldenSummary,
} from '../../infra/gameFixtures';
import type { DemandRow, GameData } from './types';
import type { Evaluation } from './ports';

/** Agreed in .specs/1demo-game-presentation/prompt-dev.md for TS vs Python. */
const SERVED_RELATIVE = 0.005;
const PT_SHARE_ABSOLUTE = 0.005;

const MINUTES = 240_000;

/** The game's own profile; every other run carries its own multinomial split. */
function demandFor(data: GameData, scenario: string, profile: string): readonly DemandRow[] {
  if (profile === 'bimodal') return data.demand;
  return loadScenarioDemand(
    scenario,
    data.cells.map((cell) => cell.id),
  );
}

async function evaluateGolden(
  data: GameData,
  highs: Awaited<ReturnType<ReturnType<typeof createHighsLoader>>>,
  scenario: string,
  stations: readonly number[],
  budgetEur: number,
  opsBudgetEur: number,
  epsilon: number,
  trucks: boolean,
  demand: readonly DemandRow[],
): Promise<Evaluation> {
  const problem = buildLp(data, {
    layout: stations,
    budgetEur,
    opsBudgetEur,
    epsilon,
    trucks,
    demand,
  });
  if (!problem) return emptyEvaluation(data, { layout: stations, demand, feasible: true });
  const solved = solveWith(highs, problem);
  expect(solved.optimal, `${scenario} (trucks ${trucks}) did not solve to optimality`).toBe(true);
  return readEvaluation(data, problem, solved.colValue, { layout: stations, demand });
}

function compare(
  label: string,
  actual: Evaluation,
  expected: GoldenSummary,
): { servedDrift: number; ptDrift: number } {
  const servedDrift =
    expected.served > 0 ? Math.abs(actual.served - expected.served) / expected.served : 0;
  const ptDrift = Math.abs(actual.ptShare - expected.pt_share);
  expect(
    servedDrift,
    `${label}: TS served ${actual.served.toFixed(3)} vs Python ${expected.served}`,
  ).toBeLessThanOrEqual(SERVED_RELATIVE);
  expect(
    ptDrift,
    `${label}: TS PT share ${actual.ptShare.toFixed(4)} vs Python ${expected.pt_share}`,
  ).toBeLessThanOrEqual(PT_SHARE_ABSOLUTE);
  return { servedDrift, ptDrift };
}

describe('the TypeScript engine reproduces the Python reference', () => {
  it(
    'matches every golden vector, with and without trucks',
    async () => {
      const data = await loadFixtureGameData();
      const highs = await createHighsLoader()();
      const scenarios = goldenScenarios();
      expect(scenarios.length).toBeGreaterThanOrEqual(21);

      const drifts: number[] = [];
      const ptDrifts: number[] = [];
      const times: number[] = [];
      for (const scenario of scenarios) {
        const golden = loadGolden(scenario);
        const demand = demandFor(data, scenario, golden.demand_profile);
        // The demand the TS side reconstructs must be the demand Python used.
        expect(
          demand.reduce((sum, row) => sum + row[3], 0),
          `${scenario}: demand total`,
        ).toBe(golden.with_trucks.demand_total);

        for (const trucks of [true, false]) {
          const started = Date.now();
          const evaluation = await evaluateGolden(
            data,
            highs,
            scenario,
            golden.stations,
            golden.budget_eur,
            golden.ops_budget_eur,
            golden.epsilon,
            trucks,
            demand,
          );
          times.push(Date.now() - started);
          const expected = trucks ? golden.with_trucks : golden.without_trucks;
          const { servedDrift, ptDrift } = compare(
            `${scenario} (trucks ${trucks})`,
            evaluation,
            expected,
          );
          drifts.push(servedDrift);
          ptDrifts.push(ptDrift);

          // Structural agreement, which is exact on both sides.
          expect(evaluation.nStations).toBe(expected.n_stations);
          expect(evaluation.nTransfer).toBe(expected.n_transfer);
          expect(evaluation.demandTotal).toBe(expected.demand_total);
          expect(evaluation.losses.unreachable).toBeCloseTo(expected.losses.unreachable, 6);
          expect(evaluation.losses.noStation).toBeCloseTo(expected.losses.no_station, 6);
          expect(evaluation.quality).toBe('exact');
        }
      }
      const mean = (values: number[]): number =>
        values.reduce((a, b) => a + b, 0) / values.length;
      // eslint-disable-next-line no-console
      console.log(
        `TS vs Python over ${drifts.length} vectors: served drift min ${Math.min(...drifts).toExponential(2)} ` +
          `mean ${mean(drifts).toExponential(2)} max ${Math.max(...drifts).toExponential(2)}; ` +
          `PT share drift max ${Math.max(...ptDrifts).toExponential(2)}; ` +
          `solve min ${Math.min(...times)} ms mean ${Math.round(mean(times))} ms max ${Math.max(...times)} ms`,
      );
    },
    MINUTES,
  );

  it(
    'agrees with Python on the per-period split and the loss breakdown',
    async () => {
      const data = await loadFixtureGameData();
      const highs = await createHighsLoader()();
      for (const scenario of ['budget_020k', 'budget_080k', 'ops_000']) {
        const golden = loadGolden(scenario);
        const demand = demandFor(data, scenario, golden.demand_profile);
        const evaluation = await evaluateGolden(
          data,
          highs,
          scenario,
          golden.stations,
          golden.budget_eur,
          golden.ops_budget_eur,
          golden.epsilon,
          true,
          demand,
        );
        expect(evaluation.demandByPeriod).toEqual(golden.with_trucks.demand_by_period);
        for (let t = 0; t < evaluation.servedByPeriod.length; t += 1) {
          expect(evaluation.servedByPeriod[t]).toBeCloseTo(
            golden.with_trucks.served_by_period[t]!,
            3,
          );
          expect(evaluation.bikePtByPeriod[t]! + evaluation.bikeOnlyByPeriod[t]!).toBeCloseTo(
            evaluation.servedByPeriod[t]!,
            6,
          );
        }
        const total =
          evaluation.served +
          evaluation.losses.noStation +
          evaluation.losses.noStock +
          evaluation.losses.unreachable;
        expect(total).toBeCloseTo(evaluation.demandTotal, 4);
      }
    },
    MINUTES,
  );
});
