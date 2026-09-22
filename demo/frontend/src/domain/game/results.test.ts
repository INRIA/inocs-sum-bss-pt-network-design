/**
 * results.test.ts — the view-model of steps 4 and 5.
 *
 * The optimiser column is checked against the committed `references.json`, so
 * the "same engine on both sides" decision (plan-technical §A, decision 4) is
 * pinned: the hero of that column is the browser engine's own figure and the
 * published one travels beside it, never instead of it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { compare, optimiserView, resultsView, rushOf, type OptimiserPlanFacts } from './results';
import { fakeEvaluation } from './testSupport';
import { decodeReferences } from '../../infra/gameData';
import type { BudgetReference } from '../evaluation/types';

const GAME = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../experiments/results/shared/game',
);
const RESULTS = join(dirname(fileURLToPath(import.meta.url)), '../../../../experiments/results');

const references = decodeReferences(
  JSON.parse(readFileSync(join(GAME, 'references.json'), 'utf8')),
);
const referenceAt = (eur: number): BudgetReference => {
  const found = references.byBudget.get(eur);
  if (!found) throw new Error(`no reference for ${eur}`);
  return found;
};

const planFacts = (scenario: string): OptimiserPlanFacts => {
  const paper = JSON.parse(readFileSync(join(RESULTS, scenario, 'kpis.json'), 'utf8')).paper;
  return {
    servedTotal: paper.served_total,
    servedRatio: paper.served_ratio,
    demandByPeriod: paper.demand_by_period,
    servedByPeriod: paper.served_by_period,
    bikeOnlyByPeriod: paper.bike_only_by_period,
    bikePtByPeriod: paper.bike_pt_by_period,
    stations: paper.stations,
    nTrans: paper.n_trans,
    docks: paper.docks,
    bikes: paper.bikes,
    capexUsedEur: paper.capex_used_eur,
    budgetEur: paper.budget_eur,
    dispatches: paper.dispatches,
  };
};

const visitor = () =>
  resultsView({
    evaluation: fakeEvaluation({ served: 900, ptShare: 0.35 }),
    withTrucks: fakeEvaluation({ served: 900 }),
    withoutTrucks: fakeEvaluation({ served: 864 }),
    budgetEur: 80000,
  });

describe('the visitor column', () => {
  it('builds the hero, the three tiles and the recap', () => {
    const view = visitor();
    expect(view.hero).toMatchObject({ served: 900, demand: 1453 });
    expect(view.hero.ratio).toBeCloseTo(900 / 1453, 6);
    expect(view.pt).toEqual({ share: 0.35, trips: 315 });
    expect(view.trucks).toEqual({ dependOnTrucks: 36, dispatches: null });
    expect(view.built).toEqual({
      stations: 60,
      atPtStops: 20,
      docks: 700,
      bikes: 500,
      capexEur: 60000,
      budgetEur: 80000,
    });
    expect(view.quality).toBe('exact');
  });

  it('never shows a truck count for the visitor', () => {
    expect(visitor().trucks.dispatches).toBeNull();
  });

  it('reads the rush tile as midday minus the mean of the two peaks', () => {
    const tile = rushOf({ servedByPeriod: [500, 900, 500], demandByPeriod: [1000, 1000, 1000] });
    expect(tile.middayRate).toBeCloseTo(0.9, 6);
    expect(tile.peakRate).toBeCloseTo(0.5, 6);
    expect(tile.gapPoints).toBeCloseTo(40, 6);
  });

  it('lists the periods and the losses, biggest cause first', () => {
    const view = visitor();
    expect(view.periods).toHaveLength(3);
    expect(view.periods[0]).toMatchObject({ period: 0, demand: 588 });
    expect(view.losses.map((row) => row.cause)).toEqual(['noStation', 'noStock', 'unreachable']);
    expect(view.losses[0]?.share).toBeCloseTo(200 / 1453, 6);
  });
});

describe('the optimiser column', () => {
  it('uses the same engine, and carries the published figure beside it', () => {
    const view = optimiserView({
      reference: referenceAt(80000),
      trucks: true,
      demandTotal: 1453,
      plan: planFacts('budget_080k'),
    });
    expect(view.engine).toBe('same-engine');
    expect(view.hero.served).toBe(1316);
    expect(view.published.served).toBe(1308);
    expect(view.hero.ratio).toBeCloseTo(1316 / 1453, 6);
    expect(view.built).toMatchObject({ stations: 83, docks: 1104, bikes: 827 });
    expect(view.trucks.dispatches).toBe(9);
    expect(view.trucks.dependOnTrucks).toBe(45);
    expect(view.rush?.gapPoints).toBeGreaterThan(3);
  });

  it('follows the trucks switch', () => {
    const off = optimiserView({ reference: referenceAt(80000), trucks: false, demandTotal: 1453 });
    expect(off.hero.served).toBeCloseTo(1271.054945, 6);
    expect(off.pt.share).toBeCloseTo(referenceAt(80000).optimiserPtShareNoTrucks, 6);
  });

  it('reports what references.json cannot say, rather than inventing it', () => {
    const bare = optimiserView({ reference: referenceAt(20000), trucks: true, demandTotal: 1453 });
    expect(bare.built).toBeNull();
    expect(bare.periods).toBeNull();
    expect(bare.rush).toBeNull();
    expect(bare.trucks.dispatches).toBeNull();
    expect(bare.nStations).toBe(33);
  });
});

describe('compare', () => {
  it('leads with what the optimiser sized, and ends with the served trips', () => {
    const rows = compare(
      visitor(),
      optimiserView({
        reference: referenceAt(80000),
        trucks: true,
        demandTotal: 1453,
        plan: planFacts('budget_080k'),
      }),
    );
    expect(rows.map((row) => row.key)).toEqual([
      'stations',
      'docks',
      'bikes',
      'truckRuns',
      'served',
      'ptShare',
      'rushGap',
    ]);
    expect(rows[0]).toMatchObject({ you: 60, optimiser: 83, labelKey: 'play.compare.stations' });
    expect(rows[3]).toMatchObject({ you: null, optimiser: 9, optimiserOnly: true });
    expect(rows[4]).toMatchObject({ you: 900, optimiser: 1316, format: 'trips' });
    // the two rows the screen shows after the sizing, each in its own unit
    expect(rows[5]).toMatchObject({ key: 'ptShare', format: 'share' });
    expect(rows[6]).toMatchObject({ key: 'rushGap', format: 'points' });
    expect(rows[6]!.optimiser).not.toBeNull();
  });

  it('falls back to the reference station count when no plan is passed', () => {
    const rows = compare(
      visitor(),
      optimiserView({ reference: referenceAt(20000), trucks: true, demandTotal: 1453 }),
    );
    expect(rows[0]?.optimiser).toBe(33);
    expect(rows[1]?.optimiser).toBeNull();
    expect(rows[3]?.optimiser).toBeNull();
    // with no plan there is no per-period split, so no rush gap to compare
    expect(rows[6]?.optimiser).toBeNull();
  });
});
