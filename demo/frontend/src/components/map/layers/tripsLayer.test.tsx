/**
 * Unit tests for TripsLayer (plan-technical.md §C.5): one circle + one line per sprite, moved
 * only by CSS via inline --dx/--dy custom properties, no per-frame React state. Assert on
 * counts/substrings only.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TripsLayer, { type TripSprite } from './TripsLayer';

const sprites: TripSprite[] = [
  { id: 't1', from: [0, 0], to: [10, 5], delayMs: 100, durationMs: 900, status: 'served' },
  { id: 't2', from: [1, 1], to: [-4, 3], delayMs: 200, durationMs: 800, status: 'lost-no-station' },
];

function render(loop = false) {
  return renderToStaticMarkup(createElement(TripsLayer, { sprites, loop }));
}

describe('TripsLayer', () => {
  it('renders one circle and one line per sprite', () => {
    const html = render();
    expect(html.split('class="trip trip-served"').length - 1).toBe(1);
    expect(html.split('class="trip trip-lost-no-station"').length - 1).toBe(1);
    expect(html.split('class="tripline trip-served"').length - 1).toBe(1);
    expect(html.split('class="tripline trip-lost-no-station"').length - 1).toBe(1);
  });

  it('sets --dx/--dy as destination minus origin, plus the delay and duration', () => {
    const html = render();
    // t1: dx = 10-0 = 10, dy = 5-0 = 5
    expect(html).toContain('--dx:10');
    expect(html).toContain('--dy:5');
    expect(html).toContain('animation-delay:100ms');
    expect(html).toContain('animation-duration:900ms');
    // t2: dx = -4-1 = -5, dy = 3-1 = 2
    expect(html).toContain('--dx:-5');
    expect(html).toContain('--dy:2');
  });

  it('runs once by default and infinitely when looped', () => {
    const once = render(false);
    expect(once).toContain('animation-iteration-count:1');
    expect(once).not.toContain('animation-iteration-count:infinite');

    const looped = render(true);
    expect(looped).toContain('animation-iteration-count:infinite');
  });
});
