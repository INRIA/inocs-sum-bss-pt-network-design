import { useCallback, type ReactNode, type RefObject } from 'react';

import { canEnter, nextStep, stepDef, type GameStep } from '../../domain/game/steps';
import { questionsFor } from '../../domain/game/predictions';
import { BUDGET_EUR, type Session, type SessionActions } from '../../domain/game/session';
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
import { usePlayScene } from './playScene';
import { buildStep } from './steps/buildStep';
import { runStep } from './steps/runStep';
import { optimiserStep } from './steps/optimiserStep';
import { conclusionsStep } from './steps/conclusionsStep';
import Entry from './screens/Entry';
import BudgetScreen from './screens/Budget';
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
      <StationsLayer variant="player" stations={[...scene.mine]} />
    ) : null;

  const view = (
    panel: StepView['panel'],
    primary: StepView['primary'],
    map: Partial<StepView['map']> & { stations?: ReactNode } = {},
  ): StepView => ({
    brief: t(`play.brief.${step}`),
    rhythm: t(stepDef(step).rhythmKey),
    panel,
    primary,
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
    case 'entry':
      return view(<Entry t={t} budgets={play.budgets.length || 4} />, {
        label: t('play.entry.cta'),
        onClick: advance,
        go: true,
      });

    case 'budget':
      return view(
        <BudgetScreen
          data={data}
          budgets={play.budgets}
          selected={session.budgetId}
          hasLayout={session.placed.length > 0}
          onChoose={actions.chooseBudget}
          t={t}
        />,
        {
          label: t('play.budget.cta'),
          onClick: () => go('build'),
          disabled: !session.budgetId,
          note: nextGuard('build'),
          go: true,
        },
      );

    case 'build': {
      const parts = buildStep({ session, actions, play, scene, periodName, t, lang });
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
      );
    }

    case 'predict': {
      const questions = questionsFor('predict');
      const answered = questions.every((question) => Boolean(session.predictions[question.id]));
      const busy = evaluation.status === 'running';
      return view(
        <Predict questions={questions} answers={session.predictions} onAnswer={actions.answer} t={t} />,
        {
          label: t('play.predict.cta'),
          onClick: () => go('run'),
          disabled: !answered,
          note: answered && busy ? t('play.predict.preparing') : nextGuard('run'),
          go: true,
        },
      );
    }

    case 'run': {
      const parts = runStep({ session, actions, evaluation, scene, reference, t, lang });
      return view(parts.panel, {
        label: t('play.run.cta'),
        onClick: advance,
        disabled: !canEnter('optimiser', session).ok,
        note: nextGuard('optimiser'),
        go: true,
      }, parts.map);
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
      const parts = conclusionsStep({
        session,
        actions,
        scene,
        data,
        reference,
        baseUrl: options.baseUrl ?? '/',
        t,
        lang,
      });
      return view(parts.panel, {
        label: t('play.conclusions.cta'),
        onClick: () => {
          actions.restart();
          go('entry');
        },
        go: true,
      }, parts.map);
    }
  }
}
