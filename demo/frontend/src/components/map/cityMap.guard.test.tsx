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
    await expect(renderMap('city')).toMatchFileSnapshot('./__guard__/citymap-city.html');
  });

  it('kind=live', async () => {
    await expect(renderMap('live')).toMatchFileSnapshot('./__guard__/citymap-live.html');
  });

  it('kind=network', async () => {
    await expect(renderMap('network')).toMatchFileSnapshot('./__guard__/citymap-network.html');
  });

  it('kind=network, inventory on / capacity off', async () => {
    const layers: Layers = { ...DEFAULT_LAYERS, capacity: false, inventory: true };
    await expect(renderMap('network', { layers })).toMatchFileSnapshot(
      './__guard__/citymap-network-inventory.html'
    );
  });

  it('kind=network, unitPx=0.5 (micro-dot + hidden labels)', async () => {
    await expect(renderMap('network', { unitPx: 0.5 })).toMatchFileSnapshot(
      './__guard__/citymap-network-micro.html'
    );
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
    await expect(html).toMatchFileSnapshot('./__guard__/mappanel-network.html');
  });
});
