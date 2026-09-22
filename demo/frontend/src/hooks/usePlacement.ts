/**
 * usePlacement.ts — one tap on the map becomes one decision.
 *
 * Pointer capture on the SVG makes per-element click handlers unreliable
 * (plan-technical §C.1), so the map hands this hook a tap in MAP units and it
 * does the rest with the pure hit test. The ambiguous case is a real outcome,
 * not a failure: the screen zooms and the second tap places (§B.3).
 *
 * Everything numeric here comes from `domain/placement/`; the hook adds
 * memoisation and nothing else.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import type { ModelConstants, ReachRow } from '../domain/evaluation/types';
import { budgetState, type BudgetState } from '../domain/placement/budget';
import { hitTest, type HitCandidate, type MapPoint } from '../domain/placement/hitTest';
import { reachByPeriod, reachFlow } from '../domain/placement/reach';
import {
  BUDGET_EUR,
  currentHash,
  layoutIds,
  type Session,
  type SessionActions,
} from '../domain/game/session';

export type TapOutcome = 'placed' | 'removed' | 'ambiguous' | 'miss' | 'refused';

export interface TapDetail {
  readonly outcome: TapOutcome;
  /** The contenders, when the tap was ambiguous. */
  readonly ids: readonly number[];
  /** i18n key, when the placement was refused. */
  readonly reasonKey?: string;
}

export interface ReachState {
  /** Demand within reach of the layout. An upper bound, never "served". */
  readonly flow: number;
  /** `flow / demandTotal`, 0 when the demand total is unknown. */
  readonly share: number;
  readonly byPeriod: readonly number[];
}

export interface UsePlacementOptions {
  readonly session: Session;
  readonly actions: SessionActions;
  /** Every candidate, in map units. */
  readonly candidates: readonly HitCandidate[];
  /** The touch radius, in MAP units: the screen radius divided by the scale. */
  readonly toMapRadius: number;
  /** The reach table of `coverage.json`, for the live preview. */
  readonly reach?: readonly ReachRow[];
  readonly demandTotal?: number;
  readonly periods?: number;
  readonly constants?: ModelConstants;
}

export interface UsePlacement {
  /** Resolve a tap. The screen zooms on `ambiguous` and explains `refused`. */
  onTap(point: MapPoint): TapOutcome;
  readonly lastTap: TapDetail | null;
  readonly reach: ReachState;
  readonly budgetMeter: BudgetState;
}

const NO_REACH: ReachState = { flow: 0, share: 0, byPeriod: [] };

export function usePlacement(options: UsePlacementOptions): UsePlacement {
  const { session, actions, candidates, toMapRadius } = options;
  const [lastTap, setLastTap] = useState<TapDetail | null>(null);

  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;
  const radiusRef = useRef(toMapRadius);
  radiusRef.current = toMapRadius;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const onTap = useCallback((point: MapPoint): TapOutcome => {
    const hit = hitTest(candidatesRef.current, point, radiusRef.current);
    if (hit.kind === 'miss') {
      setLastTap({ outcome: 'miss', ids: [] });
      return 'miss';
    }
    if (hit.kind === 'ambiguous') {
      setLastTap({ outcome: 'ambiguous', ids: hit.ids });
      return 'ambiguous';
    }
    const result = actionsRef.current.toggleStation(hit.id);
    const detail: TapDetail = {
      outcome: result.outcome,
      ids: [hit.id],
      reasonKey: result.reasonKey,
    };
    setLastTap(detail);
    return detail.outcome;
  }, []);

  // The layout hash is the cheapest stable key for "the layout changed".
  const hash = currentHash(session);
  const rows = options.reach;
  const demandTotal = options.demandTotal ?? 0;
  const periods = options.periods ?? 0;
  const reach = useMemo<ReachState>(() => {
    if (!rows || rows.length === 0) return NO_REACH;
    const ids = layoutIds(session.placed);
    const flow = reachFlow(rows, ids);
    return {
      flow,
      share: demandTotal > 0 ? flow / demandTotal : 0,
      byPeriod: periods > 0 ? reachByPeriod(rows, ids, periods) : [],
    };
    // `hash` stands in for `session.placed` in the dependencies: the same
    // layout at the same budget always has the same reach.
  }, [rows, hash, demandTotal, periods, session.placed]);

  const constants = options.constants;
  const budgetEur = session.budgetId ? BUDGET_EUR[session.budgetId] : 0;
  const budgetMeter = useMemo<BudgetState>(
    () =>
      constants
        ? budgetState(budgetEur, session.placed.length, constants)
        : {
            placed: session.placed.length,
            maxStations: 0,
            stationsEur: 0,
            minimumDocksEur: 0,
            remainingEur: budgetEur,
            usedFraction: 0,
            overBudget: false,
            overLimit: false,
            roomLeft: 0,
          },
    [constants, budgetEur, session.placed.length],
  );

  return { onTap, lastTap, reach, budgetMeter };
}
