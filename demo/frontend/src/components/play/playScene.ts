/**
 * playScene.ts — every hook the game's map and panels need, in one place.
 *
 * `useStepContent` decides WHAT a step shows; this decides what is available
 * to show. The split exists because React's rules make hooks unconditional:
 * the placement logic, the day clock, the city pulse and the run animation all
 * have to run on every step anyway, so they live here and the switch upstairs
 * stays readable (plan-technical §C.2: hooks wire domain and infra to React,
 * components compose).
 *
 * Nothing here renders. It returns data, callbacks and flags.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GameData as EngineData } from '../../domain/evaluation/types';
import type { Session, SessionActions } from '../../domain/game/session';
import type { GameStep } from '../../domain/game/steps';
import { rowIsReachable } from '../../domain/placement/reach';
import { demandSprites, type Project } from '../../domain/trips/sprites';
import { useDayPlayback } from '../../hooks/useDayPlayback';
import type { UseEvaluation } from '../../hooks/useEvaluation';
import { usePlacement, type UsePlacement } from '../../hooks/usePlacement';
import { makeProjection } from '../../lib/geo';
import type { PlayData } from '../../lib/playData';
import type { MapControls } from '../map/frame/MapFrame';
import type { TripSprite } from '../map/layers/TripsLayer';
import { runDurationMs, runSprites, type RunSprite } from './runSprites';
import { DEFAULT_PLAY_LAYERS, type PlayLayerKey, type PlayLayers } from './playLayers';

/** How many potential-demand sprites the city pulse draws at once. */
const PULSE_CAP = 220;
/** A tap resolves to a candidate within 22 screen px (plan-technical §B.3). */
const TAP_RADIUS_PX = 22;
/** The bottom sheet takes 250 ms to rise on a phone: the run waits for it. */
const SHEET_SETTLE_MS = 320;

export interface PlayerStationPoint {
  x: number;
  y: number;
  transfer: boolean;
  assisted: boolean;
}

export interface FreeCandidate {
  id: string;
  x: number;
  y: number;
  transfer: boolean;
}

export interface RunScene {
  readonly sprites: readonly RunSprite[];
  /** Restart the animation: `TripsLayer` is re-keyed, so the CSS replays. */
  replay(): void;
  readonly replayKey: number;
  readonly playing: boolean;
  /** The visitor asked for reduced motion: a three-frame stepper, no animation. */
  readonly reduced: boolean;
  readonly period: number;
  setPeriod(period: number): void;
}

export interface PlayScene {
  readonly layers: PlayLayers;
  toggleLayer(key: PlayLayerKey): void;
  readonly playing: boolean;
  togglePlay(): void;
  /** The day clock the city pulse and the PT demand layer follow. */
  readonly hour: number;
  readonly periodIndex: number;
  readonly placement: UsePlacement;
  onTap(point: { x: number; y: number }): void;
  readonly placedIds: ReadonlySet<number>;
  readonly mine: readonly PlayerStationPoint[];
  readonly free: readonly FreeCandidate[];
  readonly pulse: readonly TripSprite[];
  readonly run: RunScene;
}

export interface PlaySceneOptions {
  readonly session: Session;
  readonly actions: SessionActions;
  readonly play: PlayData;
  readonly evaluation: UseEvaluation;
  /** The full payload, fetched at runtime; null until it lands. */
  readonly engine: EngineData | null;
  readonly controls: React.RefObject<MapControls | null>;
  readonly unitPx: number;
  readonly periodBounds: readonly number[][];
}

export function usePlayScene(options: PlaySceneOptions): PlayScene {
  const { session, actions, play, evaluation, engine, controls, unitPx } = options;
  const step: GameStep = session.step;

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
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    if (step !== 'build' || pulseStarted.current) return;
    pulseStarted.current = true;
    if (!reduced) togglePlayback();
  }, [step, togglePlayback, reduced]);

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
      play.candidates.map((c) => ({
        id: c.id,
        type: c.transfer ? 'TransferStation' : 'BikeStation',
        lon: c.lon,
        lat: c.lat,
      })),
      project,
      (o, d, period) => reachedKeys.has(`${o}:${d}:${period}`),
      { cap: PULSE_CAP, periods: play.periods, seed: 20260920 },
    );
    return sprites.map((sprite, index) => ({
      id: `pulse-${index}`,
      from: [sprite.from[0], sprite.from[1]] as [number, number],
      to: [sprite.to[0], sprite.to[1]] as [number, number],
      delayMs: sprite.delayMs,
      durationMs: sprite.durationMs,
      status: sprite.status === 'reached' ? ('reached' as const) : ('potential' as const),
    }));
  }, [play, project, reachedKeys]);

  const mine = useMemo<PlayerStationPoint[]>(
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

  const free = useMemo<FreeCandidate[]>(
    () =>
      play.candidates
        .filter((candidate) => !placedIds.has(candidate.index))
        .map((candidate) => ({
          id: candidate.id,
          x: candidate.x,
          y: candidate.y,
          transfer: candidate.transfer,
        })),
    [play.candidates, placedIds],
  );

  const run = useRunScene({
    step,
    evaluation,
    engine,
    project,
    periods: play.periods,
    layout: useMemo(() => [...placedIds], [placedIds]),
    reduced,
  });

  return {
    layers,
    toggleLayer,
    playing: playback.playing,
    togglePlay: playback.togglePlay,
    hour: playback.hour,
    periodIndex: periodOfHour(playback.hour, options.periodBounds),
    placement,
    onTap,
    placedIds,
    mine,
    free,
    pulse,
    run,
  };
}

/**
 * The run animation of step 4.
 *
 * It plays ONCE on arrival — the day is not a loop — and the "Replay" control
 * re-keys the layer so the CSS animations start again. Under reduced motion
 * nothing moves: the sprites become static lines (trips.css) and the visitor
 * steps through the three periods by hand.
 */
function useRunScene(input: {
  step: GameStep;
  evaluation: UseEvaluation;
  engine: EngineData | null;
  project: Project;
  periods: number;
  layout: readonly number[];
  reduced: boolean;
}): RunScene {
  const [replayKey, setReplayKey] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [period, setPeriod] = useState(0);
  const current = input.evaluation.current;

  const sprites = useMemo(
    () =>
      runSprites({
        evaluation: current,
        engine: input.engine,
        project: input.project,
        periods: input.periods,
        layout: input.layout,
      }),
    [current, input.engine, input.project, input.periods, input.layout],
  );

  const start = useCallback(() => {
    setReplayKey((key) => key + 1);
    setPlaying(true);
  }, []);

  // Arriving on the step with a result ready starts the day by itself; a result
  // that lands later starts it then. Either way it happens once per solve, and
  // never before the phone's bottom sheet has finished moving (250 ms), or the
  // first second of the run would play behind a sliding panel.
  const armed = useRef<string>('');
  useEffect(() => {
    if (input.step !== 'run' || !current) return undefined;
    const token = `${current.served}:${current.docks}:${sprites.length}`;
    if (armed.current === token) return undefined;
    armed.current = token;
    if (input.reduced) return undefined;
    const timer = setTimeout(start, SHEET_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [input.step, current, sprites.length, input.reduced, start]);

  useEffect(() => {
    if (!playing) return undefined;
    const timer = setTimeout(() => setPlaying(false), runDurationMs(input.periods));
    return () => clearTimeout(timer);
  }, [playing, replayKey, input.periods]);

  return { sprites, replay: start, replayKey, playing, reduced: input.reduced, period, setPeriod };
}

/** `prefers-reduced-motion`, read after mount so the server render never guesses. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    setReduced(query.matches);
    const listener = (event: MediaQueryListEvent): void => setReduced(event.matches);
    query.addEventListener?.('change', listener);
    return () => query.removeEventListener?.('change', listener);
  }, []);
  return reduced;
}

/** Which model period an hour of the day falls in, from the observed bounds. */
export function periodOfHour(hour: number, bounds: readonly number[][]): number {
  for (let i = 0; i < bounds.length; i += 1) {
    const span = bounds[i];
    if (span && hour >= span[0]! && hour < span[1]!) return i;
  }
  return hour < (bounds[0]?.[0] ?? 6) ? 0 : Math.max(0, bounds.length - 1);
}
