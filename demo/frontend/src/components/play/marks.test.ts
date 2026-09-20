/**
 * The three marks are one line with three labels on it, and the labels have to
 * stay readable: the review found the middle one printed straight through the
 * caption under the rail, and the right one (always the optimiser, always the
 * maximum) hanging off the card on a phone.
 *
 * Both are laid out by pure functions, so both are pinned here.
 */
import { describe, expect, it } from 'vitest';

import { MARK_MIN_GAP_PCT, markNudge, markTiers } from './screens/ResultBits';

describe('markTiers', () => {
  it('keeps every label on the first row when the marks are far apart', () => {
    expect(markTiers([5, 50, 95])).toEqual([0, 0, 0]);
  });

  it('drops a label to the next row when its mark is within the minimum gap', () => {
    const tiers = markTiers([50, 52, 95], MARK_MIN_GAP_PCT);
    expect(tiers[0]).toBe(0);
    expect(tiers[1]).toBe(1);
    expect(tiers[2]).toBe(0);
  });

  it('stacks a third coincident mark on a third row, whatever the input order', () => {
    expect(markTiers([60, 58, 59])).toEqual([2, 0, 1]);
  });

  it('measures the gap on the line, not on the index', () => {
    // exactly the minimum gap is enough room
    expect(markTiers([40, 40 + MARK_MIN_GAP_PCT])).toEqual([0, 0]);
  });
});

describe('markNudge', () => {
  it('pulls the label back in at either end, and leaves the middle alone', () => {
    expect(markNudge(96)).toBeLessThan(0);
    expect(markNudge(4)).toBeGreaterThan(0);
    expect(markNudge(50)).toBe(0);
  });
});
