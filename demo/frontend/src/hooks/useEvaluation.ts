/**
 * useEvaluation.ts — solve the visitor's layout while they answer the polls.
 *
 * The layout is frozen when the visitor leaves Build, so the worker has the
 * five polls' worth of time to download the solver and run both solves; the Run
 * step then never waits (plan-technical §C.5). The evaluators are INJECTED —
 * the hook constructs nothing, so a test or the projector build can pass the
 * estimate evaluator alone.
 *
 * Race safety: every result carries the hash of the layout it was asked for and
 * is dropped when that is no longer the current layout. A solve that rejects or
 * times out falls back to `fallback`, and `status` becomes `estimate`, which
 * the UI is REQUIRED to show (the `quality` field of the port).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Evaluation, Evaluator } from '../domain/evaluation/ports';
import { BUDGET_EUR, summarise, type Session, type SessionActions } from '../domain/game/session';
import {
  evaluatePair,
  evaluationRequest,
  type EvaluationPair,
  type GameEvaluator,
} from './evaluationPair';

export type EvaluationStatus = 'idle' | 'running' | 'ready' | 'estimate' | 'error';

export interface UseEvaluationOptions {
  /** The exact engine. Null while the payload or the worker is still loading. */
  readonly evaluator: GameEvaluator | null;
  /** The fallback, same contract, used when the exact one fails or times out. */
  readonly fallback: Evaluator | null;
  readonly session: Session;
  readonly actions: SessionActions;
}

export interface UseEvaluation {
  readonly status: EvaluationStatus;
  /** The solve the results switch selects, with its flows. */
  readonly current: Evaluation | null;
  /** Both solves of the current layout, with their flows. */
  readonly both: EvaluationPair | null;
  readonly error: string | null;
  /** Solve now, whatever the step — the "try again" button. */
  evaluate(): void;
}

export function useEvaluation(options: UseEvaluationOptions): UseEvaluation {
  const { evaluator, fallback, session, actions } = options;
  const [status, setStatus] = useState<EvaluationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pair, setPair] = useState<{ hash: string; pair: EvaluationPair } | null>(null);

  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const evaluatorRef = useRef(evaluator);
  evaluatorRef.current = evaluator;
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  /** Layouts already solved or being solved, so a re-render never re-solves. */
  const startedRef = useRef<string | null>(null);
  const cacheRef = useRef(new Map<string, EvaluationPair>());

  const budgetEur = session.budgetId ? BUDGET_EUR[session.budgetId] : 0;
  const request = evaluationRequest(session, budgetEur);
  const hash = request?.hash ?? null;
  const requestRef = useRef(request);
  requestRef.current = request;

  const solve = useCallback(
    async (target: { hash: string; layout: readonly number[]; budgetEur: number }) => {
      const cached = cacheRef.current.get(target.hash);
      if (cached) {
        setPair({ hash: target.hash, pair: cached });
        setStatus(cached.withTrucks.quality === 'estimate' ? 'estimate' : 'ready');
        return;
      }
      setStatus('running');
      setError(null);
      let solved: EvaluationPair | null = null;
      const exact = evaluatorRef.current;
      if (exact) {
        try {
          solved = await evaluatePair(exact, target.layout, target.budgetEur);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      }
      if (!solved && fallbackRef.current) {
        try {
          solved = await evaluatePair(fallbackRef.current, target.layout, target.budgetEur);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      }
      // The visitor edited the layout while we were solving: drop the answer.
      if (startedRef.current !== target.hash) return;
      if (!solved) {
        setStatus('error');
        return;
      }
      cacheRef.current.set(target.hash, solved);
      setPair({ hash: target.hash, pair: solved });
      setStatus(solved.withTrucks.quality === 'estimate' ? 'estimate' : 'ready');
      actionsRef.current.setEvaluation(target.hash, {
        withTrucks: summarise(solved.withTrucks),
        withoutTrucks: summarise(solved.withoutTrucks),
      });
    },
    [],
  );

  // `hash` is the identity of the request: the same layout at the same budget
  // is the same solve, so nothing else belongs in the dependencies.
  useEffect(() => {
    const target = requestRef.current;
    if (!target || startedRef.current === target.hash) return;
    if (!evaluatorRef.current && !fallbackRef.current) return;
    startedRef.current = target.hash;
    void solve(target);
  }, [hash, solve, evaluator, fallback]);

  const evaluate = useCallback(() => {
    const target = requestRef.current;
    if (!target) return;
    startedRef.current = target.hash;
    cacheRef.current.delete(target.hash);
    void solve(target);
  }, [solve]);

  const both = pair && pair.hash === hash ? pair.pair : null;
  const current = both ? (session.trucks ? both.withTrucks : both.withoutTrucks) : null;
  // A result that belongs to an older layout is not a result: while the new
  // one is being picked up by the effect, the honest status is `running`.
  const reported: EvaluationStatus = !hash
    ? 'idle'
    : both
      ? status
      : status === 'ready' || status === 'estimate'
        ? 'running'
        : status;
  return { status: reported, current, both, error, evaluate };
}
