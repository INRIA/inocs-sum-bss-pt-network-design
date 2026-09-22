/**
 * evaluationPair.test.ts — when the solver starts, and how both solves arrive.
 *
 * `useEvaluation` is a subscription around these two functions. Pinning them
 * pins the promise the plan makes: the layout freezes when the visitor leaves
 * Build, both truck states are solved, and a worker that answers only one still
 * produces an honest pair.
 */
import { describe, expect, it, vi } from 'vitest';

import { evaluatePair, evaluationRequest } from './evaluationPair';
import type { Evaluation, Evaluator } from '../domain/evaluation/ports';
import {
  EMPTY_SESSION,
  currentHash,
  reduce,
  type Action,
  type Session,
} from '../domain/game/session';
import { fakeEvaluation } from '../domain/game/testSupport';

const evaluation = (served: number): Evaluation => ({ ...fakeEvaluation({ served }), flows: [] });

const run = (session: Session, ...actions: Action[]): Session =>
  actions.reduce((state, action) => reduce(state, action), session);

const playing = (step: Session['step']): Session =>
  run(
    EMPTY_SESSION,
    { type: 'chooseBudget', budgetId: '080k' },
    { type: 'toggleStation', id: 3 },
    { type: 'toggleStation', id: 9 },
    { type: 'go', step: 'build' },
    { type: 'go', step: step },
  );

describe('evaluationRequest', () => {
  it('asks for nothing before the visitor leaves Build', () => {
    expect(evaluationRequest(EMPTY_SESSION, 0)).toBeNull();
    expect(evaluationRequest(playing('build'), 80000)).toBeNull();
    const empty = run(EMPTY_SESSION, { type: 'chooseBudget', budgetId: '080k' });
    expect(evaluationRequest(empty, 80000)).toBeNull();
  });

  it('asks for the sorted layout from Predict on', () => {
    const session = playing('predict');
    expect(evaluationRequest(session, 80000)).toEqual({
      hash: currentHash(session),
      layout: [3, 9],
      budgetEur: 80000,
    });
  });

  it('changes identity with the layout', () => {
    const session = playing('predict');
    const more = reduce(session, { type: 'toggleStation', id: 4 });
    expect(evaluationRequest(more, 80000)?.hash).not.toBe(
      evaluationRequest(session, 80000)?.hash,
    );
  });
});

describe('evaluatePair', () => {
  it('calls a plain Evaluator twice, once per truck state', async () => {
    const evaluate = vi.fn(async (_layout, _budget, opts) =>
      evaluation(opts.trucks ? 1000 : 950),
    );
    const evaluator = { evaluate } as unknown as Evaluator;
    const pair = await evaluatePair(evaluator, [1, 2], 80000);
    expect(pair.withTrucks.served).toBe(1000);
    expect(pair.withoutTrucks.served).toBe(950);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('uses a pair evaluator in one round trip', async () => {
    const evaluateBoth = vi.fn(async () => ({
      withTrucks: evaluation(1000),
      withoutTrucks: evaluation(960),
    }));
    const pair = await evaluatePair({ evaluateBoth }, [1], 80000);
    expect(pair.withoutTrucks.served).toBe(960);
    expect(evaluateBoth).toHaveBeenCalledTimes(1);
  });

  it('completes a half answer with a second solve when it can', async () => {
    const evaluateBoth = vi.fn(async () => ({
      withTrucks: evaluation(1000),
      withoutTrucks: null,
    }));
    const evaluate = vi.fn(async () => evaluation(900));
    const pair = await evaluatePair({ evaluateBoth, evaluate } as never, [1], 80000);
    expect(pair.withoutTrucks.served).toBe(900);
  });

  it('never invents a difference when only one solve exists', async () => {
    const pair = await evaluatePair(
      { evaluateBoth: async () => ({ withTrucks: evaluation(1000), withoutTrucks: null }) },
      [1],
      80000,
    );
    expect(pair.withoutTrucks.served).toBe(1000);
  });

  it('propagates a rejection so the caller can fall back', async () => {
    await expect(
      evaluatePair(
        {
          evaluateBoth: async () => {
            throw new Error('solver timed out after 8000 ms');
          },
        },
        [1],
        80000,
      ),
    ).rejects.toThrow(/timed out/);
  });
});
