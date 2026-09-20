/**
 * budget.test.ts — the arithmetic behind the budget meter.
 *
 * The constants come from the committed `constants.json`, which the exporter
 * read from network-design-bss/src/. Nothing here hard-codes a unit cost.
 */
import { describe, expect, it } from 'vitest';

import { budgetState, maxStations, stationFloorCostEur, stationsCostEur } from './budget';
import { decodeConstants } from '../../infra/gameData';
import { readGameJson } from '../../infra/gameFixtures';

const { constants, budgets } = decodeConstants(readGameJson('constants.json'));

describe('budget arithmetic', () => {
  it('prices the cheapest possible station from the model constants', () => {
    expect(stationFloorCostEur(constants)).toBe(
      constants.station_setup_cost + constants.dock_cost * constants.MIN_CAPACITY_IF_BUILT,
    );
  });

  it('agrees with the exporter on how many stations each budget can pay for', () => {
    for (const budget of budgets) {
      expect(maxStations(budget.capexEur, constants), budget.scenario).toBe(budget.maxStations);
    }
  });

  it('counts the stations themselves', () => {
    expect(stationsCostEur(constants, 0)).toBe(0);
    expect(stationsCostEur(constants, 7)).toBe(7 * constants.station_setup_cost);
  });

  it('leaves the model what is left after the minimum docks', () => {
    const state = budgetState(80000, 10, constants);
    expect(state.stationsEur).toBe(10 * constants.station_setup_cost);
    expect(state.minimumDocksEur).toBe(
      10 * constants.dock_cost * constants.MIN_CAPACITY_IF_BUILT,
    );
    expect(state.remainingEur).toBe(80000 - state.stationsEur - state.minimumDocksEur);
    expect(state.overBudget).toBe(false);
  });

  it('flags the layout the budget cannot pay for', () => {
    const limit = maxStations(20000, constants);
    expect(budgetState(20000, limit, constants).overBudget).toBe(false);
    expect(budgetState(20000, limit, constants).roomLeft).toBe(0);
    const over = budgetState(20000, limit + 1, constants);
    expect(over.overBudget).toBe(true);
    expect(over.remainingEur).toBeLessThan(0);
    expect(over.roomLeft).toBe(0);
  });

  it('every candidate at 20 000 EUR is exactly on the boundary', () => {
    // The documented degenerate case: 100 stations plus their minimum docks
    // cost precisely the smallest game budget, so nothing is left for bikes.
    const state = budgetState(20000, 100, constants);
    expect(state.overBudget).toBe(false);
    expect(state.remainingEur).toBe(0);
  });

  it('clamps the meter to 0..1', () => {
    expect(budgetState(20000, 0, constants).usedFraction).toBe(0);
    expect(budgetState(20000, 500, constants).usedFraction).toBe(1);
    expect(budgetState(0, 3, constants).usedFraction).toBe(0);
  });
});
