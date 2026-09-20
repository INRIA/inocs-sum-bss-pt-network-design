/**
 * viewport.test.ts — the breakpoints of plan-technical §B.1.
 *
 * The acceptance matrix of §B.4 is the test data: every viewport the game is
 * checked at must classify the way the layout table says.
 */
import { describe, expect, it } from 'vitest';

import { SSR_VIEWPORT, classifyViewport } from './viewport';

describe('classifyViewport', () => {
  it('classifies the acceptance matrix', () => {
    const matrix: [number, number, string, boolean][] = [
      [360, 640, 'phone', false],
      [390, 844, 'phone', false],
      [844, 390, 'phone-landscape', false],
      [768, 1024, 'tablet', false],
      [1024, 768, 'desktop', true],
      [1366, 768, 'desktop', true],
      [1920, 1080, 'desktop', false],
    ];
    for (const [width, height, viewport, short] of matrix) {
      expect(classifyViewport(width, height), `${width}x${height}`).toEqual({ viewport, short });
    }
  });

  it('holds at the edges', () => {
    expect(classifyViewport(639, 900).viewport).toBe('phone');
    expect(classifyViewport(640, 900).viewport).toBe('tablet');
    expect(classifyViewport(980, 900).viewport).toBe('tablet');
    expect(classifyViewport(981, 900).viewport).toBe('desktop');
    // Landscape needs BOTH a short height and a width that is not a desktop.
    expect(classifyViewport(800, 500).viewport).toBe('phone-landscape');
    expect(classifyViewport(800, 501).viewport).toBe('tablet');
    expect(classifyViewport(1200, 480).viewport).toBe('desktop');
    expect(classifyViewport(1200, 819).short).toBe(true);
    expect(classifyViewport(1200, 820).short).toBe(false);
  });

  it('renders as a desktop on the server', () => {
    expect(SSR_VIEWPORT).toEqual({ viewport: 'desktop', short: false });
  });
});
