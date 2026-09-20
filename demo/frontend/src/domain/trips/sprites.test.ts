/**
 * sprites.test.ts — the animation must be deterministic and capped.
 *
 * The map draws these as SVG circles moved by CSS, so an uncapped or
 * order-dependent list would show up as a frame-rate cliff and as a different
 * animation on every render.
 */
import { describe, expect, it } from 'vitest';

import { demandSprites, flowSprites, type Project } from './sprites';
import { decodeCandidates, decodeCells, decodeDemand, decodePaths } from '../../infra/gameData';
import { readGameJson } from '../../infra/gameFixtures';
import type { AssignedFlow } from '../evaluation/ports';

const cells = decodeCells(readGameJson('cells.json'));
const candidates = decodeCandidates(readGameJson('candidates.json'));
const paths = decodePaths(readGameJson('paths.json'));
const { demand } = decodeDemand(readGameJson('demand_reference.json'));

/** A trivial injected projection: no lib/geo, no DOM. */
const project: Project = (lon, lat) => [lon * 100, lat * -100];

describe('city-pulse sprites', () => {
  it('is capped', () => {
    for (const cap of [1, 40, 300]) {
      expect(demandSprites(demand, cells, candidates, project, () => false, { cap })).toHaveLength(
        cap,
      );
    }
  });

  it('is deterministic for the same seed and varies with the seed', () => {
    const a = demandSprites(demand, cells, candidates, project, () => false, { cap: 60, seed: 7 });
    const b = demandSprites(demand, cells, candidates, project, () => false, { cap: 60, seed: 7 });
    const c = demandSprites(demand, cells, candidates, project, () => false, { cap: 60, seed: 8 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('does not depend on the order the demand rows arrive in', () => {
    const shuffled = [...demand].reverse();
    const a = demandSprites(demand, cells, candidates, project, () => false, { cap: 80, seed: 3 });
    const b = demandSprites(shuffled, cells, candidates, project, () => false, { cap: 80, seed: 3 });
    const key = (s: (typeof a)[number]): string => `${s.from}|${s.to}|${s.period}|${s.status}`;
    expect(a.map(key).sort()).toEqual(b.map(key).sort());
  });

  it('marks rows within reach, and uses the injected projection', () => {
    const sprites = demandSprites(
      demand,
      cells,
      candidates,
      project,
      (o) => o === demand[0]![0],
      { cap: 120, seed: 1 },
    );
    expect(sprites.some((s) => s.status === 'reached')).toBe(true);
    expect(sprites.some((s) => s.status === 'potential')).toBe(true);
    const first = cells[demand[0]![0]]!;
    expect(sprites.some((s) => s.from[0] === first.lon * 100)).toBe(true);
  });

  it('keeps every sprite inside its period and plays them in order', () => {
    const sprites = demandSprites(demand, cells, candidates, project, () => false, {
      cap: 100,
      seed: 5,
      periodMs: 1000,
    });
    for (const sprite of sprites) {
      expect(sprite.delayMs).toBeGreaterThanOrEqual(sprite.period * 1000);
      expect(sprite.delayMs).toBeLessThan((sprite.period + 1) * 1000);
    }
    for (let i = 1; i < sprites.length; i += 1) {
      expect(sprites[i]!.delayMs).toBeGreaterThanOrEqual(sprites[i - 1]!.delayMs);
    }
  });
});

describe('run sprites', () => {
  const flows: AssignedFlow[] = [
    [0, 0, 3],
    [1, 1, 2],
  ];

  it('routes a served trip through its stations', () => {
    const sprites = flowSprites(flows, [], paths, cells, candidates, project, () => null, {
      cap: 20,
      seed: 2,
    });
    expect(sprites.length).toBe(20);
    expect(sprites.every((s) => s.status === 'served')).toBe(true);
    expect(sprites.every((s) => s.via.length >= 2)).toBe(true);
  });

  it('colours the unserved remainder by cause', () => {
    const path = paths[0]!;
    const rows: [number, number, number, number][] = [[path.o, path.d, 0, 10]];
    const sprites = flowSprites(
      [[0, 0, 4]],
      rows,
      paths,
      cells,
      candidates,
      project,
      () => 'lost-no-stock',
      { cap: 50, seed: 4 },
    );
    const served = sprites.filter((s) => s.status === 'served').length;
    const lost = sprites.filter((s) => s.status === 'lost-no-stock').length;
    expect(served + lost).toBe(50);
    // 4 served of 10 demanded: roughly two fifths of the sprites.
    expect(served).toBeGreaterThan(10);
    expect(lost).toBeGreaterThan(20);
  });

  it('drops an unserved row the caller gives no cause for', () => {
    const path = paths[0]!;
    const sprites = flowSprites(
      [],
      [[path.o, path.d, 0, 10]],
      paths,
      cells,
      candidates,
      project,
      () => null,
      { cap: 10, seed: 1 },
    );
    expect(sprites).toHaveLength(0);
  });
});
