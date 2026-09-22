/**
 * Unit tests for the game-facing StationsLayer variants (plan-technical.md §C.3). `plan` is
 * pinned byte-for-byte by the map guard (cityMap.guard.test.tsx); these are ordinary assertions
 * on short strings for `player` and `ghost`, which nothing else exercises yet. Never print or
 * snapshot the rendered markup — assert on counts/substrings only.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StationsLayer, { type GhostStation, type PlayerStation } from './StationsLayer';
import { MapViewProvider } from '../MapContext';
import { C_EXISTING, C_REGULAR, C_TRANSFER } from '../../glyphs';

const view = { unitPx: 2, clipId: 'test-clip' };

function renderPlayer(stations: PlayerStation[]) {
  return renderToStaticMarkup(
    createElement(
      MapViewProvider,
      { value: view },
      createElement(StationsLayer, { variant: 'player', stations })
    )
  );
}

function renderGhost(stations: GhostStation[]) {
  return renderToStaticMarkup(
    createElement(
      MapViewProvider,
      { value: view },
      createElement(StationsLayer, { variant: 'ghost', stations })
    )
  );
}

describe('StationsLayer variant=player', () => {
  const stations: PlayerStation[] = [
    { x: 10, y: 10, transfer: false },
    { x: 20, y: 20, transfer: true, assisted: true },
  ];

  it('draws one glyph per station', () => {
    const html = renderPlayer(stations);
    // BikeGlyph's frame path (BIKE_PATH) appears exactly once per station.
    const glyphCount = html.split('M-3.1,1.7').length - 1;
    expect(glyphCount).toBe(stations.length);
  });

  it('draws a dashed outline circle only for the assisted station', () => {
    const html = renderPlayer(stations);
    const dashedCircles = html.split('stroke-dasharray="2 2"').length - 1;
    expect(dashedCircles).toBe(1);
  });

  it('colours regular and transfer stations with their own colour', () => {
    const html = renderPlayer(stations);
    expect(html).toContain(C_REGULAR);
    expect(html).toContain(C_TRANSFER);
  });
});

describe('StationsLayer variant=ghost', () => {
  const stations: GhostStation[] = [
    { x: 5, y: 5 },
    { x: 15, y: 15 },
  ];

  it('uses the grey existing-station colour', () => {
    const html = renderGhost(stations);
    expect(html).toContain(C_EXISTING);
    expect(html).not.toContain(C_REGULAR);
    expect(html).not.toContain(C_TRANSFER);
  });

  it('wraps the glyphs at opacity 0.6', () => {
    const html = renderGhost(stations);
    expect(html).toContain('opacity="0.6"');
  });

  it('draws one glyph per station and no halo', () => {
    const html = renderGhost(stations);
    const glyphCount = html.split('M-3.1,1.7').length - 1;
    expect(glyphCount).toBe(stations.length);
    // halo is a filled white circle with no stroke, emitted only when `halo` is set
    expect(html).not.toContain('fill="#fff" stroke="none"');
  });
});
