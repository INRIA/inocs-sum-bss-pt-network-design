/**
 * useHashStep.ts — `#/step/<id>` in both directions.
 *
 * The current site has no history entries at all; the game gives each step one,
 * so the browser's back button walks the route instead of leaving the page.
 * A hash naming a step the session may not enter is not an error: the hook
 * walks back to the nearest step it may enter (`stepsBackFrom`) and rewrites
 * the hash, so a shared link always opens something.
 */
import { useEffect, useRef } from 'react';

import type { GameStep, StepGuard } from '../domain/game/steps';
import { parseStepHash, stepHash, stepsBackFrom } from './hashStep';

export type GoToStep = (step: GameStep) => StepGuard;

/**
 * @param step the step the session is on; written to the hash when it changes.
 * @param go   the session's guarded navigation; its guard decides the fallback.
 * @param ready false until the stored session has been restored. The session renders EMPTY first
 *             and is restored in an effect after mount; resolving the hash against that empty
 *             session would walk the visitor back to the first step and persist the demotion, so
 *             neither direction runs before `ready`.
 */
export function useHashStep(step: GameStep, go: GoToStep, ready = true): void {
  const goRef = useRef(go);
  goRef.current = go;
  const stepRef = useRef(step);
  stepRef.current = step;

  // hash -> session, on mount and on every back/forward.
  useEffect(() => {
    if (typeof window === 'undefined' || !ready) return;
    const apply = (): void => {
      const requested = parseStepHash(window.location.hash);
      if (!requested) {
        window.history.replaceState(null, '', stepHash(stepRef.current));
        return;
      }
      if (requested === stepRef.current) return;
      for (const candidate of stepsBackFrom(requested)) {
        if (goRef.current(candidate).ok) {
          if (candidate !== requested) {
            window.history.replaceState(null, '', stepHash(candidate));
          }
          return;
        }
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [ready]);

  // session -> hash. `location.hash =` pushes an entry, which is what makes
  // back and forward walk the route.
  useEffect(() => {
    if (typeof window === 'undefined' || !ready) return;
    const wanted = stepHash(step);
    if (window.location.hash !== wanted) window.location.hash = wanted;
  }, [step, ready]);
}
