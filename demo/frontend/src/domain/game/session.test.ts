/**
 * session.test.ts — the reducer, its guards and its persistence.
 *
 * The reducer is the whole application logic of the game, so the transitions
 * pinned here are the contract the screens build on: a layout change always
 * drops the evaluation, a budget change clears everything downstream, and a
 * corrupt stored blob is a missing session rather than a crash.
 */
import { describe, expect, it } from 'vitest';

import {
  BUDGET_EUR,
  EMPTY_SESSION,
  HISTORY_LIMIT,
  canPlace,
  createActions,
  currentHash,
  deserialize,
  evaluationIsStale,
  layoutHash,
  layoutIds,
  placedBy,
  reduce,
  serialize,
  summarise,
  type Action,
  type Session,
} from './session';
import { fakeEvaluation } from './testSupport';
import type { ModelConstants, ReachRow } from '../evaluation/types';
import type { Evaluation } from '../evaluation/ports';

const CONSTANTS = {
  station_setup_cost: 100,
  dock_cost: 20,
  unit_bike_cost: 60,
  dispatch_fixed_cost: 40,
  rebalancing_unit_cost: 20,
  PENALTY_COEFFICIENT: 0.1,
  CAPACITY_UB: 30,
  MIN_CAPACITY_IF_BUILT: 5,
  CAPACITY_REBALANCING_VEHICLE: 10,
  NUM_SHORTEST_PATHS: 3,
  EPSILON: 0.04,
  WALK_CATCHMENT_RADIUS: 0.3,
  TIME_PERIODS: 3,
} satisfies ModelConstants;

const run = (session: Session, ...actions: Action[]): Session =>
  actions.reduce((state, action) => reduce(state, action), session);

const started = (): Session =>
  run(EMPTY_SESSION, { type: 'chooseBudget', budgetId: '080k' });

const answeredAll = (session: Session): Session =>
  run(
    session,
    { type: 'answer', predictionId: 'served', optionId: '70to90' },
    { type: 'answer', predictionId: 'pt', optionId: '4in10' },
    { type: 'answer', predictionId: 'trucks', optionId: 'few' },
    { type: 'answer', predictionId: 'bikes', optionId: '5to15' },
  );

const evaluated = (session: Session): Session =>
  reduce(session, {
    type: 'setEvaluation',
    hash: currentHash(session),
    withTrucks: fakeEvaluation(),
    withoutTrucks: fakeEvaluation({ served: 940 }),
  });

describe('the layout', () => {
  it('places, removes and keeps who placed what', () => {
    const session = run(
      started(),
      { type: 'toggleStation', id: 7 },
      { type: 'assist', ids: [3, 9] },
    );
    expect(layoutIds(session.placed)).toEqual([3, 7, 9]);
    expect(placedBy(session, 'me')).toBe(1);
    expect(placedBy(session, 'assistant')).toBe(2);

    const removed = reduce(session, { type: 'toggleStation', id: 7 });
    expect(layoutIds(removed.placed)).toEqual([3, 9]);
  });

  it('refuses a station the capex cannot even give minimum docks', () => {
    // 79 900 + 5 x 20 = 80 000 EUR of floor cost, so 80 k EUR buys exactly one.
    const tiny = { ...CONSTANTS, station_setup_cost: 79900 };
    const session = run(started(), { type: 'toggleStation', id: 1, constants: tiny });
    expect(session.placed).toHaveLength(1);
    const refused = reduce(session, { type: 'toggleStation', id: 2, constants: tiny });
    expect(refused.placed).toHaveLength(1);
    expect(canPlace(session, 2, tiny)).toEqual({
      ok: false,
      reasonKey: 'play.refuse.budget.full',
    });
    // Removing one is always allowed, whatever the budget says.
    expect(canPlace(session, 1, tiny).ok).toBe(true);
  });

  it('refuses to place anything before a budget is chosen', () => {
    expect(canPlace(EMPTY_SESSION, 4, CONSTANTS)).toEqual({
      ok: false,
      reasonKey: 'play.refuse.budget',
    });
    expect(reduce(EMPTY_SESSION, { type: 'toggleStation', id: 4 }).placed).toHaveLength(0);
  });

  it('undoes one step at a time and stops at the start', () => {
    const session = run(
      started(),
      { type: 'toggleStation', id: 1 },
      { type: 'toggleStation', id: 2 },
      { type: 'assist', ids: [5, 6] },
    );
    const back = reduce(session, { type: 'undo' });
    expect(layoutIds(back.placed)).toEqual([1, 2]);
    const further = run(back, { type: 'undo' }, { type: 'undo' }, { type: 'undo' });
    expect(further.placed).toEqual([]);
    expect(reduce(further, { type: 'undo' })).toBe(further);
  });

  it('bounds the undo history', () => {
    let session = started();
    for (let id = 0; id < HISTORY_LIMIT + 10; id += 1) {
      session = reduce(session, { type: 'toggleStation', id });
    }
    expect(session.history).toHaveLength(HISTORY_LIMIT);
  });

  it('clears the layout in one action, and that is undoable', () => {
    const session = run(started(), { type: 'toggleStation', id: 1 }, { type: 'clearLayout' });
    expect(session.placed).toEqual([]);
    expect(layoutIds(reduce(session, { type: 'undo' }).placed)).toEqual([1]);
  });

  it('ignores an assist that adds nothing new', () => {
    const session = run(started(), { type: 'assist', ids: [4] });
    expect(reduce(session, { type: 'assist', ids: [4] })).toBe(session);
  });
});

describe('the evaluation', () => {
  it('is dropped by any layout change', () => {
    const session = evaluated(run(started(), { type: 'toggleStation', id: 1 }));
    expect(session.evaluation).not.toBeNull();
    expect(evaluationIsStale(session)).toBe(false);

    const changed = reduce(session, { type: 'toggleStation', id: 2 });
    expect(changed.evaluation).toBeNull();
    expect(changed.layoutHash).toBeNull();
    expect(evaluationIsStale(changed)).toBe(false);
  });

  it('is stale when the stored hash is not the current layout', () => {
    const session = evaluated(run(started(), { type: 'toggleStation', id: 1 }));
    const stale = { ...session, placed: [...session.placed, { id: 8, by: 'me' as const }] };
    expect(evaluationIsStale(stale)).toBe(true);
  });

  it('is cleared explicitly, and the switch picks a side', () => {
    const session = evaluated(run(started(), { type: 'toggleStation', id: 1 }));
    expect(session.trucks).toBe(true);
    const off = reduce(session, { type: 'setTrucks', trucks: false });
    expect(off.evaluation?.withoutTrucks.served).toBe(940);
    expect(reduce(off, { type: 'invalidateEvaluation' }).evaluation).toBeNull();
  });

  it('summarise drops the flows and keeps everything else', () => {
    const full = { ...fakeEvaluation(), flows: [[1, 0, 2]] } as Evaluation;
    const summary = summarise(full);
    expect('flows' in summary).toBe(false);
    expect(summary.served).toBe(full.served);
  });
});

describe('the hash', () => {
  it('does not depend on the placing order or on who placed', () => {
    const a = layoutHash([{ id: 5, by: 'me' }, { id: 2, by: 'assistant' }], '080k');
    const b = layoutHash([{ id: 2, by: 'me' }, { id: 5, by: 'me' }], '080k');
    expect(a).toBe(b);
    expect(layoutHash([2, 5], '080k')).toBe(a);
  });

  it('changes with the budget and with the layout', () => {
    expect(layoutHash([2, 5], '060k')).not.toBe(layoutHash([2, 5], '080k'));
    expect(layoutHash([2, 5], '080k')).not.toBe(layoutHash([2, 6], '080k'));
    expect(layoutHash([], null)).toBe('none-0-811c9dc5');
  });
});

describe('choosing a budget', () => {
  it('clears everything downstream, predictions included', () => {
    const session = evaluated(answeredAll(run(started(), { type: 'toggleStation', id: 1 })));
    expect(session.predictions.served).toBe('70to90');

    const changed = reduce(session, { type: 'chooseBudget', budgetId: '120k' });
    expect(changed.budgetId).toBe('120k');
    expect(changed.placed).toEqual([]);
    expect(changed.history).toEqual([]);
    expect(changed.predictions).toEqual({});
    expect(changed.evaluation).toBeNull();
    expect(changed.compareBudgetId).toBeNull();
  });

  it('is a no-op when the same budget is chosen again', () => {
    const session = run(started(), { type: 'toggleStation', id: 1 });
    expect(reduce(session, { type: 'chooseBudget', budgetId: '080k' })).toBe(session);
  });

  it('browsing another budget in step 5 never changes the chosen one', () => {
    const session = reduce(started(), { type: 'browseBudget', budgetId: '020k' });
    expect(session.compareBudgetId).toBe('020k');
    expect(session.budgetId).toBe('080k');
    expect(BUDGET_EUR[session.budgetId!]).toBe(80000);
  });
});

describe('answers', () => {
  it('records a known option and rejects anything else', () => {
    const session = reduce(started(), {
      type: 'answer',
      predictionId: 'served',
      optionId: '40to70',
    });
    expect(session.predictions.served).toBe('40to70');
    expect(
      reduce(session, { type: 'answer', predictionId: 'served', optionId: 'nonsense' }),
    ).toBe(session);
  });
});

describe('the step machine', () => {
  it('refuses a step whose guard does not hold, and records visits', () => {
    const session = started();
    expect(reduce(session, { type: 'go', step: 'predict' }).step).toBe('build');
    const moved = run(
      session,
      { type: 'toggleStation', id: 1 },
      { type: 'go', step: 'build' },
      { type: 'go', step: 'predict' },
    );
    expect(moved.step).toBe('predict');
    expect(moved.visited).toContain('build');
  });

  it('restarts to the empty session', () => {
    const session = evaluated(answeredAll(run(started(), { type: 'toggleStation', id: 1 })));
    expect(reduce(session, { type: 'restart' })).toEqual(EMPTY_SESSION);
  });
});

describe('persistence', () => {
  const full = (): Session => {
    const base = evaluated(answeredAll(run(started(), { type: 'toggleStation', id: 1 })));
    return run(base, { type: 'go', step: 'build' }, { type: 'browseBudget', budgetId: '120k' });
  };

  it('round-trips through JSON, minus the undo history', () => {
    const session = full();
    const back = deserialize(JSON.parse(JSON.stringify(serialize(session))));
    expect(back).toEqual({ ...session, history: [] });
  });

  it('rejects garbage without throwing', () => {
    for (const bad of [
      null,
      undefined,
      42,
      'session',
      [],
      {},
      { ...(serialize(full()) as object), version: 999 },
      { ...(serialize(full()) as Record<string, unknown>), budgetId: '999k' },
      { ...(serialize(full()) as Record<string, unknown>), placed: [{ id: -1, by: 'me' }] },
      { ...(serialize(full()) as Record<string, unknown>), placed: [{ id: 1, by: 'ghost' }] },
      { ...(serialize(full()) as Record<string, unknown>), step: 'elsewhere' },
      { ...(serialize(full()) as Record<string, unknown>), trucks: 'yes' },
      { ...(serialize(full()) as Record<string, unknown>), evaluation: { withTrucks: {} } },
    ]) {
      expect(() => deserialize(bad)).not.toThrow();
      expect(deserialize(bad)).toBeNull();
    }
  });

  it('drops an unknown prediction key rather than the whole session', () => {
    const raw = serialize(full()) as Record<string, unknown>;
    raw.predictions = { ...(raw.predictions as object), obsolete: 'yes' };
    const back = deserialize(raw);
    expect(back).not.toBeNull();
    expect(back && 'obsolete' in back.predictions).toBe(false);
  });

  it('falls back to the furthest allowed step when the stored one is closed', () => {
    const raw = serialize(started()) as Record<string, unknown>;
    raw.step = 'run';
    // A budget is set but nothing is placed, so `build` is as far as it goes.
    expect(deserialize(raw)?.step).toBe('build');
  });
});

describe('the bound action surface', () => {
  const reach: ReachRow[] = [
    { o: 0, d: 1, t: 0, flow: 10, sets: [[2, 3]] },
    { o: 0, d: 2, t: 0, flow: 4, sets: [[3]] },
  ];

  it('reports why a placement was refused, and assists within the budget', () => {
    let session = started();
    const actions = createActions(
      (action) => {
        session = reduce(session, action);
      },
      () => session,
      { constants: CONSTANTS, candidateCount: 8, reach },
    );

    expect(actions.toggleStation(3)).toEqual({ outcome: 'placed' });
    expect(actions.toggleStation(3)).toEqual({ outcome: 'removed' });

    const chosen = actions.assist(2);
    expect(chosen).toEqual([3, 2]);
    expect(placedBy(session, 'assistant')).toBe(2);

    expect(actions.go('predict').ok).toBe(true);
    expect(session.step).toBe('predict');
    const refused = actions.go('conclusions');
    expect(refused.ok).toBe(false);
  });

  it('does nothing when the assistant has no reach table', () => {
    let session = started();
    const actions = createActions(
      (action) => {
        session = reduce(session, action);
      },
      () => session,
      {},
    );
    expect(actions.assist(3)).toEqual([]);
    expect(session.placed).toEqual([]);
  });
});
