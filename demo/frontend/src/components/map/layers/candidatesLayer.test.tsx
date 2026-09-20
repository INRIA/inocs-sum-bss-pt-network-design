/**
 * Unit tests for CandidatesLayer (plan-technical.md §C.3). Placement itself goes through
 * MapFrame's onTap + a hit test, not a click handler, so these only check the static markup and
 * the keyboard fallback contract. Assert on counts/substrings only, never print full markup.
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CandidatesLayer, { type Candidate } from './CandidatesLayer';
import { MapViewProvider } from '../MapContext';

const candidates: Candidate[] = [
  { id: 'c1', x: 10, y: 10, transfer: false },
  { id: 'c2', x: 20, y: 20, transfer: true },
];

function render(unitPx: number) {
  return renderToStaticMarkup(
    createElement(
      MapViewProvider,
      { value: { unitPx, clipId: 'test-clip' } },
      createElement(CandidatesLayer, { candidates, label: (c: Candidate) => `candidate ${c.id}` })
    )
  );
}

describe('CandidatesLayer', () => {
  it('renders one focusable, labelled group per candidate', () => {
    const html = render(2);
    expect(html.split('role="button"').length - 1).toBe(candidates.length);
    expect(html.split('tabindex="0"').length - 1).toBe(candidates.length);
    expect(html).toContain('aria-label="candidate c1"');
    expect(html).toContain('aria-label="candidate c2"');
  });

  it('draws a small hollow marker plus an invisible hit circle per candidate', () => {
    const html = render(2);
    // marker: r=1.6; hit circle: r = max(1.6, 22/unitPx) = 11 at unitPx=2
    expect(html.split('r="1.6"').length - 1).toBe(candidates.length);
    expect(html.split('r="11"').length - 1).toBe(candidates.length);
    expect(html.split('fill="transparent"').length - 1).toBe(candidates.length);
  });

  it('grows the hit radius as unitPx shrinks (never below the marker radius)', () => {
    const zoomedOut = render(0.5); // 22/0.5 = 44
    expect(zoomedOut).toContain('r="44"');

    const zoomedIn = render(50); // 22/50 = 0.44 -> clamped to 1.6
    expect(zoomedIn.split('r="1.6"').length - 1).toBe(candidates.length * 2); // marker + hit circle coincide
  });

  it('never renders a click handler — placement goes through the frame tap + hit test', () => {
    const onToggle = vi.fn();
    const html = renderToStaticMarkup(
      createElement(
        MapViewProvider,
        { value: { unitPx: 2, clipId: 'test-clip' } },
        createElement(CandidatesLayer, { candidates, onToggle, label: () => 'x' })
      )
    );
    expect(html).not.toContain('onclick');
  });
});
