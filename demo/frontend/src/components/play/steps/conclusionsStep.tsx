import type { BudgetReference } from '../../../domain/evaluation/types';
import type { RhythmFacts } from '../../../domain/game/predictions';
import { optimiserView, type PeriodRow } from '../../../domain/game/results';
import { BUDGET_EUR, BUDGET_SCENARIO, type Session, type SessionActions } from '../../../domain/game/session';
import { buildTicket } from '../../../domain/game/ticket';
import StationsLayer from '../../map/layers/StationsLayer';
import type { T } from '../../../lib/i18n';
import type { GameData, Lang, ScenarioData } from '../../../lib/types';
import { budgetLadder, planFacts, planOf } from '../optimiserFacts';
import type { PlayScene } from '../playScene';
import Conclusions from '../screens/Conclusions';
import { browsingOf, doubleFacts } from './optimiserStep';
import type { StepParts } from './runStep';
import { viewOf } from './runStep';

/**
 * Step 6 — Reflect.
 *
 * Everything the ticket replays is gathered here: the six resolutions (the
 * domain resolves them, `resolveAll` through `buildTicket`), the optimiser's
 * per-period rates for the rush proof, and the sharp-peak run's morning — the
 * one figure of plan.md §4 the full demo has no card for.
 *
 * The rhythm question is resolved across SCENARIOS, never on the visitor's
 * layout: the busy-weekday plan against the reference plan at the same budget.
 */
export interface ConclusionsStepInput {
  readonly session: Session;
  readonly actions: SessionActions;
  readonly scene: PlayScene;
  readonly data: GameData;
  readonly reference: BudgetReference | null;
  readonly t: T;
  readonly lang: Lang;
}

/**
 * The two rhythms the question really compares (owner's decision).
 *
 * "Weekday, busy day" is the `rhythm_sharp` run; "a slower, week-end-like
 * rhythm" is `rhythm_uniform`, the same day's trips spread evenly — NOT the
 * budget ladder's reference plan, which differs by demand profile and budget
 * at once and would answer a different question. Both station lists are read
 * off the committed runs, so a re-run that moved stations flips the answer;
 * nothing here is a literal. The caveat the copy carries stays true: no run in
 * the study contains week-end demand.
 */
export const RHYTHM_SHARP = 'rhythm_sharp';
export const RHYTHM_SLOW = 'rhythm_uniform';

export function rhythmFacts(data: GameData): RhythmFacts {
  const ids = (sc: ScenarioData | null | undefined): string[] =>
    sc ? sc.stations.map((station) => station.id) : [];
  const run = (id: string): ScenarioData | null =>
    data.scenarios.find((sc) => sc.id === id && sc.hasResults) ?? null;
  return { sharpStations: ids(run(RHYTHM_SHARP)), referenceStations: ids(run(RHYTHM_SLOW)) };
}

/** The morning served rate of the sharp-peak run: the rush proof's third figure. */
export function sharpMorning(data: GameData): number | null {
  const sharp = data.scenarios.find((sc) => sc.id === 'rhythm_sharp')?.paper ?? null;
  if (!sharp) return null;
  const demand = sharp.demandByPeriod[0] ?? 0;
  return demand > 0 ? (sharp.servedByPeriod[0] ?? 0) / demand : null;
}

export function conclusionsStep(input: ConclusionsStepInput): StepParts {
  const { session, actions, scene, data, reference, t, lang } = input;
  // Everything replayed here is read on ONE evaluation: the network operated
  // WITH service trucks. The ticket's marks used to follow the step-4 switch
  // while the random planner's mark never did, so a visitor who had turned the
  // trucks off was comparing two different operations on one line. The screen
  // says so in a line of its own (`play.marks.trucks`).
  const pinned: Session = { ...session, trucks: true };
  const view = viewOf(pinned);
  const budgetEur = session.budgetId ? BUDGET_EUR[session.budgetId] : 0;
  const plan = session.budgetId ? planOf(data, BUDGET_SCENARIO[session.budgetId]) : null;
  const facts = plan ? planFacts(plan) : null;
  const ladder = budgetLadder(data);

  const optimiser =
    reference && view
      ? optimiserView({ reference, trucks: true, demandTotal: view.hero.demand, plan: facts })
      : null;

  const ticket =
    reference && session.evaluation
      ? buildTicket(pinned, {
          reference,
          resolution: {
            withTrucks: session.evaluation.withTrucks,
            withoutTrucks: session.evaluation.withoutTrucks,
            trucks: true,
            optimiserDispatches: facts?.dispatches ?? 0,
            rhythm: rhythmFacts(data),
            double: doubleFacts(ladder, budgetEur),
          },
        })
      : null;

  const periods: readonly PeriodRow[] = view ? view.periods : [];
  const panel = ticket ? (
    <Conclusions
      ticket={ticket}
      data={data}
      periods={periods}
      optimiserPeriods={optimiser?.periods ?? null}
      sharpMorning={sharpMorning(data)}
      onRestart={actions.restart}
      lang={lang}
      t={t}
    />
  ) : (
    <p className="note">{t('play.guard.evaluation')}</p>
  );

  const browsing = browsingOf(session);
  const optimiserPlan = planOf(data, BUDGET_SCENARIO[browsing]);
  return {
    panel,
    map: {
      children:
        scene.layers.plan && optimiserPlan ? (
          <StationsLayer
            variant="plan"
            stations={optimiserPlan.stations}
            show={{ transfer: true, regular: true, capacity: false, inventory: false }}
            period={0}
            dropKey={0}
            t={t}
          />
        ) : null,
      stations:
        scene.layers.ghost && scene.mine.length > 0 ? (
          <StationsLayer variant="ghost" stations={scene.mine.map((s) => ({ x: s.x, y: s.y }))} />
        ) : null,
    },
  };
}
