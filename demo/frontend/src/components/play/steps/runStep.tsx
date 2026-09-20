import type { ReactNode } from 'react';

import type { BudgetReference } from '../../../domain/evaluation/types';
import { resultsView, type ResultsView } from '../../../domain/game/results';
import { marksFor } from '../../../domain/game/ticket';
import { BUDGET_EUR, type Session, type SessionActions } from '../../../domain/game/session';
import type { UseEvaluation } from '../../../hooks/useEvaluation';
import type { T } from '../../../lib/i18n';
import type { Lang } from '../../../lib/types';
import TripsLayer from '../../map/layers/TripsLayer';
import type { PlayScene } from '../playScene';
import BuiltBox from '../screens/BuiltBox';
import Run from '../screens/Run';
import type { StepMap } from '../stepView';

/**
 * Step 4 — Observe: the five-second city run, then the visitor's own results.
 *
 * Both halves of the step are assembled here so `useStepContent` stays the
 * route: the map gets the run animation and the closable "what you built" box
 * (results never shrink the map, plan-technical §B.4), the panel gets the
 * view-model the domain computes.
 */
export interface StepParts {
  readonly panel: ReactNode;
  readonly map: Partial<StepMap> & { stations?: ReactNode };
}

export interface RunStepInput {
  readonly session: Session;
  readonly actions: SessionActions;
  readonly evaluation: UseEvaluation;
  readonly scene: PlayScene;
  readonly reference: BudgetReference | null;
  readonly t: T;
  readonly lang: Lang;
}

/** The results view-model of the solve the trucks switch selects. Null before a solve. */
export function viewOf(session: Session): ResultsView | null {
  const pair = session.evaluation;
  if (!pair || !session.budgetId) return null;
  return resultsView({
    evaluation: session.trucks ? pair.withTrucks : pair.withoutTrucks,
    withTrucks: pair.withTrucks,
    withoutTrucks: pair.withoutTrucks,
    budgetEur: BUDGET_EUR[session.budgetId],
  });
}

export function runStep(input: RunStepInput): StepParts {
  const { session, actions, evaluation, scene, reference, t, lang } = input;
  const view = viewOf(session);
  const marks =
    reference && view ? marksFor(reference, view.hero.served, view.hero.demand, session.trucks) : null;

  // Under reduced motion the day is stepped by hand, one period per frame.
  const sprites = scene.run.reduced
    ? scene.run.sprites.filter((sprite) => sprite.period === scene.run.period)
    : scene.run.sprites;

  const panel = (
    <Run
      status={evaluation.status}
      view={view}
      marks={marks}
      answers={session.predictions}
      trucks={session.trucks}
      onTrucks={actions.setTrucks}
      onReplay={scene.run.replay}
      periodName={scene.run.playing ? t(`s5.per.${scene.periodIndex}`) : null}
      reduced={scene.run.reduced}
      period={scene.run.period}
      onPeriod={scene.run.setPeriod}
      periods={Math.max(1, view ? view.periods.length : 3)}
      nothingToRebalance={Boolean(view && view.trucks.dependOnTrucks < 1)}
      onRetry={evaluation.evaluate}
      lang={lang}
      t={t}
    />
  );

  return {
    panel,
    map: {
      children: scene.layers.pulse ? (
        <TripsLayer key={scene.run.replayKey} sprites={[...sprites]} radius={1.05} routes />
      ) : null,
      overlay: view ? <BuiltBox facts={view.built} title={t('play.built.mine')} t={t} /> : undefined,
    },
  };
}
