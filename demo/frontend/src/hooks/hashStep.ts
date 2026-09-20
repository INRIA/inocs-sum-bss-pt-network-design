/**
 * hashStep.ts — the deep-link grammar of the game, as pure functions.
 *
 * `#/step/<id>` from day one (plan.md §2). Everything a hash can mean is
 * decided here so `useHashStep` stays a subscription and nothing else, and so
 * the fallback rule — an invalid or not-yet-enterable hash lands on the
 * furthest step the session allows — is unit-tested without a DOM.
 */
import { ALL_STEPS, isGameStep, type GameStep } from '../domain/game/steps';

export const STEP_HASH_PREFIX = '#/step/';

export const stepHash = (step: GameStep): string => `${STEP_HASH_PREFIX}${step}`;

/** The step a hash names, or null when it names none this build knows. */
export function parseStepHash(hash: string): GameStep | null {
  if (!hash) return null;
  const withHash = hash.startsWith('#') ? hash : `#${hash}`;
  if (!withHash.startsWith(STEP_HASH_PREFIX)) return null;
  const id = withHash.slice(STEP_HASH_PREFIX.length).replace(/\/+$/, '');
  return isGameStep(id) ? id : null;
}

/**
 * The steps to try, nearest first, when a requested step is refused: the step
 * itself, then every earlier one. Walking back rather than jumping to `entry`
 * keeps a shared link as close to its intent as the session allows.
 */
export function stepsBackFrom(step: GameStep): GameStep[] {
  const at = ALL_STEPS.indexOf(step);
  if (at < 0) return [...ALL_STEPS].reverse();
  return ALL_STEPS.slice(0, at + 1).reverse();
}
