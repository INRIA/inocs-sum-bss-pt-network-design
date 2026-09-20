import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { canEnter, nextStep, stepDef, type GameStep } from '../../domain/game/steps';
import { questionsFor } from '../../domain/game/predictions';
import { BUDGET_EUR, currentEvaluation, type Session, type SessionActions } from '../../domain/game/session';
import { rowIsReachable } from '../../domain/placement/reach';
import { demandSprites } from '../../domain/trips/sprites';
import { useDayPlayback } from '../../hooks/useDayPlayback';
import { usePlacement } from '../../hooks/usePlacement';
import type { UseEvaluation } from '../../hooks/useEvaluation';
import { makeProjection } from '../../lib/geo';
import type { PlayData } from '../../lib/playData';
import type { BudgetReference } from '../../domain/evaluation/types';
import type { T } from '../../lib/i18n';
import type { GameData, Lang } from '../../lib/types';
import type { MapControls } from '../map/frame/MapFrame';
import BaseLayer from '../map/layers/BaseLayer';
import PtLinesLayer from '../map/layers/PtLinesLayer';
import PtDemandLayer from '../map/layers/PtDemandLayer';
import CandidatesLayer from '../map/layers/CandidatesLayer';
import StationsLayer from '../map/layers/StationsLayer';
import TripsLayer, { type TripSprite } from '../map/layers/TripsLayer';
import { BikeLegend, DEFAULT_PLAY_LAYERS, PtLegend, type PlayLayerKey, type PlayLayers } from './playLayers';
import Entry from './screens/Entry';
import BudgetScreen from './screens/Budget';
import Build from './screens/Build';
import Predict from './screens/Predict';
import Placeholder from './screens/Placeholder';
import type { StepView } from './stepView';

/** How many potential-demand sprites the city pulse draws at once. */
const PULSE_CAP = 220;
/** A tap resolves to a candidate within 22 screen px (plan-technical §B.3). */
const TAP_RADIUS_PX = 22;

export interface StepContentOptions {
  session: Session;
  actions: SessionActions;
  play: PlayData;
  data: GameData;
  evaluation: UseEvaluation;
  /** `references.json`, keyed by capex: the same-engine optimiser column. */
  references: ReadonlyMap<number, BudgetReference>;
  controls: RefObject<MapControls | null>;
  unitPx: number;
  t: T;
  lang: Lang;
}

/**
 * The one place that turns "which step are we on" into content.
 *
 * The parent chooses what the map draws (plan-technical §C.3), so this hook
 * assembles both halves of a step — the panel and the map's layers and slots —
 * and hands them to `StepShell`, which owns the layout and mounts the map once.
 * Every hook below runs on EVERY step, never conditionally: the playback timer
 * and the placement logic are cheap, and React's rules leave no alternative.
 */
export function useStepContent(options: StepContentOptions): StepView {
  const { session, actions, play, data, evaluation, references, controls, unitPx, t, lang } = options;
  const step = session.step;

  const [layers, setLayers] = useState<PlayLayers>(DEFAULT_PLAY_LAYERS);
  const toggleLayer = useCallback(
    (key: PlayLayerKey) => setLayers((current) => ({ ...current, [key]: !current[key] })),
    [],
  );

  const playback = useDayPlayback({ loop: true, initialHour: 8, stepMs: 520 });

  // The city pulse is on by default on Build (plan-technical §A.2) and stays
  // pausable. It starts once per visit, and not at all when the visitor asked
  // for reduced motion — the sprites themselves fall back to static lines in
  // trips.css, so a clock ticking under them would be the only thing moving.
  const pulseStarted = useRef(false);
  const togglePlayback = playback.togglePlay;
  useEffect(() => {
    if (step !== 'build' || pulseStarted.current) return;
    pulseStarted.current = true;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    togglePlayback();
  }, [step, togglePlayback]);

  const hitCandidates = useMemo(
    () => play.candidates.map((candidate) => ({ id: candidate.index, x: candidate.x, y: candidate.y })),
    [play.candidates],
  );

  const placement = usePlacement({
    session,
    actions,
    candidates: hitCandidates,
    toMapRadius: TAP_RADIUS_PX / Math.max(0.2, unitPx),
    reach: play.coverage?.reach,
    demandTotal: play.demandTotal,
    periods: play.periods,
    constants: play.constants ?? undefined,
  });

  // An ambiguous tap zooms in ON the tap and places nothing (§B.3): the second
  // tap is then unambiguous. The camera lives in the frame, so this goes
  // through the controls handle rather than through a prop.
  const onTap = useCallback(
    (point: { x: number; y: number }) => {
      if (placement.onTap(point) === 'ambiguous') {
        controls.current?.zoomAt(point.x, point.y, 1.8);
      }
    },
    [placement, controls],
  );

  const placedIds = useMemo(() => new Set(session.placed.map((s) => s.id)), [session.placed]);
  const project = useMemo(() => makeProjection(play.bounds), [play.bounds]);

  /** Which demand rows the current layout puts within reach — the pulse's colour. */
  const reachedKeys = useMemo(() => {
    const rows = play.coverage?.reach ?? [];
    const keys = new Set<string>();
    if (placedIds.size === 0) return keys;
    for (const row of rows) {
      if (rowIsReachable(row, placedIds)) keys.add(`${row.o}:${row.d}:${row.t}`);
    }
    return keys;
  }, [play.coverage, placedIds]);

  // The sample is deterministic and independent of the statuses, so the sprite
  // LIST is identical from one layout to the next: only the class changes, and
  // the CSS animations keep running instead of restarting (plan-technical §A.2).
  const pulse = useMemo<TripSprite[]>(() => {
    if (!play.coverage || play.demand.length === 0) return [];
    const sprites = demandSprites(
      play.demand,
      play.cells,
      play.candidates.map((c) => ({ id: c.id, type: c.transfer ? 'TransferStation' : 'BikeStation', lon: c.lon, lat: c.lat })),
      project,
      (o, d, period) => reachedKeys.has(`${o}:${d}:${period}`),
      { cap: PULSE_CAP, periods: play.periods, seed: 20260920 },
    );
    return sprites.map((sprite, index) => ({
      id: `pulse-${index}`,
      from: [sprite.from[0], sprite.from[1]],
      to: [sprite.to[0], sprite.to[1]],
      delayMs: sprite.delayMs,
      durationMs: sprite.durationMs,
      status: sprite.status === 'reached' ? 'reached' : 'potential',
    }));
  }, [play, project, reachedKeys]);

  const mine = useMemo(
    () =>
      session.placed.map((placed) => {
        const candidate = play.candidates[placed.id];
        return {
          x: candidate?.x ?? 0,
          y: candidate?.y ?? 0,
          transfer: candidate?.transfer ?? false,
          assisted: placed.by === 'assistant',
        };
      }),
    [session.placed, play.candidates],
  );

  const free = useMemo(
    () =>
      play.candidates
        .filter((candidate) => !placedIds.has(candidate.index))
        .map((candidate) => ({ id: candidate.id, x: candidate.x, y: candidate.y, transfer: candidate.transfer })),
    [play.candidates, placedIds],
  );

  const periodIndex = periodOfHour(playback.hour, data.city.periodBounds);
  const periodName = t(`s5.per.${periodIndex}`);

  const go = useCallback((target: GameStep) => actions.go(target), [actions]);
  const advance = useCallback(() => {
    const target = nextStep(step);
    if (target) actions.go(target);
  }, [actions, step]);

  const base = (
    <>
      <BaseLayer map={data.map} gridOpacity={0.5} />
      <PtLinesLayer lines={data.map.ptLines} visible={layers} opacity={step === 'build' ? 0.72 : 1} t={t} />
      {layers.stops && (
        <PtDemandLayer
          stops={data.map.stops}
          weekday="mon"
          hour={playback.hour}
          scale={step === 'build' ? 0.85 : 1}
          opacity={step === 'build' ? 0.55 : 0.8}
        />
      )}
    </>
  );

  const top = <PtLegend map={data.map} layers={layers} onToggle={toggleLayer} t={t} />;
  const bottom = (
    <BikeLegend layers={layers} onToggle={toggleLayer} showCandidates={step === 'build'} t={t} />
  );

  const stations = layers.mine && mine.length > 0 ? <StationsLayer variant="player" stations={mine} /> : null;

  const view = (
    panel: StepView['panel'],
    primary: StepView['primary'],
    map: Partial<StepView['map']> = {},
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
          {stations}
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
      return view(
        <Entry t={t} budgets={play.budgets.length || 4} />,
        { label: t('play.entry.cta'), onClick: advance, go: true },
      );

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

    case 'build':
      return view(
        <Build
          meter={placement.budgetMeter}
          constants={play.constants!}
          reach={placement.reach}
          demandTotal={play.demandTotal}
          byMe={session.placed.filter((s) => s.by === 'me').length}
          byAssistant={session.placed.filter((s) => s.by === 'assistant').length}
          canUndo={session.history.length > 0}
          roomLeft={placement.budgetMeter.roomLeft}
          lastTap={placement.lastTap}
          playing={playback.playing}
          periodName={periodName}
          onAssist={actions.assist}
          onUndo={actions.undo}
          onClear={actions.clearLayout}
          onTogglePlay={playback.togglePlay}
          t={t}
          lang={lang}
        />,
        {
          label: t('play.build.cta'),
          onClick: () => go('predict'),
          disabled: session.placed.length === 0,
          note: nextGuard('predict'),
          go: true,
        },
        {
          children: (
            <>
              {layers.pulse && <TripsLayer sprites={pulse} loop radius={1.05} />}
              {layers.candidates && (
                <CandidatesLayer
                  candidates={free}
                  onToggle={(id) => {
                    const candidate = play.candidates.find((entry) => entry.id === id);
                    if (candidate) actions.toggleStation(candidate.index);
                  }}
                  label={(candidate) => t('play.build.candidate', { id: candidate.id })}
                />
              )}
            </>
          ),
          onTap,
          doubleTapZoom: false,
        },
      );

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

    default: {
      const target = nextStep(step);
      return view(
        <Placeholder
          step={step}
          status={evaluation.status}
          evaluation={currentEvaluation(session)}
          reference={
            session.budgetId ? (references.get(BUDGET_EUR[session.budgetId]) ?? null) : null
          }
          t={t}
          lang={lang}
        />,
        target
          ? {
              label: t(`play.${step}.cta`),
              onClick: advance,
              disabled: !canEnter(target, session).ok,
              note: nextGuard(target),
              go: true,
            }
          : { label: t('play.conclusions.cta'), onClick: () => go('entry'), go: true },
      );
    }
  }
}

/** Which model period an hour of the day falls in, from the observed bounds. */
export function periodOfHour(hour: number, bounds: readonly number[][]): number {
  for (let i = 0; i < bounds.length; i += 1) {
    const span = bounds[i];
    if (span && hour >= span[0]! && hour < span[1]!) return i;
  }
  return hour < (bounds[0]?.[0] ?? 6) ? 0 : Math.max(0, bounds.length - 1);
}
