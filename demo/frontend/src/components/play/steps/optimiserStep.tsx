import type { BudgetReference } from '../../../domain/evaluation/types';
import { optimiserResults } from '../../../domain/game/results';
import {
  BUDGET_EUR,
  BUDGET_IDS,
  BUDGET_SCENARIO,
  type BudgetId,
  type Session,
  type SessionActions,
} from '../../../domain/game/session';
import { fmtEur } from '../../../lib/format';
import type { T } from '../../../lib/i18n';
import type { PlayData } from '../../../lib/playData';
import type { GameData, Lang } from '../../../lib/types';
import StationsLayer from '../../map/layers/StationsLayer';
import {
  bikesPerStation,
  budgetLadder,
  contributionFacts,
  doublePair,
  overlapCount,
  planFacts,
  planOf,
} from '../optimiserFacts';
import type { PlayScene } from '../playScene';
import BuiltBox from '../screens/BuiltBox';
import Optimiser from '../screens/Optimiser';
import type { StepParts } from './runStep';
import { viewOf } from './runStep';

/**
 * Step 5 — Observe, then Decide.
 *
 * The map shows the optimiser's network for the budget being browsed, with the
 * visitor's own stations kept underneath in grey (plan.md §2, "legend toggle
 * Your placed stations"). Both columns of the table come from the same engine
 * (decision 4 of plan-technical §A).
 */
export interface OptimiserStepInput {
  readonly session: Session;
  readonly actions: SessionActions;
  readonly scene: PlayScene;
  readonly data: GameData;
  readonly play: PlayData;
  /** The visitor's own budget reference: the overlap and the marks read on it. */
  readonly reference: BudgetReference | null;
  readonly references: ReadonlyMap<number, BudgetReference>;
  readonly t: T;
  readonly lang: Lang;
}

/** Which budget's optimiser network is on screen: the browsed one, else the visitor's. */
export const browsingOf = (session: Session): BudgetId =>
  session.compareBudgetId ?? session.budgetId ?? BUDGET_IDS[0]!;

export function optimiserStep(input: OptimiserStepInput): StepParts {
  const { session, actions, scene, data, references, t, lang } = input;
  const browsing = browsingOf(session);
  const view = viewOf(session);
  const ladder = budgetLadder(data);

  const browsedReference = references.get(BUDGET_EUR[browsing]) ?? null;
  const plan = planOf(data, BUDGET_SCENARIO[browsing]);
  const facts = plan ? planFacts(plan) : null;
  // The same figure the map badges and step 4's tile print, for the plan browsed here.
  const bikes = bikesPerStation(plan);
  const demandTotal = view?.hero.demand ?? input.play.demandTotal;

  // The step-4 view-model, for the optimiser's network at the browsed budget.
  const results = browsedReference
    ? optimiserResults(browsedReference, session.trucks, facts)
    : null;
  const visitorBudgetEur = session.budgetId ? BUDGET_EUR[session.budgetId] : 0;

  const panel = (
    <Optimiser
      contribution={contributionFacts(data, BUDGET_EUR[browsing])}
      view={results}
      bikes={bikes}
      mine={session.placed.length}
      shared={overlapCount(
        session.placed.map((placed) => placed.id),
        input.reference?.optimiserStations ?? [],
      )}
      trucks={session.trucks}
      budgets={BUDGET_IDS.map((id) => ({
        id,
        eur: BUDGET_EUR[id],
        label: `${t(`play.budget.name.${id}`)} · ${fmtEur(BUDGET_EUR[id])}`,
      }))}
      browsing={browsing}
      onBrowse={actions.browseBudget}
      rungs={ladder}
      browsed={ladder.find((rung) => rung.budgetEur === BUDGET_EUR[browsing]) ?? null}
      visitorServed={view?.hero.served ?? 0}
      visitorBudgetEur={visitorBudgetEur}
      lang={lang}
      t={t}
    />
  );

  return {
    panel,
    map: {
      children: scene.layers.plan && plan ? (
        <StationsLayer
          variant="plan"
          stations={plan.stations}
          show={{ transfer: true, regular: true, capacity: true, inventory: false }}
          period={0}
          dropKey={BUDGET_IDS.indexOf(browsing)}
          t={t}
        />
      ) : null,
      stations:
        scene.layers.ghost && scene.mine.length > 0 ? (
          <StationsLayer variant="ghost" stations={scene.mine.map((s) => ({ x: s.x, y: s.y }))} />
        ) : null,
      overlay:
        results != null ? (
          <BuiltBox facts={results.built} title={t('play.built.optimiser')} t={t} />
        ) : undefined,
    },
  };
}

/** The "double the budget" facts, from the ladder rung whose double exists. */
export function doubleFacts(
  ladder: readonly import('../optimiserFacts').BudgetRung[],
  budgetEur: number,
): { lowBudgetEur: number; highBudgetEur: number; lowServed: number; highServed: number } {
  const pair = doublePair(ladder, budgetEur);
  return {
    lowBudgetEur: pair?.low.budgetEur ?? budgetEur,
    highBudgetEur: pair?.high.budgetEur ?? budgetEur,
    lowServed: pair?.low.served ?? 0,
    highServed: pair?.high.served ?? 0,
  };
}
