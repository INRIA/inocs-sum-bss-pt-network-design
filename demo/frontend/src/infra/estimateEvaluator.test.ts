/**
 * estimateEvaluator.test.ts — the fallback honours the contract, and says so.
 *
 * It is NOT pinned against the exact engine: it is a calibrated bound, not a
 * solve. What is pinned is that it satisfies the `Evaluator` contract, that it
 * is always labelled `estimate`, and that its error on the optimiser's own
 * layouts is bounded and recorded — so the size of the compromise is visible
 * rather than assumed.
 */
import { describe, expect, it } from 'vitest';

import { EstimateEvaluator } from './estimateEvaluator';
import { HighsEvaluator } from './highsEvaluator';
import { loadFixtureGameData, loadGolden } from './gameFixtures';
import { assistantOrder } from '../domain/placement/assistant';

describe('EstimateEvaluator', () => {
  it('is always labelled an estimate and never assigns flow', async () => {
    const data = await loadFixtureGameData();
    const estimate = new EstimateEvaluator(data);
    const result = await estimate.evaluate(loadGolden('budget_080k').stations, 80000, {
      trucks: true,
    });
    expect(result.quality).toBe('estimate');
    expect(result.flows).toEqual([]);
    // The model sizes the docks and the fleet; an estimate does not pretend to.
    expect(result.docks).toBe(0);
    expect(result.bikes).toBe(0);
  });

  it('answers for the degenerate layouts instead of throwing', async () => {
    const data = await loadFixtureGameData();
    const estimate = new EstimateEvaluator(data);
    const empty = await estimate.evaluate([], 80000, { trucks: true });
    expect(empty.served).toBe(0);
    expect(empty.feasible).toBe(true);
    expect(empty.losses.unreachable).toBeGreaterThan(0);

    const everything = await estimate.evaluate(
      Array.from({ length: data.candidates.length }, (_, i) => i),
      20000,
      { trucks: true },
    );
    expect(everything.feasible).toBe(true); // exactly on the budget boundary

    const over = await estimate.evaluate(
      Array.from({ length: data.candidates.length }, (_, i) => i),
      15000,
      { trucks: true },
    );
    expect(over.feasible).toBe(false);
    expect(over.served).toBe(0);
  });

  it('keeps the losses summing to the demand, like the exact engine', async () => {
    const data = await loadFixtureGameData();
    const estimate = new EstimateEvaluator(data);
    const result = await estimate.evaluate(loadGolden('budget_060k').stations, 60000, {
      trucks: true,
    });
    const total =
      result.served + result.losses.noStation + result.losses.noStock + result.losses.unreachable;
    expect(total).toBeCloseTo(result.demandTotal, 6);
  });

  it('is within a stated factor of the exact engine on real layouts', async () => {
    const data = await loadFixtureGameData();
    const exact = new HighsEvaluator(data);
    const estimate = new EstimateEvaluator(data);
    const ratios: number[] = [];
    for (const [budgetEur, reference] of data.references.byBudget) {
      // A layout the calibration was NOT fitted on: the assistant's.
      const layout = assistantOrder(data.coverage.reach, data.candidates.length, reference.nStations);
      const a = await exact.evaluate(layout, budgetEur, { trucks: true });
      const b = await estimate.evaluate(layout, budgetEur, { trucks: true });
      if (a.served > 0) ratios.push(b.served / a.served);
    }
    // eslint-disable-next-line no-console
    console.log(
      `estimate / exact on the assistant's layouts: ${ratios.map((r) => r.toFixed(3)).join(', ')}`,
    );
    // Documented expectation: tens of per cent, not per cent. The UI must show
    // the estimate tag whenever this evaluator is the one that answered.
    for (const ratio of ratios) {
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(1.6);
    }
  }, 180000);

  it('reports fewer served trips without trucks', async () => {
    const data = await loadFixtureGameData();
    const estimate = new EstimateEvaluator(data);
    const stations = loadGolden('budget_080k').stations;
    const on = await estimate.evaluate(stations, 80000, { trucks: true });
    const off = await estimate.evaluate(stations, 80000, { trucks: false });
    expect(off.served).toBeLessThanOrEqual(on.served);
  });
});
