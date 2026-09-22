/**
 * steps.test.ts — the route and its guards.
 *
 * A deep link must never open a screen whose evidence does not exist, so every
 * guard is pinned with its reason key, and `furthestAllowed` is pinned at each
 * stage of a session: it is where an invalid hash lands.
 */
import { describe, expect, it } from 'vitest';

import {
  ALL_STEPS,
  BUILD_SOFT_TARGET,
  STEPS,
  canEnter,
  furthestAllowed,
  isGameStep,
  nextStep,
  prevStep,
  progress,
  stepDef,
} from './steps';
import {
  EMPTY_SESSION,
  currentHash,
  reduce,
  type Action,
  type Session,
} from './session';
import { fakeEvaluation } from './testSupport';

const run = (session: Session, ...actions: Action[]): Session =>
  actions.reduce((state, action) => reduce(state, action), session);

const withBudget = (): Session => reduce(EMPTY_SESSION, { type: 'chooseBudget', budgetId: '080k' });
const withStation = (): Session => reduce(withBudget(), { type: 'toggleStation', id: 3 });
const withAnswers = (): Session =>
  run(
    withStation(),
    { type: 'answer', predictionId: 'served', optionId: 'gt90' },
    { type: 'answer', predictionId: 'pt', optionId: '4in10' },
    { type: 'answer', predictionId: 'trucks', optionId: 'few' },
    { type: 'answer', predictionId: 'bikes', optionId: '5to15' },
  );
const withEvaluation = (): Session => {
  const session = withAnswers();
  return reduce(session, {
    type: 'setEvaluation',
    hash: currentHash(session),
    withTrucks: fakeEvaluation(),
    withoutTrucks: fakeEvaluation({ served: 900 }),
  });
};

describe('the route', () => {
  it('is the five tracker steps, opening on the first', () => {
    expect(STEPS).toEqual(['build', 'predict', 'run', 'optimiser', 'conclusions']);
    expect(ALL_STEPS[0]).toBe('build');
    expect(isGameStep('entry')).toBe(false);
    expect(stepDef('build')).toMatchObject({
      index: 0,
      labelKey: 'play.step.build',
      rhythmKey: 'play.rhythm.build',
    });
    expect(isGameStep('build')).toBe(true);
    expect(isGameStep('nowhere')).toBe(false);
  });

  it('walks forward and back', () => {
    expect(nextStep('build')).toBe('predict');
    expect(nextStep('conclusions')).toBeNull();
    expect(prevStep('predict')).toBe('build');
    expect(prevStep('build')).toBeNull();
  });
});

describe('the guards', () => {
  it('names what is missing, one decision at a time', () => {
    expect(canEnter('build', EMPTY_SESSION).ok).toBe(true);
    expect(canEnter('predict', EMPTY_SESSION)).toEqual({ ok: false, reasonKey: 'play.guard.budget' });
    expect(canEnter('predict', withBudget())).toEqual({
      ok: false,
      reasonKey: 'play.guard.station',
    });
    expect(canEnter('run', withStation()).ok).toBe(true);
    expect(canEnter('optimiser', withAnswers())).toEqual({
      ok: false,
      reasonKey: 'play.guard.evaluation',
    });
    expect(canEnter('conclusions', withEvaluation())).toEqual({
      ok: false,
      reasonKey: 'play.guard.optimiser',
    });
  });

  it('opens conclusions once the optimiser step has been visited', () => {
    const session = reduce(withEvaluation(), { type: 'go', step: 'optimiser' });
    expect(canEnter('conclusions', session).ok).toBe(true);
  });

  it('the polls are optional: the run opens with none answered', () => {
    expect(canEnter('run', withStation()).ok).toBe(true);
  });

  it('an answer can be taken back', () => {
    const answered = reduce(withStation(), { type: 'answer', predictionId: 'served', optionId: 'gt90' });
    expect(reduce(answered, { type: 'clearAnswer', predictionId: 'served' }).predictions).toEqual({});
  });

  it('the step asked in the optimiser screen is not a gate on the run', () => {
    expect(canEnter('run', withAnswers()).ok).toBe(true);
  });
});

describe('furthestAllowed', () => {
  it('follows the session forward', () => {
    expect(furthestAllowed(EMPTY_SESSION)).toBe('build');
    expect(furthestAllowed(withBudget())).toBe('build');
    expect(furthestAllowed(withStation())).toBe('run');
    expect(furthestAllowed(withAnswers())).toBe('run');
    expect(furthestAllowed(withEvaluation())).toBe('optimiser');
    expect(furthestAllowed(reduce(withEvaluation(), { type: 'go', step: 'optimiser' }))).toBe(
      'conclusions',
    );
  });
});

describe('progress', () => {
  it('is the step index plus the fraction inside it', () => {
    const first = progress(EMPTY_SESSION);
    expect(first).toMatchObject({ index: 0, count: 5, within: 0, overall: 0 });

    const budget = progress(reduce(withBudget(), { type: 'go', step: 'build' }));
    expect(budget.index).toBe(0);
    expect(budget.within).toBeGreaterThan(0);
    expect(budget.within).toBeLessThan(1);
    expect(budget.overall).toBeCloseTo(budget.within / 5, 6);
  });

  it('counts stations against a soft target while building', () => {
    let session = reduce(withBudget(), { type: 'go', step: 'build' });
    session = reduce(session, { type: 'assist', ids: [1, 2, 3, 4, 5] });
    // The budget choice is the first fifth of the step, the stations the rest.
    expect(progress(session).within).toBeCloseTo(0.2 + 0.8 * (5 / BUILD_SOFT_TARGET), 6);
    expect(progress(session, { buildTarget: 10 }).within).toBeCloseTo(0.6, 6);
    // A layout beyond the target never pushes the bike past the next step.
    const many = reduce(session, { type: 'assist', ids: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25] });
    expect(progress(many).within).toBe(1);
  });

  it('counts answers while predicting', () => {
    const session = run(
      reduce(withStation(), { type: 'go', step: 'predict' }),
      { type: 'answer', predictionId: 'served', optionId: 'gt90' },
      { type: 'answer', predictionId: 'pt', optionId: '4in10' },
    );
    expect(progress(session).within).toBeCloseTo(2 / 4, 6);
  });
});
