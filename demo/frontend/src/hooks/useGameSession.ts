/**
 * useGameSession.ts — the session reducer, wired to React and to storage.
 *
 * Thin by design: every rule lives in `domain/game/session.ts`. The hook only
 * does what a hook must — hold the state, keep the actions stable, and move
 * the stored session in and out.
 *
 * HYDRATION: the first render is always the EMPTY session, on the server and
 * in the browser, so the markup matches; the stored one is applied in an effect
 * after mount, exactly as the current site applies its deep link. `hydrated`
 * says whether that pass has happened, so a screen can hold back a flash of
 * "start again" while it is still unknown.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import type { SessionStore } from '../domain/game/ports';
import {
  EMPTY_SESSION,
  createActions,
  deserialize,
  reduce,
  serialize,
  type Session,
  type SessionActions,
  type SessionEnv,
} from '../domain/game/session';

/** Long enough to coalesce a burst of taps, short enough to survive a reload. */
export const SAVE_DEBOUNCE_MS = 250;

export interface UseGameSession {
  readonly session: Session;
  readonly actions: SessionActions;
  /** False until the stored session has been read (or found missing). */
  readonly hydrated: boolean;
}

export interface UseGameSessionOptions {
  readonly debounceMs?: number;
  /** False keeps the session in memory only — used by the guided/projector run. */
  readonly persist?: boolean;
}

/**
 * @param store the persistence port; `infra/sessionStore.ts` in the browser.
 * @param env   what the data-driven actions need (constants for the budget
 *              refusal, the reach table for the assistant). Without it
 *              `toggleStation` cannot refuse and `assist` does nothing, which
 *              is the honest degradation while the payload is still loading.
 */
export function useGameSession(
  store: SessionStore,
  env: SessionEnv = {},
  options: UseGameSessionOptions = {},
): UseGameSession {
  const [session, dispatch] = useReducer(reduce, EMPTY_SESSION);
  const [hydrated, setHydrated] = useState(false);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const envRef = useRef(env);
  envRef.current = env;
  const storeRef = useRef(store);
  storeRef.current = store;

  // A view over the latest env, so the actions never have to be rebuilt when
  // the payload finishes loading.
  const liveEnv = useMemo<SessionEnv>(
    () => ({
      get constants() {
        return envRef.current.constants;
      },
      get candidateCount() {
        return envRef.current.candidateCount;
      },
      get reach() {
        return envRef.current.reach;
      },
    }),
    [],
  );

  const getSession = useCallback(() => sessionRef.current, []);
  const actions = useMemo(
    () => createActions(dispatch, getSession, liveEnv),
    [getSession, liveEnv],
  );

  useEffect(() => {
    const restored = deserialize(storeRef.current.load());
    if (restored) dispatch({ type: 'hydrate', session: restored });
    setHydrated(true);
  }, []);

  const persist = options.persist ?? true;
  const debounceMs = options.debounceMs ?? SAVE_DEBOUNCE_MS;
  useEffect(() => {
    if (!hydrated || !persist) return;
    const timer = setTimeout(() => {
      if (session === EMPTY_SESSION) storeRef.current.clear();
      else storeRef.current.save(serialize(session));
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [session, hydrated, persist, debounceMs]);

  return { session, actions, hydrated };
}
