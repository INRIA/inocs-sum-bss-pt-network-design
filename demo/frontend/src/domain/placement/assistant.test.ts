/**
 * assistant.test.ts — the follow-the-demand rule must be the SAME rule the
 * Python reference recorded.
 *
 * `references.json` stores the layout `fixed_design.assistant_order()` produces
 * at each budget, and the game shows the visitor against it. If this
 * transcription drifted, the Assistant and its own reference would disagree on
 * screen, so the equality is pinned exactly — not within a tolerance.
 */
import { describe, expect, it } from 'vitest';

import { assistantOrder, nextSuggestion } from './assistant';
import { marginalReach, reachFlow } from './reach';
import { decodeCoverage, decodeReferences } from '../../infra/gameData';
import { readGameJson } from '../../infra/gameFixtures';
import type { ReachRow } from '../evaluation/types';

const coverage = decodeCoverage(readGameJson('coverage.json'));
const references = decodeReferences(readGameJson('references.json'));
const CANDIDATES = 100;

describe('the assistant reproduces the Python reference', () => {
  it('produces exactly the demand-rule layout of references.json', () => {
    expect(references.byBudget.size).toBe(4);
    for (const [budgetEur, reference] of references.byBudget) {
      const order = assistantOrder(coverage.reach, CANDIDATES, reference.nStations);
      expect(order, `budget ${budgetEur}`).toEqual([...reference.demandRuleStations]);
    }
  });

  it('is deterministic', () => {
    const first = assistantOrder(coverage.reach, CANDIDATES, 25);
    const second = assistantOrder(coverage.reach, CANDIDATES, 25);
    expect(first).toEqual(second);
  });

  it('is a prefix: asking for fewer gives the first of the same picks', () => {
    const long = assistantOrder(coverage.reach, CANDIDATES, 30);
    const short = assistantOrder(coverage.reach, CANDIDATES, 12);
    expect(long.slice(0, 12)).toEqual(short);
  });

  it('never suggests a station twice and continues from what is placed', () => {
    const start = assistantOrder(coverage.reach, CANDIDATES, 5);
    const rest = assistantOrder(coverage.reach, CANDIDATES, 5, start);
    expect(new Set([...start, ...rest]).size).toBe(10);
    for (const station of rest) expect(start).not.toContain(station);
  });

  it('each pick is the best available marginal gain at that moment', () => {
    const order = assistantOrder(coverage.reach, CANDIDATES, 6);
    const placed: number[] = [];
    for (const chosen of order) {
      const gainOfChosen = marginalReach(coverage.reach, placed, chosen);
      for (let candidate = 0; candidate < CANDIDATES; candidate += 1) {
        if (placed.includes(candidate)) continue;
        expect(marginalReach(coverage.reach, placed, candidate)).toBeLessThanOrEqual(
          gainOfChosen,
        );
      }
      placed.push(chosen);
    }
  });

  it('reach only ever grows as stations are added', () => {
    const order = assistantOrder(coverage.reach, CANDIDATES, 20);
    let previous = reachFlow(coverage.reach, []);
    expect(previous).toBe(0);
    const placed: number[] = [];
    for (const station of order) {
      placed.push(station);
      const now = reachFlow(coverage.reach, placed);
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
  });

  it('nextSuggestion agrees with a full run', () => {
    const order = assistantOrder(coverage.reach, CANDIDATES, 3);
    expect(nextSuggestion(coverage.reach, CANDIDATES, [])).toBe(order[0]);
    expect(nextSuggestion(coverage.reach, CANDIDATES, order.slice(0, 1))).toBe(order[1]);
  });

  it('breaks ties on the smallest id', () => {
    const rows: ReachRow[] = [
      { o: 0, d: 1, t: 0, flow: 10, sets: [[7], [2]] },
      { o: 0, d: 2, t: 0, flow: 10, sets: [[4]] },
    ];
    // 2, 4 and 7 all unlock 10; 2 is smallest, then 4 unlocks the second row.
    expect(assistantOrder(rows, 8, 2)).toEqual([2, 4]);
  });

  it('stops when nothing is left to pick', () => {
    const rows: ReachRow[] = [{ o: 0, d: 1, t: 0, flow: 1, sets: [[0]] }];
    expect(assistantOrder(rows, 3, 99)).toHaveLength(3);
  });
});
