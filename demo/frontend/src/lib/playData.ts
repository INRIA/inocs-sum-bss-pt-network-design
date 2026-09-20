/**
 * playData.ts — the planner game's first-paint payload, read at BUILD time.
 *
 * Runs in Node during `astro build` / `astro dev`, never in the browser, like
 * `data.ts` beside it. plan-technical §C.5 splits the game's data in two: what
 * the Build step needs to draw its first frame (candidates, cells, the reach
 * table, the reference demand, the per-budget references, the constants — about
 * 65 KB raw) travels as island props; what only the solver needs (`paths.json`,
 * `arcs.json`, the 3.5 MB wasm) is fetched at runtime by the worker from
 * `${BASE_URL}data/game/…`, so `play.html` stays small.
 *
 * Decoding is NOT duplicated: the pure decoders of `infra/gameData.ts` are
 * reused as they are. This module adds two things only — reading the files off
 * disk, and projecting lon/lat into the same fixed 360×300 frame `data.ts`
 * projects into, so every layer can draw the game's points with no geodesy in
 * the client.
 *
 * `references.byBudget` is a Map, which island props do not carry reliably, so
 * the decoded entries travel as a plain array and `PlayApp` rebuilds the Map.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { boundsOfGeoJSON, makeProjection, type Bounds } from './geo';
import {
  decodeCandidates,
  decodeCells,
  decodeConstants,
  decodeCoverage,
  decodeDemand,
  decodeReferences,
} from '../infra/gameData';
import type {
  BudgetReference,
  Coverage,
  DemandRow,
  GameBudget,
  ModelConstants,
} from '../domain/evaluation/types';

const HERE = dirname(fileURLToPath(import.meta.url));

function projectPath(rel: string): string {
  const candidates = [resolve(process.cwd(), rel), resolve(HERE, '../..', rel)];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

const DATA = projectPath('public/data');
const read = (p: string): any => JSON.parse(readFileSync(p, 'utf8'));

/** A candidate site, projected once into map units. `index` IS its station id. */
export interface PlayCandidate {
  index: number;
  id: string;
  transfer: boolean;
  lon: number;
  lat: number;
  x: number;
  y: number;
}

/** A demand zone centre, projected once. `index` is the id the OD rows use. */
export interface PlayCell {
  index: number;
  id: string;
  buildable: boolean;
  lon: number;
  lat: number;
  x: number;
  y: number;
}

export interface PlayData {
  /** False when `prepare-data.mjs` found no game payload: the page says so. */
  available: boolean;
  constants: ModelConstants | null;
  periods: number;
  budgets: GameBudget[];
  candidates: PlayCandidate[];
  cells: PlayCell[];
  coverage: Coverage | null;
  demand: DemandRow[];
  demandTotal: number;
  demandByPeriod: number[];
  /** `references.byBudget` flattened; the client rebuilds the Map. */
  references: BudgetReference[];
  /** The projection's own bounds, so the client can rebuild the same Project. */
  bounds: Bounds;
  /** `data/<path>` of the HiGHS binary, or null when it was not shipped. */
  solverPath: string | null;
  warnings: string[];
}

const GAME = join(DATA, 'game');

const EMPTY_BOUNDS: Bounds = { minLon: 0, maxLon: 0, minLat: 0, maxLat: 0 };

let cached: PlayData | null = null;

/**
 * Read, decode and project everything the game's first paint needs.
 *
 * A missing payload is a warning, never a throw: the page then renders its
 * unavailable state, exactly as the full demo does with no scenario.
 */
export function loadPlayData(): PlayData {
  if (cached) return cached;
  const warnings: string[] = [];
  const gridPath = join(DATA, 'city/grid.geojson');
  const bounds = existsSync(gridPath) ? boundsOfGeoJSON(read(gridPath)) : EMPTY_BOUNDS;
  const project = makeProjection(bounds);

  const needed = ['constants', 'candidates', 'cells', 'coverage', 'demand_reference', 'references'];
  const missing = needed.filter((name) => !existsSync(join(GAME, `${name}.json`)));
  if (missing.length) {
    warnings.push(
      `public/data/game/: missing ${missing.join(', ')} — run \`python3 -m demo.experiments.game_export\` then \`npm run prepare-data\``,
    );
    cached = {
      available: false,
      constants: null,
      periods: 0,
      budgets: [],
      candidates: [],
      cells: [],
      coverage: null,
      demand: [],
      demandTotal: 0,
      demandByPeriod: [],
      references: [],
      bounds,
      solverPath: null,
      warnings,
    };
    return cached;
  }

  const { constants, periods, budgets } = decodeConstants(read(join(GAME, 'constants.json')));
  const { demand, periods: demandPeriods } = decodeDemand(read(join(GAME, 'demand_reference.json')));
  const nPeriods = demandPeriods || periods;

  const candidates: PlayCandidate[] = decodeCandidates(read(join(GAME, 'candidates.json'))).map(
    (c, index) => {
      const [x, y] = project(c.lon, c.lat);
      return { index, id: c.id, transfer: c.type === 'TransferStation', lon: c.lon, lat: c.lat, x, y };
    },
  );
  const cells: PlayCell[] = decodeCells(read(join(GAME, 'cells.json'))).map((c, index) => {
    const [x, y] = project(c.lon, c.lat);
    return { index, id: c.id, buildable: c.buildable, lon: c.lon, lat: c.lat, x, y };
  });

  const demandByPeriod = new Array<number>(nPeriods).fill(0);
  let demandTotal = 0;
  for (const [, , period, flow] of demand) {
    demandTotal += flow;
    if (period < demandByPeriod.length) demandByPeriod[period] += flow;
  }

  const manifestPath = join(DATA, 'manifest.json');
  const manifest = existsSync(manifestPath) ? read(manifestPath) : {};
  const solverPath: string | null = manifest?.game?.solver?.path ?? null;
  if (!solverPath) {
    warnings.push('no HiGHS binary in the manifest — the game will fall back to its estimate engine');
  }

  cached = {
    available: true,
    constants,
    periods: nPeriods,
    budgets,
    candidates,
    cells,
    coverage: decodeCoverage(read(join(GAME, 'coverage.json'))),
    demand,
    demandTotal,
    demandByPeriod,
    references: [...decodeReferences(read(join(GAME, 'references.json'))).byBudget.values()],
    bounds,
    solverPath,
    warnings,
  };
  return cached;
}
