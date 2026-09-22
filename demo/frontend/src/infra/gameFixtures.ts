/**
 * gameFixtures.ts — read the game payload straight off the repository.
 *
 * TEST AND TOOLING ONLY. It imports `node:fs`, so it must never be reachable
 * from a browser bundle: nothing under `components/`, `hooks/` or `domain/`
 * imports it, and only `*.test.ts` files do.
 *
 * It reads `demo/experiments/results/shared/game/` — the committed source of
 * truth, not the generated copy under `public/data/` — so a vitest run pins the
 * TypeScript engine against exactly the files the Python reference wrote.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { GameData } from '../domain/evaluation/types';
import { loadGameData, type GameFile } from './gameData';

/** demo/experiments/results/shared/game, relative to this file. */
export const GAME_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../experiments/results/shared/game',
);

export const readGameJson = (relativePath: string): unknown =>
  JSON.parse(readFileSync(join(GAME_DIR, relativePath), 'utf8'));

/** One golden vector, as demo/experiments/game_export.py wrote it. */
export interface GoldenVector {
  scenario: string;
  demand_profile: string;
  budget_eur: number;
  ops_budget_eur: number;
  epsilon: number;
  stations: number[];
  with_trucks: GoldenSummary;
  without_trucks: GoldenSummary;
  published: { served_total: number; served_ratio: number; pt_assisted_share: number };
}

export interface GoldenSummary {
  feasible: boolean;
  served: number;
  served_ratio: number;
  demand_total: number;
  demand_by_period: number[];
  served_by_period: number[];
  bike_only_by_period: number[];
  bike_pt_by_period: number[];
  pt_share: number;
  docks: number;
  bikes: number;
  capex_eur: number;
  n_stations: number;
  n_transfer: number;
  losses: { no_station: number; no_stock: number; unreachable: number };
}

/**
 * The names of every committed golden vector, sorted. Discovered from the
 * directory, so a newly committed run is picked up with no change here.
 */
export function goldenScenarios(): string[] {
  return readdirSync(join(GAME_DIR, 'golden'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
}

export const loadGolden = (scenario: string): GoldenVector =>
  readGameJson(`golden/${scenario}.json`) as GoldenVector;

/** The decoded payload, through exactly the same decoders the browser uses. */
export const loadFixtureGameData = (): Promise<GameData> =>
  loadGameData(async (name: GameFile) => readGameJson(`${name}.json`));

/**
 * A golden vector's demand profile.
 *
 * `demand_reference.json` carries the game's own (bimodal) profile, which the
 * 15 non-rhythm runs share. A `rhythm_*` or `S*` run has its own multinomial
 * split, so its golden vector is reproduced from that run's `instance.json`.
 */
export function loadScenarioDemand(
  scenario: string,
  cellIds: readonly string[],
): [number, number, number, number][] {
  const instancePath = join(GAME_DIR, '../..', scenario, 'instance.json');
  const instance = JSON.parse(readFileSync(instancePath, 'utf8')) as {
    od_demand: { origin: string; dest: string; period: number; flow: number }[];
  };
  const index = new Map(cellIds.map((id, at) => [id, at]));
  return instance.od_demand
    .filter((row) => row.flow > 0)
    .map((row) => {
      const o = index.get(row.origin);
      const d = index.get(row.dest);
      if (o == null || d == null) {
        throw new Error(`${scenario}: demand on an unknown cell ${row.origin}->${row.dest}`);
      }
      return [o, d, row.period, row.flow] as [number, number, number, number];
    })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
}
