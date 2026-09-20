/**
 * runSprites.ts — the five-second city run of step 4, as drawable sprites.
 *
 * The domain already turns flows into timed trips (`domain/trips/sprites.ts`)
 * and already knows why a trip never moved (`domain/evaluation/losses.ts`).
 * This module only adapts the two to what `TripsLayer` draws, and adds the one
 * thing the run needs that the pulse does not: an unserved trip is a short red
 * pulse AT ITS ORIGIN, not a red trip crossing the city, because nobody made
 * that journey (plan.md §3, "unserved trips appear as short red pulses at the
 * origin, by cause").
 *
 * No React, no DOM: a pure function, so the Run screen stays declarative and
 * the timing is testable.
 */
import { groupPathsByOd, odKey, pathIsOpen } from '../../domain/evaluation/losses';
import type { Evaluation } from '../../domain/evaluation/ports';
import type { GameData as EngineData } from '../../domain/evaluation/types';
import { demandSprites, flowSprites, type Project, type SpriteStatus } from '../../domain/trips/sprites';
import type { TripSprite } from '../map/layers/TripsLayer';

/** A sprite plus the period it belongs to: the reduced-motion stepper filters on it. */
export interface RunSprite extends TripSprite {
  period: number;
}

/** One period on screen. Three of them plus the crossing time ≈ the five seconds of plan.md §2. */
export const PERIOD_MS = 1500;
export const TRIP_MS = 1400;
export const RUN_CAP = 260;

/** How long the whole run lasts, so the screen can stop pretending it is playing. */
export const runDurationMs = (periods: number): number =>
  Math.max(1, periods) * PERIOD_MS + TRIP_MS;

/** How far along the trip a lost sprite pulses: a nudge out of the origin, no journey. */
const LOST_FRACTION = 0.06;

export interface RunSpritesInput {
  /** The solve the switch selects, with its flows. Null while it is still running. */
  readonly evaluation: Evaluation | null;
  /** The full payload; null until the worker's data has been fetched. */
  readonly engine: EngineData | null;
  readonly project: Project;
  readonly periods: number;
  /** The stations the visitor opened: what makes a path available at all. */
  readonly layout: readonly number[];
}

/**
 * The run's sprites.
 *
 * With flows: served trips ride cell → station → (tram or bus) → station →
 * cell, and what the LP could not serve pulses at its origin, coloured by the
 * cause `losses.ts` would attribute to it. Without flows — the estimate engine
 * assigns none — the potential demand plays in its neutral colour, which the
 * screen is required to label as an estimate.
 */
export function runSprites(input: RunSpritesInput): RunSprite[] {
  const { evaluation, engine, project, periods, layout } = input;
  if (!engine) return [];
  const options = { cap: RUN_CAP, periodMs: PERIOD_MS, durationMs: TRIP_MS, periods, seed: 20260921 };

  if (!evaluation || evaluation.flows.length === 0) {
    return demandSprites(engine.demand, engine.cells, engine.candidates, project, () => false, options).map(
      (sprite, index) => ({
        id: `run-${index}`,
        from: [sprite.from[0], sprite.from[1]],
        to: [sprite.to[0], sprite.to[1]],
        delayMs: sprite.delayMs,
        durationMs: sprite.durationMs,
        status: 'potential',
        period: sprite.period,
      }),
    );
  }

  const pathsByOd = groupPathsByOd(engine.paths);
  const open = new Set(layout);
  const cause = (o: number, d: number): SpriteStatus => {
    const options = pathsByOd.get(odKey(o, d));
    if (!options || options.length === 0) return 'unreachable';
    for (const index of options) {
      if (pathIsOpen(engine.paths[index]!, open)) return 'lost-no-stock';
    }
    return 'lost-no-station';
  };

  return flowSprites(
    evaluation.flows,
    engine.demand,
    engine.paths,
    engine.cells,
    engine.candidates,
    project,
    (o, d) => cause(o, d),
    options,
  ).map((sprite, index) => {
    const lost = sprite.status !== 'served';
    const to: [number, number] = lost
      ? [
          sprite.from[0] + (sprite.to[0] - sprite.from[0]) * LOST_FRACTION,
          sprite.from[1] + (sprite.to[1] - sprite.from[1]) * LOST_FRACTION,
        ]
      : [sprite.to[0], sprite.to[1]];
    return {
      id: `run-${index}`,
      from: [sprite.from[0], sprite.from[1]] as [number, number],
      to,
      via: lost ? undefined : sprite.via.map((point) => [point[0], point[1]] as [number, number]),
      pt: sprite.pt,
      delayMs: sprite.delayMs,
      durationMs: lost ? Math.round(sprite.durationMs * 0.45) : sprite.durationMs,
      status: sprite.status,
      period: sprite.period,
    };
  });
}
