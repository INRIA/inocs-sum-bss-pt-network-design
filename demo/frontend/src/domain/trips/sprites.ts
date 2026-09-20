/**
 * sprites.ts — flows (or plain demand) into timed, drawable trips.
 *
 * Two uses, one function: the "city pulse" that plays while the visitor places
 * stations (potential demand, grey, turning green as it comes within reach),
 * and the run animation after the solve (served green, lost red by cause).
 *
 * Deterministic and capped: the same inputs always give the same sprites, and
 * never more than `cap` of them, so the frame budget is fixed. Sampling is a
 * seeded shuffle over a flow-weighted expansion, so a heavy corridor gets more
 * sprites than a light one without any sprite being invented.
 *
 * The projection is INJECTED, so this file never imports lib/geo and stays
 * testable in node.
 *
 * Pure domain: no React, no DOM, no fetch, no node imports.
 */
import type { AssignedFlow } from '../evaluation/ports';
import type { Candidate, Cell, DemandRow, GamePath } from '../evaluation/types';

export type SpriteStatus =
  | 'served'
  | 'lost-no-station'
  | 'lost-no-stock'
  | 'unreachable'
  | 'potential'
  | 'reached';

export type Point = readonly [number, number];

export interface Sprite {
  readonly from: Point;
  /** The stations the trip touches, in order. Empty for an unserved trip. */
  readonly via: readonly Point[];
  readonly to: Point;
  readonly period: number;
  readonly delayMs: number;
  readonly durationMs: number;
  readonly status: SpriteStatus;
}

/** Longitude/latitude to the map's own units. Injected, never imported. */
export type Project = (lon: number, lat: number) => Point;

export interface SpriteOptions {
  /** Hard ceiling on how many sprites are produced. */
  readonly cap?: number;
  /** How long one period lasts on screen. */
  readonly periodMs?: number;
  /** How long a single trip takes to cross. */
  readonly durationMs?: number;
  /** Anything that makes the sample reproducible. */
  readonly seed?: number;
  readonly periods?: number;
}

const DEFAULTS = {
  cap: 300,
  periodMs: 1700,
  durationMs: 1500,
  seed: 1,
  periods: 3,
};

/** mulberry32: a small, fast, fully deterministic PRNG. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Draft {
  readonly o: number;
  readonly d: number;
  readonly period: number;
  readonly weight: number;
  readonly via: readonly number[];
  readonly status: SpriteStatus;
}

/**
 * Pick at most `cap` drafts, weighted by flow, deterministically.
 *
 * Largest-remainder apportionment: each draft gets `cap * weight / total`
 * sprites, whole part first, then the largest remainders. Ties break on the
 * draft's position, so the result never depends on map iteration order.
 */
function apportion(drafts: readonly Draft[], cap: number): number[] {
  const total = drafts.reduce((sum, draft) => sum + draft.weight, 0);
  if (total <= 0 || cap <= 0) return drafts.map(() => 0);
  const exact = drafts.map((draft) => (cap * draft.weight) / total);
  const counts = exact.map((value) => Math.floor(value));
  let left = cap - counts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let k = 0; k < order.length && left > 0; k += 1) {
    counts[order[k]!.index] = (counts[order[k]!.index] ?? 0) + 1;
    left -= 1;
  }
  return counts;
}

/**
 * A total order on drafts, so the result never depends on the order the caller
 * happened to build them in (a Map iteration, a filter, a reversed array). The
 * apportionment below breaks ties on position, so without this the same data in
 * a different order would give a different sample.
 */
function canonical(a: Draft, b: Draft): number {
  return (
    a.period - b.period ||
    a.o - b.o ||
    a.d - b.d ||
    (a.status < b.status ? -1 : a.status > b.status ? 1 : 0) ||
    b.weight - a.weight
  );
}

function build(
  unordered: readonly Draft[],
  cells: readonly Cell[],
  candidates: readonly Candidate[],
  project: Project,
  options: SpriteOptions,
): Sprite[] {
  const cap = options.cap ?? DEFAULTS.cap;
  const periodMs = options.periodMs ?? DEFAULTS.periodMs;
  const durationMs = options.durationMs ?? DEFAULTS.durationMs;
  const random = rng(options.seed ?? DEFAULTS.seed);
  const drafts = [...unordered].sort(canonical);
  const counts = apportion(drafts, cap);
  const sprites: Sprite[] = [];
  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index]!;
    const origin = cells[draft.o];
    const destination = cells[draft.d];
    if (!origin || !destination) continue;
    const from = project(origin.lon, origin.lat);
    const to = project(destination.lon, destination.lat);
    const via = draft.via
      .map((station) => candidates[station])
      .filter((station): station is Candidate => station != null)
      .map((station) => project(station.lon, station.lat));
    for (let k = 0; k < (counts[index] ?? 0); k += 1) {
      sprites.push({
        from,
        via,
        to,
        period: draft.period,
        // Spread within the period so trips do not all leave at once.
        delayMs: Math.round(draft.period * periodMs + random() * periodMs * 0.9),
        durationMs,
        status: draft.status,
      });
    }
  }
  sprites.sort((a, b) => a.delayMs - b.delayMs || a.period - b.period);
  return sprites;
}

/**
 * The run animation: the LP's own assignment, plus what it could not serve.
 *
 * @param flows  the solved `[pathIndex, period, flow]` rows.
 * @param losses per-cause totals, used only to colour the unserved remainder.
 */
export function flowSprites(
  flows: readonly AssignedFlow[],
  demand: readonly DemandRow[],
  paths: readonly GamePath[],
  cells: readonly Cell[],
  candidates: readonly Candidate[],
  project: Project,
  unservedStatus: (o: number, d: number, period: number) => SpriteStatus | null,
  options: SpriteOptions = {},
): Sprite[] {
  const drafts: Draft[] = [];
  const servedByKey = new Map<string, number>();
  for (const [pathIndex, period, flow] of flows) {
    const path = paths[pathIndex];
    if (!path) continue;
    const key = `${path.o}:${path.d}:${period}`;
    servedByKey.set(key, (servedByKey.get(key) ?? 0) + flow);
    const via: number[] = [];
    for (const [start, end] of path.legs) {
      if (via[via.length - 1] !== start) via.push(start);
      via.push(end);
    }
    drafts.push({ o: path.o, d: path.d, period, weight: flow, via, status: 'served' });
  }
  for (const [o, d, period, flow] of demand) {
    const left = flow - (servedByKey.get(`${o}:${d}:${period}`) ?? 0);
    if (left <= 1e-6) continue;
    const status = unservedStatus(o, d, period);
    if (!status) continue;
    drafts.push({ o, d, period, weight: left, via: [], status });
  }
  return build(drafts, cells, candidates, project, options);
}

/**
 * The city pulse: potential demand, before anything is placed. A trip whose row
 * is already within reach of the layout is marked `reached` — the UI turns it
 * green. It is reach, never service, so the counter beside it must say so.
 */
export function demandSprites(
  demand: readonly DemandRow[],
  cells: readonly Cell[],
  candidates: readonly Candidate[],
  project: Project,
  isReached: (o: number, d: number, period: number) => boolean = () => false,
  options: SpriteOptions = {},
): Sprite[] {
  const drafts: Draft[] = demand
    .filter(([, , , flow]) => flow > 0)
    .map(([o, d, period, flow]) => ({
      o,
      d,
      period,
      weight: flow,
      via: [] as number[],
      status: (isReached(o, d, period) ? 'reached' : 'potential') as SpriteStatus,
    }));
  return build(drafts, cells, candidates, project, options);
}
