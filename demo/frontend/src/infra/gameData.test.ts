/**
 * The references decoder must carry the WHOLE same-engine row.
 *
 * plan-technical §A.1 / decision 4: the "You · Optimiser" column shows both
 * sides measured by this engine, with and without trucks. That is only
 * possible if docks, bikes, the per-period series and the losses survive the
 * decoding — they were dropped before, leaving the column to mix engines.
 */
import { describe, expect, it } from 'vitest';

import { decodeReferences } from './gameData';
import { readGameJson } from './gameFixtures';

const references = decodeReferences(readGameJson('references.json'));
const at = (eur: number) => {
  const entry = references.byBudget.get(eur);
  if (!entry) throw new Error(`no reference at ${eur}`);
  return entry;
};

describe('decodeReferences', () => {
  it('keeps the four budgets and the fields the earlier decoder already had', () => {
    expect([...references.byBudget.keys()].sort((a, b) => a - b)).toEqual([
      20000, 60000, 80000, 120000,
    ]);
    const low = at(20000);
    expect(low.scenario).toBe('budget_020k');
    expect(low.nStations).toBe(low.optimiserStations.length);
    expect(low.optimiserServed).toBeGreaterThan(0);
    expect(low.reachCalibration).toBeGreaterThan(0);
  });

  it('carries the full optimiser run for both truck states', () => {
    for (const eur of [20000, 60000, 80000, 120000]) {
      const entry = at(eur);
      for (const run of [entry.optimiserWithTrucks, entry.optimiserWithoutTrucks]) {
        expect(run.feasible).toBe(true);
        expect(run.docks).toBeGreaterThan(0);
        expect(run.bikes).toBeGreaterThan(0);
        expect(run.nStations).toBe(entry.nStations);
        expect(run.servedByPeriod).toHaveLength(run.demandByPeriod.length);
        expect(run.bikeOnlyByPeriod).toHaveLength(run.servedByPeriod.length);
        expect(run.bikePtByPeriod).toHaveLength(run.servedByPeriod.length);
        const lost = run.losses.noStation + run.losses.noStock + run.losses.unreachable;
        expect(run.served + lost).toBeCloseTo(run.demandTotal, 3);
      }
      // the truck-free solve buys nothing to rebalance with
      expect(entry.optimiserWithoutTrucks.dispatchesRelaxed).toBe(0);
      expect(entry.optimiserWithoutTrucks.dispatchCostEur).toBe(0);
    }
  });

  it('agrees with the summary fields it already exposed, and adds the run envelopes', () => {
    const entry = at(80000);
    expect(entry.optimiserWithTrucks.served).toBe(entry.optimiserServed);
    expect(entry.optimiserWithoutTrucks.served).toBe(entry.optimiserServedNoTrucks);
    expect(entry.optimiserWithTrucks.ptShare).toBe(entry.optimiserPtShare);
    expect(entry.opsBudgetEur).toBeGreaterThan(0);
    expect(entry.epsilon).toBeGreaterThan(0);
    expect(entry.publishedServedRatio).toBeGreaterThan(0);
    expect(entry.randomServedRatioMedian).toBeGreaterThan(0);
    expect(entry.demandRuleServedRatio).toBeGreaterThan(0);
    expect(entry.reachCalibrationServed / entry.reachCalibrationReach).toBeCloseTo(
      entry.reachCalibration,
      4,
    );
  });
});
