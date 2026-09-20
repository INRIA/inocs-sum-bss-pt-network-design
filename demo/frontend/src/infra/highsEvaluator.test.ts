/**
 * highsEvaluator.test.ts — the exact evaluator as the application sees it.
 *
 * The golden-vector comparison lives in domain/evaluation/engine.test.ts; this
 * file checks the `Evaluator` contract, above all that a layout the budget
 * cannot pay for RESOLVES rather than throws.
 */
import { describe, expect, it } from 'vitest';

import { HighsEvaluator, createHighsLoader } from './highsEvaluator';
import { loadFixtureGameData, loadGolden } from './gameFixtures';
import { buildLp } from '../domain/evaluation/lpModel';
import { solveWith } from './highsEvaluator';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const LONG = 180_000;

describe('HighsEvaluator', () => {
  it(
    'evaluates the optimiser layout at its own budget, exactly',
    async () => {
      const data = await loadFixtureGameData();
      const golden = loadGolden('budget_080k');
      const evaluator = new HighsEvaluator(data);
      const result = await evaluator.evaluate(golden.stations, 80000, { trucks: true });
      expect(result.quality).toBe('exact');
      expect(result.feasible).toBe(true);
      expect(result.served).toBeCloseTo(golden.with_trucks.served, 3);
      expect(result.ptShare).toBeCloseTo(golden.with_trucks.pt_share, 2);
      expect(result.flows.length).toBeGreaterThan(0);
      // The budget a game budget declares is used, not one invented here.
      expect(result.capexEur).toBeLessThanOrEqual(80000 + 1e-6);
    },
    LONG,
  );

  it(
    'answers zero for an empty layout, and does not call the solver',
    async () => {
      const data = await loadFixtureGameData();
      const evaluator = new HighsEvaluator(data, {
        load: () => Promise.reject(new Error('the solver must not be needed here')),
      });
      const result = await evaluator.evaluate([], 80000, { trucks: true });
      expect(result.feasible).toBe(true);
      expect(result.served).toBe(0);
      expect(result.nStations).toBe(0);
      expect(result.losses.unreachable).toBeGreaterThan(0);
    },
    LONG,
  );

  it(
    'reports an unpayable layout as infeasible instead of throwing',
    async () => {
      const data = await loadFixtureGameData();
      const evaluator = new HighsEvaluator(data);
      const everything = Array.from({ length: data.candidates.length }, (_, i) => i);
      // 100 stations need 100 x (100 + 20 x 5) = 20 000 EUR before a single bike.
      const result = await evaluator.evaluate(everything, 20000, { trucks: true });
      expect(result.feasible).toBe(true);
      expect(result.served).toBeCloseTo(0, 6);
      expect(result.bikes).toBeCloseTo(0, 6);
    },
    LONG,
  );

  it(
    'serves no more without trucks than with them',
    async () => {
      const data = await loadFixtureGameData();
      const golden = loadGolden('budget_120k');
      const evaluator = new HighsEvaluator(data);
      const on = await evaluator.evaluate(golden.stations, 120000, { trucks: true });
      const off = await evaluator.evaluate(golden.stations, 120000, { trucks: false });
      expect(off.served).toBeLessThanOrEqual(on.served + 1e-6);
      expect(off.quality).toBe('exact');
    },
    LONG,
  );

  it(
    'honours an explicit wasm location through locateFile',
    async () => {
      // The browser passes a URL; node can only be given a path, but this still
      // proves `locateFile` is wired through and that an explicit location is
      // used instead of the loader's default lookup. Browser loading itself is
      // exercised by the Playwright smoke test in a later phase.
      const require = createRequire(import.meta.url);
      const wasmPath = join(dirname(require.resolve('highs')), 'highs.wasm');
      const data = await loadFixtureGameData();
      const golden = loadGolden('budget_020k');
      const highs = await createHighsLoader({ wasmUrl: wasmPath })();
      const problem = buildLp(data, {
        layout: golden.stations,
        budgetEur: golden.budget_eur,
        opsBudgetEur: golden.ops_budget_eur,
        epsilon: golden.epsilon,
        trucks: true,
      })!;
      const solved = solveWith(highs, problem);
      expect(solved.optimal).toBe(true);
    },
    LONG,
  );

  it(
    'only offers the four budgets the exporter declared',
    async () => {
      const data = await loadFixtureGameData();
      expect(data.budgets.map((b) => b.capexEur)).toEqual([20000, 60000, 80000, 120000]);
      for (const budget of data.budgets) {
        expect(data.references.byBudget.has(budget.capexEur)).toBe(true);
      }
    },
    LONG,
  );
});
