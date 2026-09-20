/**
 * hitTest.test.ts — tapping the map, including the case that places nothing.
 */
import { describe, expect, it } from 'vitest';

import { hitTest, isTap, type HitCandidate } from './hitTest';

const candidates: HitCandidate[] = [
  { id: 0, x: 0, y: 0 },
  { id: 1, x: 10, y: 0 },
  { id: 2, x: 100, y: 100 },
  { id: 3, x: 10.2, y: 0 },
];

describe('hitTest', () => {
  it('misses when nothing is within the radius', () => {
    expect(hitTest(candidates, { x: 50, y: 50 }, 5)).toEqual({ kind: 'miss' });
  });

  it('hits the only candidate inside the radius', () => {
    expect(hitTest(candidates, { x: 0.5, y: 0.5 }, 3)).toEqual({ kind: 'hit', id: 0 });
  });

  it('reports ambiguity when two candidates are equally close', () => {
    // 1 and 3 are 0.2 apart; a tap between them cannot be resolved.
    const result = hitTest(candidates, { x: 10.1, y: 0 }, 3);
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect([...result.ids].sort()).toEqual([1, 3]);
  });

  it('still hits when one candidate is clearly nearer than the other', () => {
    // 0 is 0.5 away, 1 is 9.5 away: well outside the ambiguity ratio.
    expect(hitTest(candidates, { x: 0.5, y: 0 }, 12)).toEqual({ kind: 'hit', id: 0 });
  });

  it('does not depend on the order the candidates arrive in', () => {
    const reversed = [...candidates].reverse();
    expect(hitTest(reversed, { x: 0.5, y: 0.5 }, 3)).toEqual(
      hitTest(candidates, { x: 0.5, y: 0.5 }, 3),
    );
    expect(hitTest(reversed, { x: 10.1, y: 0 }, 3)).toEqual(
      hitTest(candidates, { x: 10.1, y: 0 }, 3),
    );
  });

  it('misses on a non-positive radius', () => {
    expect(hitTest(candidates, { x: 0, y: 0 }, 0)).toEqual({ kind: 'miss' });
  });

  it('distinguishes a tap from a drag', () => {
    expect(isTap(10, 10, 12, 12, 120)).toBe(true);
    expect(isTap(10, 10, 40, 10, 120)).toBe(false); // moved too far
    expect(isTap(10, 10, 12, 12, 900)).toBe(false); // held too long
  });
});
