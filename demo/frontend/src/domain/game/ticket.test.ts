/**
 * ticket.test.ts — the recap of step 6.
 *
 * The three marks are the only comparison the game makes; they are checked
 * against the committed `references.json` so "a planner placing at random ·
 * you · the optimiser" always carries the measured figures, and so the switch
 * moves the optimiser's mark but not the random planner's.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildTicket, marksFor } from './ticket';
import {
  EMPTY_SESSION,
  currentHash,
  reduce,
  type Action,
  type Session,
} from './session';
import { fakeEvaluation } from './testSupport';
import { decodeReferences } from '../../infra/gameData';
import type { ResolutionInputs } from './predictions';

const GAME = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../experiments/results/shared/game',
);
const references = decodeReferences(
  JSON.parse(readFileSync(join(GAME, 'references.json'), 'utf8')),
);
const reference = references.byBudget.get(80000)!;

const run = (session: Session, ...actions: Action[]): Session =>
  actions.reduce((state, action) => reduce(state, action), session);

const withTrucks = fakeEvaluation({ served: 1100, ptShare: 0.34 });
const withoutTrucks = fakeEvaluation({ served: 1060, ptShare: 0.33 });

const inputs: ResolutionInputs = {
  withTrucks,
  withoutTrucks,
  trucks: true,
  optimiserDispatches: 9,
  rhythm: { sharpStations: ['a', 'b'], referenceStations: ['a', 'b', 'c'] },
  double: { lowBudgetEur: 60000, highBudgetEur: 120000, lowServed: 1161, highServed: 1321 },
};

const played = (): Session => {
  const base = run(
    EMPTY_SESSION,
    { type: 'chooseBudget', budgetId: '080k' },
    { type: 'toggleStation', id: 1 },
    { type: 'toggleStation', id: 2 },
    { type: 'assist', ids: [10, 11, 12] },
    { type: 'answer', predictionId: 'served', optionId: '70to90' },
    { type: 'answer', predictionId: 'pt', optionId: '4in10' },
    { type: 'answer', predictionId: 'rush', optionId: 'bit' },
    { type: 'answer', predictionId: 'trucks', optionId: 'dozens' },
    { type: 'answer', predictionId: 'rhythm', optionId: 'move' },
    { type: 'answer', predictionId: 'double', optionId: 'none' },
  );
  return reduce(base, {
    type: 'setEvaluation',
    hash: currentHash(base),
    withTrucks,
    withoutTrucks,
  });
};

describe('buildTicket', () => {
  it('records the budget, who placed what, and every prediction', () => {
    const ticket = buildTicket(played(), { reference, resolution: inputs })!;
    expect(ticket).toMatchObject({
      budgetId: '080k',
      budgetEur: 80000,
      scenario: 'budget_080k',
      trucks: true,
    });
    expect(ticket.stations).toEqual({ total: 5, byMe: 2, byAssistant: 3, atPtStops: 20 });
    expect(ticket.predictions.map((entry) => entry.predictionId)).toEqual([
      'served',
      'pt',
      'rush',
      'trucks',
      'rhythm',
      'double',
    ]);
    // served, pt, rush and double were guessed right; trucks ("dozens" against
    // nine runs) and rhythm ("move them" against a contained plan) were not.
    expect(ticket.predictions.map((entry) => entry.matched)).toEqual([
      true,
      true,
      true,
      false,
      false,
      true,
    ]);
  });

  it('is null before there is anything to replay', () => {
    expect(buildTicket(EMPTY_SESSION, { reference, resolution: inputs })).toBeNull();
    const noEvaluation = reduce(EMPTY_SESSION, { type: 'chooseBudget', budgetId: '080k' });
    expect(buildTicket(noEvaluation, { reference, resolution: inputs })).toBeNull();
  });
});

describe('the three marks', () => {
  it('are random, you and the optimiser, measured by the same engine', () => {
    const marks = marksFor(reference, 1100, 1453, true);
    expect(marks.map((mark) => mark.key)).toEqual(['random', 'you', 'optimiser']);
    expect(marks.map((mark) => mark.labelKey)).toEqual([
      'play.mark.random',
      'play.mark.you',
      'play.mark.optimiser',
    ]);
    expect(marks[0]?.served).toBe(870);
    expect(marks[2]?.served).toBe(1316);
    expect(marks[1]?.ratio).toBeCloseTo(1100 / 1453, 6);
  });

  it('move the optimiser with the trucks switch, but not the random planner', () => {
    const on = marksFor(reference, 1100, 1453, true);
    const off = marksFor(reference, 1060, 1453, false);
    expect(off[2]?.served).toBeCloseTo(1271.054945, 6);
    expect(off[0]?.served).toBe(on[0]?.served);
  });

  it('follows the switch through the ticket', () => {
    const session = reduce(played(), { type: 'setTrucks', trucks: false });
    const ticket = buildTicket(session, { reference, resolution: inputs })!;
    expect(ticket.trucks).toBe(false);
    expect(ticket.marks[1]?.served).toBe(1060);
    // The predictions are resolved on the evidence they were given for: the
    // served question stays on the with-trucks solve whatever the switch says.
    expect(ticket.predictions[0]?.facts.served).toBe(1100);
  });
});
