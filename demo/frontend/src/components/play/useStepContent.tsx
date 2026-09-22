import { useCallback, type ReactNode, type RefObject } from 'react';

import { canEnter, nextStep, stepDef, type GameStep } from '../../domain/game/steps';
import { questionsFor } from '../../domain/game/predictions';
import { BUDGET_EUR, BUDGET_SCENARIO, type Session, type SessionActions } from '../../domain/game/session';
import type { UseEvaluation } from '../../hooks/useEvaluation';
import type { PlayData } from '../../lib/playData';
import type { BudgetReference, GameData as EngineData } from '../../domain/evaluation/types';
import type { T } from '../../lib/i18n';
import type { GameData, Lang } from '../../lib/types';
import type { MapControls } from '../map/frame/MapFrame';
import BaseLayer from '../map/layers/BaseLayer';
import PtLinesLayer from '../map/layers/PtLinesLayer';
import PtDemandLayer from '../map/layers/PtDemandLayer';
import StationsLayer from '../map/layers/StationsLayer';
import { BikeLegend, PtLegend, type BikeLegendMode } from './playLayers';
import { bikesPerStation, planOf } from './optimiserFacts';
import { usePlayScene } from './playScene';
import { buildStep } from './steps/buildStep';
import { runStep } from './steps/runStep';
import { optimiserStep } from './steps/optimiserStep';
import { conclusionsStep } from './steps/conclusionsStep';
import Predict from './screens/Predict';
import type { StepView } from './stepView';

export interface StepContentOptions {
  session: Session;
  actions: SessionActions;
  play: PlayData;
  data: GameData;
  evaluation: UseEvaluation;
  /** The solver payload, fetched at runtime: the run animation needs its paths. */
  engine?: EngineData | null;
  /** `references.json`, keyed by capex: the same-engine optimiser column. */
  references: ReadonlyMap<number, BudgetReference>;
  controls: RefObject<MapControls | null>;
  unitPx: number;
  t: T;
  lang: Lang;
  /** Where the full demo lives, for the closing call to action. */
  baseUrl?: string;
  /** Phone or tablet portrait: the panels that pin controls in the peek area. */
  compact?: boolean;
}

/**
 * The one place that turns "which step are we on" into content.
 *
 * The parent chooses what the map draws (plan-technical §C.3), so this hook
 * assembles both halves of a step — the panel and the map's layers and slots —
 * and hands them to `StepShell`, which owns the layout and mounts the map once.
 * The hooks themselves live in `playScene.ts`, which runs them all on every
 * step; the three heavier steps build their own halves in `steps/`, so this
 * file stays the route and nothing more.
 */
export function useStepContent(options: StepContentOptions): StepView {
  const { session, actions, play, data, evaluation, references, controls, unitPx, t, lang } = options;
  const step = session.step;

  const scene = usePlayScene({
    session,
    actions,
    play,
    evaluation,
    engine: options.engine ?? null,
    controls,
    unitPx,
    periodBounds: data.city.periodBounds,
  });
  const { layers, toggleLayer } = scene;

  const go = useCallback((target: GameStep) => actions.go(target), [actions]);
  const advance = useCallback(() => {
    const target = nextStep(step);
    if (target) actions.go(target);
  }, [actions, step]);

  const periodName = t(`s5.per.${scene.periodIndex}`);
  const reference: BudgetReference | null = session.budgetId
    ? (references.get(BUDGET_EUR[session.budgetId]) ?? null)
    : null;

  // The model's own bikes per station at the chosen budget, computed once off
  // the committed run: the answer to the step-2 poll, the step-3 tile and the
  // badge every placed station carries from the run on. It is deliberately NOT
  // shown while the visitor places and predicts, which would give the poll away.
  const bikes = session.budgetId
    ? bikesPerStation(planOf(data, BUDGET_SCENARIO[session.budgetId]))
    : null;
  const badgeBikes = step === 'build' || step === 'predict' ? null : (bikes?.mean ?? null);

  const base = (
    <>
      <BaseLayer map={data.map} gridOpacity={0.5} />
      <PtLinesLayer lines={data.map.ptLines} visible={layers} opacity={step === 'build' ? 0.72 : 1} t={t} />
      {layers.stops && (
        <PtDemandLayer
          stops={data.map.stops}
          weekday="mon"
          hour={scene.hour}
          scale={step === 'build' ? 0.85 : 1}
          opacity={step === 'build' ? 0.55 : 0.8}
        />
      )}
    </>
  );

  const top = <PtLegend map={data.map} layers={layers} onToggle={toggleLayer} t={t} />;
  const legendMode: BikeLegendMode =
    step === 'build' ? 'build' : step === 'optimiser' ? 'optimiser' : 'run';
  const bottom = <BikeLegend layers={layers} onToggle={toggleLayer} mode={legendMode} t={t} />;

  const playerStations =
    layers.mine && scene.mine.length > 0 ? (
      <StationsLayer variant="player" stations={[...scene.mine]} bikes={badgeBikes} />
    ) : null;

  const view = (
    panel: StepView['panel'],
    primary: StepView['primary'],
    map: Partial<StepView['map']> & { stations?: ReactNode } = {},
    extra: Pick<StepView, 'snap' | 'onSpace'> = {},
  ): StepView => ({
    brief: t(`play.brief.${step}`),
    rhythm: t(stepDef(step).rhythmKey),
    panel,
    primary,
    snap: extra.snap,
    onSpace: extra.onSpace,
    map: {
      children: (
        <>
          {base}
          {map.children}
          {map.stations === undefined ? playerStations : map.stations}
        </>
      ),
      top,
      bottom: map.bottom ?? bottom,
      // Under 980 px the two legend bars are hidden and the "Layers" chip is
      // the only way to reach them, so the same items go in its popover —
      // otherwise a phone can see the layers but never switch one off.
      popover: (
        <>
          {top}
          {map.bottom ?? bottom}
        </>
      ),
      overlay: map.overlay,
      onTap: map.onTap,
      doubleTapZoom: map.doubleTapZoom,
    },
  });

  const nextGuard = (target: GameStep): string | undefined => {
    const guard = canEnter(target, session);
    return guard.ok ? undefined : t(guard.reasonKey);
  };

  switch (step) {
    case 'build': {
      const parts = buildStep({
        session,
        actions,
        play,
        data,
        scene,
        periodName,
        compact: options.compact ?? false,
        t,
        lang,
      });
      return view(
        parts.panel,
        {
          label: t('play.build.cta'),
          onClick: () => go('predict'),
          disabled: session.placed.length === 0,
          note: nextGuard('predict'),
          go: true,
        },
        parts.map,
        // No budget yet means the cards are the task: the sheet opens on them,
        // then drops to its usual peek once one is chosen and the map is next.
        { snap: session.budgetId ? 'peek' : 'full', onSpace: scene.togglePlay },
      );
    }

    case 'predict': {
      const questions = questionsFor('predict');
      const busy = evaluation.status === 'running';
      return view(
        <Predict
          questions={questions}
          answers={session.predictions}
          onAnswer={actions.answer}
          onClear={actions.clearAnswer}
          t={t}
        />,
        {
          label: t('play.predict.cta'),
          onClick: () => go('run'),
          note: busy ? t('play.predict.preparing') : nextGuard('run'),
          go: true,
        },
      );
    }

    case 'run': {
      const parts = runStep({ session, actions, evaluation, scene, reference, bikes, t, lang });
      // §B.2: the sheet peeks while the day plays, then rises by itself so the
      // results are read without a drag. Under reduced motion nothing animates,
      // so `playing` is never true and the rise is immediate; coming back to a
      // step that already has results skips the peek too.
      const hasResults = Boolean(session.evaluation);
      return view(
        parts.panel,
        {
          label: t('play.run.cta'),
          onClick: advance,
          disabled: !canEnter('optimiser', session).ok,
          note: nextGuard('optimiser'),
          go: true,
        },
        parts.map,
        { snap: hasResults && !scene.run.playing ? 'full' : 'peek', onSpace: scene.run.replay },
      );
    }

    case 'optimiser': {
      const parts = optimiserStep({
        session,
        actions,
        scene,
        data,
        play,
        reference,
        references,
        t,
        lang,
      });
      return view(parts.panel, {
        label: t('play.optimiser.cta'),
        onClick: advance,
        disabled: !canEnter('conclusions', session).ok,
        note: nextGuard('conclusions'),
        go: true,
      }, parts.map);
    }

    case 'conclusions':
    default: {
      const base = options.baseUrl ?? '/';
      const parts = conclusionsStep({
        session,
        actions,
        scene,
        data,
        reference,
        t,
        lang,
      });
      // The ONE primary action of the last step is the way on, into the full
      // demo at the plan the visitor played. "Play again" stays in the card as
      // the secondary, ghost action.
      const planLink = session.budgetId
        ? `${base}?step=4&plan=${encodeURIComponent(BUDGET_SCENARIO[session.budgetId])}`
        : base;
      return view(
        parts.panel,
        {
          label: t('play.conclusions.explore'),
          href: planLink,
          onClick: () => {
            window.location.href = planLink;
          },
          go: true,
        },
        parts.map,
      );
    }
  }
}
