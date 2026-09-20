/**
 * steps.ts — the route through the game, and the guards between its steps.
 *
 * Six tracker steps (plan.md §2) preceded by one `entry` pseudo-step that the
 * tracker does not show. A step is enterable only when the previous decision
 * really was taken, so a deep link (`#/step/run`) can never drop a visitor in
 * front of results that do not exist: `canEnter` answers with an i18n reason
 * key instead, and `useHashStep` falls back to `furthestAllowed`.
 *
 * Pure domain: no React, no DOM, no fetch, no node imports.
 */
import { questionsFor } from './predictions';
import type { Session } from './session';

/** The six steps the tracker shows, in order. */
export type StepId = 'budget' | 'build' | 'predict' | 'run' | 'optimiser' | 'conclusions';
/** Every screen the router knows, including the untracked entry. */
export type GameStep = 'entry' | StepId;

export const STEPS: readonly StepId[] = [
  'budget',
  'build',
  'predict',
  'run',
  'optimiser',
  'conclusions',
];

export const ALL_STEPS: readonly GameStep[] = ['entry', ...STEPS];

export interface StepDef {
  readonly id: GameStep;
  /** Position among the six tracker steps; `-1` for `entry`. */
  readonly index: number;
  /** Shown on the tracker. */
  readonly labelKey: string;
  /** The rhythm verb of plan.md §2 ("Read → Decide", "Observe", …). */
  readonly rhythmKey: string;
  /** False for `entry`, which the tracker hides. */
  readonly tracked: boolean;
}

const def = (id: GameStep, index: number, tracked: boolean): StepDef => ({
  id,
  index,
  labelKey: `play.step.${id}`,
  rhythmKey: `play.rhythm.${id}`,
  tracked,
});

export const STEP_DEFS: Readonly<Record<GameStep, StepDef>> = {
  entry: def('entry', -1, false),
  budget: def('budget', 0, true),
  build: def('build', 1, true),
  predict: def('predict', 2, true),
  run: def('run', 3, true),
  optimiser: def('optimiser', 4, true),
  conclusions: def('conclusions', 5, true),
};

/** The six tracker descriptors, in order. */
export const TRACKER: readonly StepDef[] = STEPS.map((id) => STEP_DEFS[id]);

export function isGameStep(value: unknown): value is GameStep {
  return typeof value === 'string' && value in STEP_DEFS;
}

export function stepDef(step: GameStep): StepDef {
  return STEP_DEFS[step];
}

/** Why a step is closed. `reasonKey` is an i18n key, never a sentence. */
export type StepGuard = { readonly ok: true } | { readonly ok: false; readonly reasonKey: string };

const OK: StepGuard = { ok: true };
const no = (reasonKey: string): StepGuard => ({ ok: false, reasonKey });

/**
 * May the visitor enter `step` with this session?
 *
 * The guards are cumulative by construction: each one is the previous decision
 * made concrete (a budget, then a station, then the five answers, then an
 * evaluation, then a visit to the optimiser).
 */
export function canEnter(step: GameStep, session: Session): StepGuard {
  switch (step) {
    case 'entry':
    case 'budget':
      return OK;
    case 'build':
      return session.budgetId ? OK : no('play.guard.budget');
    case 'predict':
      if (!session.budgetId) return no('play.guard.budget');
      return session.placed.length > 0 ? OK : no('play.guard.station');
    case 'run': {
      const previous = canEnter('predict', session);
      if (!previous.ok) return previous;
      const asked = questionsFor('predict');
      const answered = asked.every((question) => Boolean(session.predictions[question.id]));
      return answered ? OK : no('play.guard.predictions');
    }
    case 'optimiser': {
      const previous = canEnter('run', session);
      if (!previous.ok) return previous;
      return session.evaluation ? OK : no('play.guard.evaluation');
    }
    case 'conclusions': {
      const previous = canEnter('optimiser', session);
      if (!previous.ok) return previous;
      return session.visited.includes('optimiser') ? OK : no('play.guard.optimiser');
    }
    default:
      return no('play.guard.unknown');
  }
}

export function nextStep(step: GameStep): GameStep | null {
  const at = ALL_STEPS.indexOf(step);
  if (at < 0 || at === ALL_STEPS.length - 1) return null;
  return ALL_STEPS[at + 1];
}

export function prevStep(step: GameStep): GameStep | null {
  const at = ALL_STEPS.indexOf(step);
  return at <= 0 ? null : ALL_STEPS[at - 1];
}

/** The furthest step this session may enter. Where a bad hash lands. */
export function furthestAllowed(session: Session): GameStep {
  let furthest: GameStep = 'entry';
  for (const step of ALL_STEPS) {
    if (!canEnter(step, session).ok) break;
    furthest = step;
  }
  return furthest;
}

/**
 * How far the moving object on the tracker has travelled: a soft display
 * target, never a rule. Screens may pass the budget's own station count as
 * `buildTarget` so the bike advances at the pace of that budget.
 */
export const BUILD_SOFT_TARGET = 20;

export interface Progress {
  readonly step: GameStep;
  /** Index among the six tracker steps; `-1` on the entry screen. */
  readonly index: number;
  readonly count: number;
  /** 0..1 inside the current step. */
  readonly within: number;
  /** 0..1 across the whole route, for the moving bike. */
  readonly overall: number;
}

export function progress(session: Session, opts: { buildTarget?: number } = {}): Progress {
  const index = STEPS.indexOf(session.step as StepId);
  const within = withinStep(session, opts.buildTarget ?? BUILD_SOFT_TARGET);
  const overall = index < 0 ? 0 : Math.min(1, (index + within) / STEPS.length);
  return { step: session.step, index, count: STEPS.length, within, overall };
}

function withinStep(session: Session, buildTarget: number): number {
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  switch (session.step) {
    case 'entry':
      return 0;
    case 'budget':
      return session.budgetId ? 1 : 0;
    case 'build':
      return buildTarget > 0 ? clamp(session.placed.length / buildTarget) : 0;
    case 'predict': {
      const asked = questionsFor('predict');
      if (asked.length === 0) return 1;
      const answered = asked.filter((question) => Boolean(session.predictions[question.id])).length;
      return clamp(answered / asked.length);
    }
    case 'run':
      return session.evaluation ? 1 : 0;
    case 'optimiser': {
      const asked = questionsFor('optimiser');
      if (asked.length === 0) return 1;
      const answered = asked.filter((question) => Boolean(session.predictions[question.id])).length;
      return clamp(answered / asked.length);
    }
    case 'conclusions':
      return 1;
    default:
      return 0;
  }
}
