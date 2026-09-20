/**
 * session.ts — the visitor's session: state, a pure reducer, and persistence.
 *
 * One reducer, as plan-technical §C.5 asks. It holds decisions, not data: the
 * layout is a list of candidate INDICES (the interning contract of
 * domain/evaluation/types.ts — a station IS its index in `candidates`), and the
 * evaluation is kept WITHOUT its `flows`, which are bulky, unserialisable in
 * practice and only ever needed by the run animation. The hook keeps the full
 * evaluations in memory, keyed by layout hash; this state keeps the summaries.
 *
 * Nothing here reads the clock, storage or the network. `serialize` /
 * `deserialize` are the only bridge to `infra/sessionStore.ts`, and
 * `deserialize` NEVER throws: an unknown version or a malformed blob is a
 * missing session, not an error the screens have to handle.
 *
 * Pure domain: no React, no DOM, no fetch, no node imports.
 */
import type { Evaluation } from '../evaluation/ports';
import type { ModelConstants, ReachRow } from '../evaluation/types';
import { assistantOrder } from '../placement/assistant';
import { budgetState } from '../placement/budget';
import { isOptionOf, isPredictionId, type PredictionId } from './predictions';
import { ALL_STEPS, canEnter, isGameStep, type GameStep, type StepGuard } from './steps';

/** Bump when the stored shape changes: an older blob is then ignored whole. */
export const SESSION_STATE_VERSION = 1;

/** A station, as the session names it: its index in `GameData.candidates`. */
export type StationId = number;

export type BudgetId = '020k' | '060k' | '080k' | '120k';

export const BUDGET_IDS: readonly BudgetId[] = ['020k', '060k', '080k', '120k'];

/** The capex envelope of each budget, in euros. Mirrors constants.json. */
export const BUDGET_EUR: Readonly<Record<BudgetId, number>> = {
  '020k': 20000,
  '060k': 60000,
  '080k': 80000,
  '120k': 120000,
};

/** The committed run each budget borrows its demand and envelopes from. */
export const BUDGET_SCENARIO: Readonly<Record<BudgetId, string>> = {
  '020k': 'budget_020k',
  '060k': 'budget_060k',
  '080k': 'budget_080k',
  '120k': 'budget_120k',
};

export function isBudgetId(value: unknown): value is BudgetId {
  return typeof value === 'string' && BUDGET_IDS.includes(value as BudgetId);
}

/** The budget whose envelope is exactly `eur`, or null. */
export function budgetIdFor(eur: number): BudgetId | null {
  return BUDGET_IDS.find((id) => BUDGET_EUR[id] === eur) ?? null;
}

export interface PlacedStation {
  readonly id: StationId;
  readonly by: 'me' | 'assistant';
}

/** An `Evaluation` without its `flows`: what the session is allowed to hold. */
export type EvaluationSummary = Omit<Evaluation, 'flows'>;

/** Drop the flows. The hook keeps the full evaluation in memory instead. */
export function summarise(evaluation: Evaluation): EvaluationSummary {
  const { flows: _flows, ...rest } = evaluation;
  return rest;
}

export interface EvaluationPair {
  readonly withTrucks: EvaluationSummary;
  readonly withoutTrucks: EvaluationSummary;
}

export interface Session {
  readonly version: number;
  readonly budgetId: BudgetId | null;
  readonly placed: readonly PlacedStation[];
  /** Layout snapshots for undo, oldest first, bounded by `HISTORY_LIMIT`. */
  readonly history: readonly (readonly PlacedStation[])[];
  readonly predictions: Readonly<Partial<Record<PredictionId, string>>>;
  readonly step: GameStep;
  readonly visited: readonly GameStep[];
  /** The results switch of steps 4 and 5. With trucks by default. */
  readonly trucks: boolean;
  /** The hash of the layout `evaluation` belongs to; null when there is none. */
  readonly layoutHash: string | null;
  readonly evaluation: EvaluationPair | null;
  /** The budget being browsed in step 5. Never changes `budgetId`. */
  readonly compareBudgetId: BudgetId | null;
}

/** How many layout snapshots undo can walk back through. */
export const HISTORY_LIMIT = 50;

export const EMPTY_SESSION: Session = {
  version: SESSION_STATE_VERSION,
  budgetId: null,
  placed: [],
  history: [],
  predictions: {},
  step: 'entry',
  visited: ['entry'],
  trucks: true,
  layoutHash: null,
  evaluation: null,
  compareBudgetId: null,
};

/** The sorted candidate indices of a layout. The engine's input. */
export function layoutIds(placed: readonly PlacedStation[]): StationId[] {
  return placed.map((station) => station.id).sort((a, b) => a - b);
}

/**
 * A stable short hash of "this layout at this budget".
 *
 * FNV-1a over the sorted ids, prefixed with the budget and the count so a
 * collision would need the same budget AND the same station count. A collision
 * would only mean a stale evaluation is kept, never a crash.
 */
export function layoutHash(
  placed: readonly PlacedStation[] | readonly StationId[],
  budgetId: BudgetId | null,
): string {
  const ids = placed.map((entry) => (typeof entry === 'number' ? entry : entry.id));
  ids.sort((a, b) => a - b);
  let hash = 0x811c9dc5;
  for (const id of ids) {
    hash ^= id + 1;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${budgetId ?? 'none'}-${ids.length}-${hash.toString(16)}`;
}

/** The hash of the layout the session holds right now. */
export const currentHash = (session: Session): string =>
  layoutHash(session.placed, session.budgetId);

/** True when the stored evaluation no longer describes the current layout. */
export const evaluationIsStale = (session: Session): boolean =>
  session.evaluation != null && session.layoutHash !== currentHash(session);

/** The evaluation the results screens should read, following the switch. */
export function currentEvaluation(session: Session): EvaluationSummary | null {
  if (!session.evaluation) return null;
  return session.trucks ? session.evaluation.withTrucks : session.evaluation.withoutTrucks;
}

export const budgetEurOf = (session: Session): number =>
  session.budgetId ? BUDGET_EUR[session.budgetId] : 0;

export const placedBy = (session: Session, by: 'me' | 'assistant'): number =>
  session.placed.filter((station) => station.by === by).length;

export const isPlaced = (session: Session, id: StationId): boolean =>
  session.placed.some((station) => station.id === id);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  /** Clears EVERYTHING downstream — see `reduce`. */
  | { readonly type: 'chooseBudget'; readonly budgetId: BudgetId }
  /** Place or remove one station. Refused silently when `canPlace` says no. */
  | { readonly type: 'toggleStation'; readonly id: StationId; readonly constants?: ModelConstants }
  /** Add the stations the assistant chose; the caller resolved the order. */
  | { readonly type: 'assist'; readonly ids: readonly StationId[] }
  | { readonly type: 'undo' }
  | { readonly type: 'clearLayout' }
  | { readonly type: 'answer'; readonly predictionId: PredictionId; readonly optionId: string }
  /** Ignored when `canEnter` refuses; the caller asks first to get the reason. */
  | { readonly type: 'go'; readonly step: GameStep }
  | { readonly type: 'setTrucks'; readonly trucks: boolean }
  | {
      readonly type: 'setEvaluation';
      readonly hash: string;
      readonly withTrucks: EvaluationSummary;
      readonly withoutTrucks: EvaluationSummary;
    }
  | { readonly type: 'invalidateEvaluation' }
  | { readonly type: 'browseBudget'; readonly budgetId: BudgetId }
  | { readonly type: 'restart' }
  /** Replace the state with a stored one, after hydration. */
  | { readonly type: 'hydrate'; readonly session: Session };

const pushHistory = (session: Session): readonly (readonly PlacedStation[])[] =>
  [...session.history, session.placed].slice(-HISTORY_LIMIT);

/** Any layout change drops the evaluation: it described the previous layout. */
const withLayout = (
  session: Session,
  placed: readonly PlacedStation[],
  history: readonly (readonly PlacedStation[])[],
): Session => ({
  ...session,
  placed,
  history,
  evaluation: null,
  layoutHash: null,
});

const visit = (session: Session, step: GameStep): readonly GameStep[] =>
  session.visited.includes(step) ? session.visited : [...session.visited, step];

/**
 * Can one more station be placed?
 *
 * The capex must still pay `MIN_CAPACITY_IF_BUILT` docks behind every open
 * station (placement/budget.ts); beyond that the LP is infeasible and the game
 * would be showing a design nobody can build. Without `constants` the check is
 * skipped — the caller has not loaded the model constants yet.
 */
export function canPlace(
  session: Session,
  id: StationId,
  constants?: ModelConstants,
): StepGuard {
  if (isPlaced(session, id)) return { ok: true };
  if (!session.budgetId) return { ok: false, reasonKey: 'play.refuse.budget' };
  if (!constants) return { ok: true };
  const state = budgetState(BUDGET_EUR[session.budgetId], session.placed.length + 1, constants);
  if (state.overBudget) return { ok: false, reasonKey: 'play.refuse.budget.full' };
  return { ok: true };
}

/**
 * The reducer. Total and pure: an action it cannot honour returns the state
 * unchanged, so a screen can dispatch optimistically and ask the matching
 * query (`canPlace`, `canEnter`) when it needs the reason.
 */
export function reduce(session: Session, action: Action): Session {
  switch (action.type) {
    case 'chooseBudget': {
      if (session.budgetId === action.budgetId) return session;
      // Changing the budget clears EVERYTHING downstream — layout, undo
      // history, predictions and evaluation. The predictions are not kept:
      // "under 40 %" means something different at 20 k€ and at 120 k€, so a
      // kept answer would be replayed against evidence it was never given for.
      return {
        ...EMPTY_SESSION,
        version: session.version,
        budgetId: action.budgetId,
        step: session.step === 'entry' ? 'entry' : 'budget',
        visited: session.step === 'entry' ? ['entry'] : ['entry', 'budget'],
      };
    }
    case 'toggleStation': {
      if (!session.budgetId) return session;
      if (isPlaced(session, action.id)) {
        const placed = session.placed.filter((station) => station.id !== action.id);
        return withLayout(session, placed, pushHistory(session));
      }
      if (!canPlace(session, action.id, action.constants).ok) return session;
      const placed = [...session.placed, { id: action.id, by: 'me' as const }];
      return withLayout(session, placed, pushHistory(session));
    }
    case 'assist': {
      if (!session.budgetId) return session;
      const fresh = action.ids.filter((id) => !isPlaced(session, id));
      if (fresh.length === 0) return session;
      const placed = [
        ...session.placed,
        ...fresh.map((id) => ({ id, by: 'assistant' as const })),
      ];
      return withLayout(session, placed, pushHistory(session));
    }
    case 'undo': {
      if (session.history.length === 0) return session;
      const placed = session.history[session.history.length - 1];
      return withLayout(session, placed, session.history.slice(0, -1));
    }
    case 'clearLayout': {
      if (session.placed.length === 0) return session;
      return withLayout(session, [], pushHistory(session));
    }
    case 'answer': {
      if (!isPredictionId(action.predictionId)) return session;
      if (!isOptionOf(action.predictionId, action.optionId)) return session;
      return {
        ...session,
        predictions: { ...session.predictions, [action.predictionId]: action.optionId },
      };
    }
    case 'go': {
      if (!isGameStep(action.step)) return session;
      if (!canEnter(action.step, session).ok) return session;
      if (session.step === action.step) {
        return { ...session, visited: visit(session, action.step) };
      }
      return { ...session, step: action.step, visited: visit(session, action.step) };
    }
    case 'setTrucks':
      return session.trucks === action.trucks ? session : { ...session, trucks: action.trucks };
    case 'setEvaluation':
      return {
        ...session,
        layoutHash: action.hash,
        evaluation: { withTrucks: action.withTrucks, withoutTrucks: action.withoutTrucks },
      };
    case 'invalidateEvaluation':
      if (!session.evaluation && session.layoutHash == null) return session;
      return { ...session, evaluation: null, layoutHash: null };
    case 'browseBudget':
      return session.compareBudgetId === action.budgetId
        ? session
        : { ...session, compareBudgetId: action.budgetId };
    case 'restart':
      return EMPTY_SESSION;
    case 'hydrate':
      return action.session;
    default:
      return session;
  }
}

// ---------------------------------------------------------------------------
// Action creators
// ---------------------------------------------------------------------------

/**
 * What the two data-driven actions need. Supplied once by `PlayApp`, which is
 * the layer that has the decoded payload; the reducer itself stays free of it.
 */
export interface SessionEnv {
  readonly constants?: ModelConstants;
  /** How many candidates exist (ids are 0..candidateCount-1). */
  readonly candidateCount?: number;
  /** The reach table of `coverage.json`, for the assistant. */
  readonly reach?: readonly ReachRow[];
}

export type ToggleOutcome = 'placed' | 'removed' | 'refused';

export interface ToggleResult {
  readonly outcome: ToggleOutcome;
  /** i18n key, set only when `outcome` is `refused`. */
  readonly reasonKey?: string;
}

/** The typed action surface the screens use. `useGameSession` returns one. */
export interface SessionActions {
  chooseBudget(budgetId: BudgetId): void;
  /** Places, removes, or refuses with a reason. */
  toggleStation(id: StationId): ToggleResult;
  /** Places up to `n` stations with the follow-the-demand rule. Returns them. */
  assist(n: number): StationId[];
  undo(): void;
  clearLayout(): void;
  answer(predictionId: PredictionId, optionId: string): void;
  /** Moves if the guard allows, and returns the guard either way. */
  go(step: GameStep): StepGuard;
  setTrucks(trucks: boolean): void;
  setEvaluation(hash: string, pair: EvaluationPair): void;
  invalidateEvaluation(): void;
  browseBudget(budgetId: BudgetId): void;
  restart(): void;
  hydrate(session: Session): void;
}

/**
 * Bind the actions to a dispatch and a way to read the current state.
 *
 * Pure: `createActions` is used by `useGameSession`, but nothing here touches
 * React, so the whole action surface is unit-testable with a plain closure.
 */
export function createActions(
  dispatch: (action: Action) => void,
  getSession: () => Session,
  env: SessionEnv = {},
): SessionActions {
  return {
    chooseBudget: (budgetId) => dispatch({ type: 'chooseBudget', budgetId }),
    toggleStation: (id) => {
      const session = getSession();
      if (isPlaced(session, id)) {
        dispatch({ type: 'toggleStation', id, constants: env.constants });
        return { outcome: 'removed' };
      }
      const guard = canPlace(session, id, env.constants);
      if (!guard.ok) return { outcome: 'refused', reasonKey: guard.reasonKey };
      dispatch({ type: 'toggleStation', id, constants: env.constants });
      return { outcome: 'placed' };
    },
    assist: (n) => {
      const session = getSession();
      const rows = env.reach;
      const candidateCount = env.candidateCount ?? 0;
      if (!rows || candidateCount <= 0 || !session.budgetId || n <= 0) return [];
      const already = layoutIds(session.placed);
      let limit = Math.floor(n);
      if (env.constants) {
        const room = budgetState(
          BUDGET_EUR[session.budgetId],
          session.placed.length,
          env.constants,
        ).roomLeft;
        limit = Math.min(limit, room);
      }
      if (limit <= 0) return [];
      const ids = assistantOrder(rows, candidateCount, limit, already);
      if (ids.length > 0) dispatch({ type: 'assist', ids });
      return ids;
    },
    undo: () => dispatch({ type: 'undo' }),
    clearLayout: () => dispatch({ type: 'clearLayout' }),
    answer: (predictionId, optionId) => dispatch({ type: 'answer', predictionId, optionId }),
    go: (step) => {
      const guard = canEnter(step, getSession());
      if (guard.ok) dispatch({ type: 'go', step });
      return guard;
    },
    setTrucks: (trucks) => dispatch({ type: 'setTrucks', trucks }),
    setEvaluation: (hash, pair) =>
      dispatch({
        type: 'setEvaluation',
        hash,
        withTrucks: pair.withTrucks,
        withoutTrucks: pair.withoutTrucks,
      }),
    invalidateEvaluation: () => dispatch({ type: 'invalidateEvaluation' }),
    browseBudget: (budgetId) => dispatch({ type: 'browseBudget', budgetId }),
    restart: () => dispatch({ type: 'restart' }),
    hydrate: (session) => dispatch({ type: 'hydrate', session }),
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * The JSON-able form. The undo history is deliberately NOT persisted: it is a
 * within-visit convenience, and dropping it keeps the blob small and the
 * validation short.
 */
export function serialize(session: Session): unknown {
  return {
    version: SESSION_STATE_VERSION,
    budgetId: session.budgetId,
    placed: session.placed.map((station) => ({ id: station.id, by: station.by })),
    predictions: { ...session.predictions },
    step: session.step,
    visited: [...session.visited],
    trucks: session.trucks,
    layoutHash: session.layoutHash,
    evaluation: session.evaluation,
    compareBudgetId: session.compareBudgetId,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const numberArray = (value: unknown): number[] | null => {
  if (!Array.isArray(value) || !value.every(isFiniteNumber)) return null;
  return value as number[];
};

/** A stored summary is only accepted when its load-bearing numbers are there. */
function readSummary(value: unknown): EvaluationSummary | null {
  if (!isRecord(value)) return null;
  const quality = value.quality;
  if (quality !== 'exact' && quality !== 'estimate') return null;
  if (typeof value.feasible !== 'boolean') return null;
  const numbers = [
    'served',
    'servedRatio',
    'demandTotal',
    'ptShare',
    'docks',
    'bikes',
    'capexEur',
    'nStations',
    'nTransfer',
  ] as const;
  for (const key of numbers) if (!isFiniteNumber(value[key])) return null;
  const series = ['demandByPeriod', 'servedByPeriod', 'bikeOnlyByPeriod', 'bikePtByPeriod'] as const;
  for (const key of series) if (!numberArray(value[key])) return null;
  const losses = value.losses;
  if (!isRecord(losses)) return null;
  for (const key of ['noStation', 'noStock', 'unreachable'] as const) {
    if (!isFiniteNumber(losses[key])) return null;
  }
  return value as unknown as EvaluationSummary;
}

/**
 * Rebuild a session from whatever `SessionStore.load()` returned.
 *
 * Never throws. An unknown version, a missing field, a step or budget this
 * build does not know, a prediction option that no longer exists: all of them
 * return null, and the game starts fresh. Unknown prediction KEYS are dropped
 * rather than failing the whole blob, so removing a poll does not strand a
 * visitor mid-session.
 */
export function deserialize(raw: unknown): Session | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== SESSION_STATE_VERSION) return null;

  const budgetId = raw.budgetId === null ? null : isBudgetId(raw.budgetId) ? raw.budgetId : undefined;
  if (budgetId === undefined) return null;

  if (!Array.isArray(raw.placed)) return null;
  const placed: PlacedStation[] = [];
  const seen = new Set<number>();
  for (const entry of raw.placed) {
    if (!isRecord(entry)) return null;
    const id = entry.id;
    if (!isFiniteNumber(id) || !Number.isInteger(id) || id < 0) return null;
    if (entry.by !== 'me' && entry.by !== 'assistant') return null;
    if (seen.has(id)) continue;
    seen.add(id);
    placed.push({ id, by: entry.by });
  }

  if (!isRecord(raw.predictions)) return null;
  const predictions: Partial<Record<PredictionId, string>> = {};
  for (const [key, value] of Object.entries(raw.predictions)) {
    if (typeof value !== 'string') return null;
    if (!isPredictionId(key)) continue;
    if (!isOptionOf(key, value)) continue;
    predictions[key] = value;
  }

  if (!isGameStep(raw.step)) return null;
  if (!Array.isArray(raw.visited) || !raw.visited.every(isGameStep)) return null;
  if (typeof raw.trucks !== 'boolean') return null;
  if (raw.layoutHash !== null && typeof raw.layoutHash !== 'string') return null;
  if (raw.compareBudgetId !== null && !isBudgetId(raw.compareBudgetId)) return null;

  let evaluation: EvaluationPair | null = null;
  if (raw.evaluation !== null && raw.evaluation !== undefined) {
    if (!isRecord(raw.evaluation)) return null;
    const withTrucks = readSummary(raw.evaluation.withTrucks);
    const withoutTrucks = readSummary(raw.evaluation.withoutTrucks);
    if (!withTrucks || !withoutTrucks) return null;
    evaluation = { withTrucks, withoutTrucks };
  }

  const visited = raw.visited.filter(isGameStep);
  const restored: Session = {
    version: SESSION_STATE_VERSION,
    budgetId,
    placed,
    history: [],
    predictions,
    step: raw.step,
    visited: visited.includes('entry') ? visited : ['entry', ...visited],
    trucks: raw.trucks,
    layoutHash: raw.layoutHash,
    evaluation,
    compareBudgetId: raw.compareBudgetId ?? null,
  };

  // A stored step whose guard no longer holds (the blob was edited, or a guard
  // changed between builds) falls back to the furthest step that does hold.
  if (!canEnter(restored.step, restored).ok) {
    let fallback: GameStep = 'entry';
    for (const step of ALL_STEPS) {
      if (!canEnter(step, restored).ok) break;
      fallback = step;
    }
    return { ...restored, step: fallback };
  }
  return restored;
}
