import { describe, expect, it } from 'vitest';
import { clientToMap, isTap, scaleOf } from './panZoomMath';

const squareRect = { left: 0, top: 0, width: 360, height: 300 };
const squareVb = { x: 0, y: 0, w: 360, h: 300 };

describe('scaleOf / clientToMap', () => {
  it('maps the centre of a 1:1 rect to the centre of the viewBox', () => {
    const p = clientToMap(squareRect, squareVb, 180, 150);
    expect(p.x).toBeCloseTo(180, 6);
    expect(p.y).toBeCloseTo(150, 6);
    expect(p.sc).toBeCloseTo(1, 6);
  });

  it('maps the corners of a 1:1 rect to the corners of the viewBox', () => {
    const tl = clientToMap(squareRect, squareVb, 0, 0);
    expect(tl.x).toBeCloseTo(0, 6);
    expect(tl.y).toBeCloseTo(0, 6);

    const br = clientToMap(squareRect, squareVb, 360, 300);
    expect(br.x).toBeCloseTo(360, 6);
    expect(br.y).toBeCloseTo(300, 6);
  });

  it('honours preserveAspectRatio xMidYMid meet: a wider rect letterboxes on x', () => {
    // viewBox is 360x300 (1.2 aspect), rect is 720x300 (2.4 aspect) -> scale is capped by height,
    // and the extra width is split evenly as letterbox margin on both sides.
    const wideRect = { left: 0, top: 0, width: 720, height: 300 };
    const sc = scaleOf(wideRect, squareVb);
    expect(sc).toBeCloseTo(1, 6); // height-bound: 300/300

    const margin = (wideRect.width - squareVb.w * sc) / 2; // 180
    // a click at the left edge of the rect lands left of the viewBox origin, in the margin
    const left = clientToMap(wideRect, squareVb, 0, 150);
    expect(left.x).toBeCloseTo(-margin, 6);
    expect(left.y).toBeCloseTo(150, 6);

    // a click just past the margin lands exactly at the viewBox's left edge
    const atContent = clientToMap(wideRect, squareVb, margin, 150);
    expect(atContent.x).toBeCloseTo(0, 6);
  });

  it('honours preserveAspectRatio xMidYMid meet: a taller rect letterboxes on y', () => {
    const tallRect = { left: 0, top: 0, width: 360, height: 600 };
    const sc = scaleOf(tallRect, squareVb);
    expect(sc).toBeCloseTo(1, 6); // width-bound: 360/360

    const margin = (tallRect.height - squareVb.h * sc) / 2; // 150
    const top = clientToMap(tallRect, squareVb, 180, 0);
    expect(top.y).toBeCloseTo(-margin, 6);
  });

  it('accounts for the rect offset and a zoomed-in viewBox', () => {
    const offsetRect = { left: 50, top: 20, width: 180, height: 150 };
    const zoomedVb = { x: 90, y: 75, w: 180, h: 150 }; // 2x zoom, centred
    const p = clientToMap(offsetRect, zoomedVb, 50 + 90, 20 + 75); // element centre
    expect(p.x).toBeCloseTo(180, 6);
    expect(p.y).toBeCloseTo(150, 6);
  });
});

describe('isTap', () => {
  it('is a tap when the pointer barely moved and released quickly', () => {
    expect(isTap({ x: 100, y: 100, t: 0 }, { x: 103, y: 101, t: 120 })).toBe(true);
  });

  it('is not a tap when the pointer travelled past the movement threshold (a drag)', () => {
    expect(isTap({ x: 100, y: 100, t: 0 }, { x: 120, y: 100, t: 50 })).toBe(false);
  });

  it('is not a tap when the pointer stayed put past the time threshold (a long press)', () => {
    expect(isTap({ x: 100, y: 100, t: 0 }, { x: 101, y: 100, t: 500 })).toBe(false);
  });

  it('is exactly at the boundary of the default thresholds', () => {
    expect(isTap({ x: 0, y: 0, t: 0 }, { x: 8, y: 0, t: 300 })).toBe(true);
    expect(isTap({ x: 0, y: 0, t: 0 }, { x: 8.01, y: 0, t: 300 })).toBe(false);
    expect(isTap({ x: 0, y: 0, t: 0 }, { x: 8, y: 0, t: 301 })).toBe(false);
  });

  it('honours custom thresholds', () => {
    expect(isTap({ x: 0, y: 0, t: 0 }, { x: 20, y: 0, t: 900 }, 25, 1000)).toBe(true);
  });
});
