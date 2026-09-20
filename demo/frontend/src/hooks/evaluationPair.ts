/**
 * evaluationPair.ts — when to solve, and how to get both solves.
 *
 * The two decisions of `useEvaluation` that are worth testing without React
 * (plan-technical §C.5): the layout is frozen when the visitor leaves Build and
 * both truck states are solved while they answer the polls, so the Run step
 * never waits.
 */
import type { Evaluation, EvaluateOptions, Evaluator } from '../domain/evaluation/ports';
import { currentHash, type Session } from '../domain/game/session';

/** Something that solves both truck states in one round trip (the worker). */
export interface PairEvaluator {
  evaluateBoth(
    layout: readonly number[],
    budgetEur: number,
  ): Promise<{ withTrucks: Evaluation; withoutTrucks: Evaluation | null }>;
}

/** Either port is accepted: the worker's pair API, or one `Evaluator`. */
export type GameEvaluator = Evaluator | PairEvaluator;

export interface EvaluationPair {
  readonly withTrucks: Evaluation;
  readonly withoutTrucks: Evaluation;
}

const isPair = (evaluator: GameEvaluator): evaluator is PairEvaluator =>
  typeof (evaluator as PairEvaluator).evaluateBoth === 'function';

/**
 * Solve a layout with trucks and without.
 *
 * A pair evaluator that answers null for the truck-free solve (a worker that
 * only ran one) is completed with a second call when it can also `evaluate`,
 * and otherwise falls back to the with-trucks solve rather than inventing a
 * difference: "trips that depend on trucks" is then simply zero.
 */
export async function evaluatePair(
  evaluator: GameEvaluator,
  layout: readonly number[],
  budgetEur: number,
): Promise<EvaluationPair> {
  if (isPair(evaluator)) {
    const pair = await evaluator.evaluateBoth(layout, budgetEur);
    if (pair.withoutTrucks) {
      return { withTrucks: pair.withTrucks, withoutTrucks: pair.withoutTrucks };
    }
    const single = evaluator as unknown as Partial<Evaluator>;
    if (typeof single.evaluate === 'function') {
      const withoutTrucks = await single.evaluate(layout, budgetEur, { trucks: false });
      return { withTrucks: pair.withTrucks, withoutTrucks };
    }
    return { withTrucks: pair.withTrucks, withoutTrucks: pair.withTrucks };
  }
  const options = (trucks: boolean): EvaluateOptions => ({ trucks });
  const [withTrucks, withoutTrucks] = await Promise.all([
    evaluator.evaluate(layout, budgetEur, options(true)),
    evaluator.evaluate(layout, budgetEur, options(false)),
  ]);
  return { withTrucks, withoutTrucks };
}

export interface EvaluationRequest {
  readonly hash: string;
  readonly layout: readonly number[];
  readonly budgetEur: number;
}

/**
 * What this session should be solving right now, or null.
 *
 * The trigger is entering Predict: from that step on, an unsolved layout is
 * worth the worker. Build does not solve on every tap — the live preview there
 * is the reach table, which costs nothing.
 */
export function evaluationRequest(session: Session, budgetEur: number): EvaluationRequest | null {
  if (!session.budgetId || session.placed.length === 0) return null;
  const started = ['predict', 'run', 'optimiser', 'conclusions'];
  if (!started.includes(session.step)) return null;
  return {
    hash: currentHash(session),
    layout: session.placed.map((station) => station.id).sort((a, b) => a - b),
    budgetEur,
  };
}
