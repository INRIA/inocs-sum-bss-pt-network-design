/**
 * Guard for the P2 map refactor (plan-technical.md §C.3).
 *
 * Renders the UNMODIFIED CityMap / MapPanel to static markup with fixed props and pins the output
 * as file snapshots. After the refactor (MapCanvas/MapFrame/layers composition) these must match
 * BYTE FOR BYTE — this is the contract that lets the internals change while the three advanced
 * `kind`s keep rendering exactly as before. Do not regenerate these snapshots after step 1 unless
 * the report explicitly says so and why.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import CityMap, { type MapKind } from '../CityMap';
import MapPanel from '../MapPanel';
import { loadGameData } from '../../lib/data';
import { makeT } from '../../lib/i18n';
import type { Layers } from '../../lib/types';

const data = loadGameData();
const t = makeT('en');
const scenario = data.scenarios.find((s) => s.id === 'budget_080k');
if (!scenario) throw new Error('fixture scenario budget_080k not found in prepared data');

// Game.tsx DEFAULT_LAYERS, copied verbatim (fixed contract props, not imported so the guard does
// not silently change if Game.tsx's default ever changes for unrelated reasons).
const DEFAULT_LAYERS: Layers = {
  stops: true,
  tram: true,
  bus: true,
  rail: true,
  poi: true,
  bike: true,
  transfer: true,
  regular: true,
  capacity: true,
  inventory: false,
};

/**
 * Assert against the pinned file. When GUARD_ACTUAL_DIR is set (scripts/guard-diff.mjs), the
 * actual markup is also written there, so a mismatch can be inspected by offset instead of
 * letting the runner print a 250 KB single-line diff.
 */
async function pin(html: string, name: string) {
  const dir = process.env.GUARD_ACTUAL_DIR;
  if (dir) writeFileSync(join(dir, name), html);
  await expect(html).toMatchFileSnapshot(`./__guard__/${name}`);
}

const dummyRef = { current: null };

const baseProps = {
  id: 'map',
  map: data.map,
  t,
  lang: 'en' as const,
  weekday: 'mon' as const,
  hour: 8,
  layers: DEFAULT_LAYERS,
  stations: scenario.stations,
  period: 0,
  dropKey: 0,
  svgRef: dummyRef,
  viewBox: '0.0 0.0 360.0 300.0',
  unitPx: 2,
};

function renderMap(kind: MapKind, overrides: Partial<typeof baseProps> = {}) {
  return renderToStaticMarkup(createElement(CityMap, { ...baseProps, kind, ...overrides }));
}

describe('CityMap static markup guard', () => {
  it('kind=city', async () => {
    await pin(renderMap('city'), 'citymap-city.html');
  });

  it('kind=live', async () => {
    await pin(renderMap('live'), 'citymap-live.html');
  });

  it('kind=network', async () => {
    await pin(renderMap('network'), 'citymap-network.html');
  });

  it('kind=network, inventory on / capacity off', async () => {
    const layers: Layers = { ...DEFAULT_LAYERS, capacity: false, inventory: true };
    await pin(renderMap('network', { layers }), 'citymap-network-inventory.html');
  });

  it('kind=network, unitPx=0.5 (micro-dot + hidden labels)', async () => {
    await pin(renderMap('network', { unitPx: 0.5 }), 'citymap-network-micro.html');
  });
});

describe('MapPanel static markup guard', () => {
  it('kind=network', async () => {
    const html = renderToStaticMarkup(
      createElement(MapPanel, {
        data,
        kind: 'network' as MapKind,
        t,
        lang: 'en' as const,
        weekday: 'mon' as const,
        hour: 8,
        layers: DEFAULT_LAYERS,
        onToggleLayer: () => {},
        scenario,
        period: 0,
        onPeriod: () => {},
        dropKey: 0,
      })
    );
    await pin(html, 'mappanel-network.html');
  });
});
