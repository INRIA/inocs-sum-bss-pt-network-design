/**
 * lpModel.test.ts — the LP itself, and its CPLEX text form.
 *
 * The engine hands HiGHS sparse CSC arrays rather than LP text, so this file
 * checks the two encode the SAME program: a small layout is solved both ways
 * and must give the same objective.
 */
import { describe, expect, it } from 'vitest';

import { buildLp, toCplexLp } from './lpModel';
import { createHighsLoader, solveWith } from '../../infra/highsEvaluator';
import { loadFixtureGameData, loadGolden } from '../../infra/gameFixtures';

describe('lpModel', () => {
  it('returns null for an empty layout instead of an empty program', async () => {
    const data = await loadFixtureGameData();
    expect(buildLp(data, { layout: [], budgetEur: 20000, opsBudgetEur: 1000, epsilon: 0.04, trucks: true })).toBeNull();
  });

  it('drops every rebalancing column when trucks are off', async () => {
    const data = await loadFixtureGameData();
    const golden = loadGolden('budget_080k');
    const on = buildLp(data, {
      layout: golden.stations,
      budgetEur: golden.budget_eur,
      opsBudgetEur: golden.ops_budget_eur,
      epsilon: golden.epsilon,
      trucks: true,
    })!;
    const off = buildLp(data, {
      layout: golden.stations,
      budgetEur: golden.budget_eur,
      opsBudgetEur: golden.ops_budget_eur,
      epsilon: golden.epsilon,
      trucks: false,
    })!;
    expect(on.layout.nR).toBeGreaterThan(0);
    expect(off.layout.nR).toBe(0);
    expect(off.layout.nX).toBe(on.layout.nX);
    expect(off.numCols).toBe(on.numCols - on.layout.nR);
  });

  it('bounds the docks by the model constants, not by a literal', async () => {
    const data = await loadFixtureGameData();
    const golden = loadGolden('budget_020k');
    const problem = buildLp(data, {
      layout: golden.stations,
      budgetEur: golden.budget_eur,
      opsBudgetEur: golden.ops_budget_eur,
      epsilon: golden.epsilon,
      trucks: true,
    })!;
    const { wAt, vAt, stations } = problem.layout;
    for (let i = 0; i < stations.length; i += 1) {
      expect(problem.colLower[wAt + i]).toBe(data.constants.MIN_CAPACITY_IF_BUILT);
      expect(problem.colUpper[wAt + i]).toBe(data.constants.CAPACITY_UB);
      expect(problem.colUpper[vAt + i]).toBe(data.constants.CAPACITY_UB);
    }
  });

  it('builds a valid CSC matrix', async () => {
    const data = await loadFixtureGameData();
    const golden = loadGolden('budget_020k');
    const problem = buildLp(data, {
      layout: golden.stations,
      budgetEur: golden.budget_eur,
      opsBudgetEur: golden.ops_budget_eur,
      epsilon: golden.epsilon,
      trucks: true,
    })!;
    expect(problem.starts).toHaveLength(problem.numCols + 1);
    expect(problem.starts[0]).toBe(0);
    expect(problem.starts[problem.numCols]).toBe(problem.values.length);
    expect(problem.indices).toHaveLength(problem.values.length);
    for (let k = 0; k < problem.indices.length; k += 1) {
      expect(problem.indices[k]!).toBeGreaterThanOrEqual(0);
      expect(problem.indices[k]!).toBeLessThan(problem.numRows);
    }
    for (let j = 0; j < problem.numCols; j += 1) {
      expect(problem.starts[j + 1]!).toBeGreaterThanOrEqual(problem.starts[j]!);
    }
  });

  it('the CPLEX text form is the same program as the sparse form', async () => {
    const data = await loadFixtureGameData();
    const golden = loadGolden('budget_020k');
    // The smallest committed design, and no trucks: the LP text of an 80 k
    // truck model runs to ~1.9 MB, which is exactly why the engine does not
    // use this path.
    const problem = buildLp(data, {
      layout: golden.stations,
      budgetEur: golden.budget_eur,
      opsBudgetEur: golden.ops_budget_eur,
      epsilon: golden.epsilon,
      trucks: false,
    })!;
    const highs = await createHighsLoader()();
    const sparse = solveWith(highs, problem);
    const text = highs.solve(toCplexLp(problem), { output_flag: false });
    expect(sparse.optimal).toBe(true);
    expect(text.Status).toBe('Optimal');
    let objective = 0;
    for (let j = 0; j < problem.numCols; j += 1) {
      objective += problem.colCost[j]! * sparse.colValue[j]!;
    }
    expect(text.ObjectiveValue).toBeCloseTo(objective, 6);
  }, 180000);
});
