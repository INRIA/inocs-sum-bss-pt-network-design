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
    { type: 'answer', predictionId: 'rush', optionId: 'bit' },
    { type: 'answer', predictionId: 'trucks', optionId: 'few' },
    { type: 'answer', predictionId: 'rhythm', optionId: 'same' },
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
  it('is the six tracker steps behind one untracked entry', () => {
    expect(STEPS).toEqual(['budget', 'build', 'predict', 'run', 'optimiser', 'conclusions']);
    expect(ALL_STEPS[0]).toBe('entry');
    expect(stepDef('entry').tracked).toBe(false);
    expect(stepDef('build')).toMatchObject({
      index: 1,
      labelKey: 'play.step.build',
      rhythmKey: 'play.rhythm.build',
      tracked: true,
    });
    expect(isGameStep('build')).toBe(true);
    expect(isGameStep('nowhere')).toBe(false);
  });

  it('walks forward and back', () => {
    expect(nextStep('entry')).toBe('budget');
    expect(nextStep('conclusions')).toBeNull();
    expect(prevStep('budget')).toBe('entry');
    expect(prevStep('entry')).toBeNull();
  });
});

describe('the guards', () => {
  it('names what is missing, one decision at a time', () => {
    expect(canEnter('budget', EMPTY_SESSION).ok).toBe(true);
    expect(canEnter('build', EMPTY_SESSION)).toEqual({ ok: false, reasonKey: 'play.guard.budget' });
    expect(canEnter('predict', withBudget())).toEqual({
      ok: false,
      reasonKey: 'play.guard.station',
    });
    expect(canEnter('run', withStation())).toEqual({
      ok: false,
      reasonKey: 'play.guard.predictions',
    });
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

  it('answering only four of the five polls still locks the run', () => {
    const session = run(
      withStation(),
      { type: 'answer', predictionId: 'served', optionId: 'gt90' },
      { type: 'answer', predictionId: 'pt', optionId: '4in10' },
      { type: 'answer', predictionId: 'rush', optionId: 'bit' },
      { type: 'answer', predictionId: 'trucks', optionId: 'few' },
    );
    expect(canEnter('run', session).ok).toBe(false);
  });

  it('the step asked in the optimiser screen is not a gate on the run', () => {
    expect(canEnter('run', withAnswers()).ok).toBe(true);
  });
});

describe('furthestAllowed', () => {
  it('follows the session forward', () => {
    expect(furthestAllowed(EMPTY_SESSION)).toBe('budget');
    expect(furthestAllowed(withBudget())).toBe('build');
    expect(furthestAllowed(withStation())).toBe('predict');
    expect(furthestAllowed(withAnswers())).toBe('run');
    expect(furthestAllowed(withEvaluation())).toBe('optimiser');
    expect(furthestAllowed(reduce(withEvaluation(), { type: 'go', step: 'optimiser' }))).toBe(
      'conclusions',
    );
  });
});

describe('progress', () => {
  it('is the step index plus the fraction inside it', () => {
    const entry = progress(EMPTY_SESSION);
    expect(entry).toMatchObject({ index: -1, count: 6, within: 0, overall: 0 });

    const budget = progress(reduce(withBudget(), { type: 'go', step: 'budget' }));
    expect(budget.index).toBe(0);
    expect(budget.within).toBe(1);
    expect(budget.overall).toBeCloseTo(1 / 6, 6);
  });

  it('counts stations against a soft target while building', () => {
    let session = reduce(withBudget(), { type: 'go', step: 'build' });
    session = reduce(session, { type: 'assist', ids: [1, 2, 3, 4, 5] });
    expect(progress(session).within).toBeCloseTo(5 / BUILD_SOFT_TARGET, 6);
    expect(progress(session, { buildTarget: 10 }).within).toBeCloseTo(0.5, 6);
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
    expect(progress(session).within).toBeCloseTo(2 / 5, 6);
  });
});
