import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { FRAME } from './geo';

/**
 * viewBox-based pan & zoom for the persistent map SVG (ux-plan-v2 section 4.4).
 *
 * Zoom 1x-6x (viewBox width clamped 60..360), pan clamped to a 24-unit margin around the study
 * area. Wheel zooms at the cursor, double-click zooms 1.6x at the point, one pointer pans, two
 * pointers pinch, and the overlay buttons step 1.35x about the centre. No inertia, no easing —
 * direct manipulation only (v2 section 8). The view is owned here and therefore survives every
 * step change, because the map component is never unmounted.
 */
export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MARGIN = 24;
const MIN_W = 60; // 6x
const MAX_W = FRAME.w; // 1x

export function usePanZoom(ref: RefObject<SVGSVGElement | null>) {
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: FRAME.w, h: FRAME.h });
  const vbRef = useRef(vb);
  // px per user unit — drives the "micro bikes degrade to dots" threshold (v2 section 6, note 2).
  // 2 is the presentation-screen value: it is what the server renders, and the first measurement
  // after mount corrects it (a phone lands near 1).
  const [unitPx, setUnitPx] = useState(2);

  const apply = useCallback((x: number, y: number, w: number) => {
    const cw = Math.max(MIN_W, Math.min(MAX_W, w));
    const ch = (cw * FRAME.h) / FRAME.w;
    const cx = Math.max(-MARGIN, Math.min(x, FRAME.w + MARGIN - cw));
    const cy = Math.max(-MARGIN, Math.min(y, FRAME.h + MARGIN - ch));
    vbRef.current = { x: cx, y: cy, w: cw, h: ch };
    setVb(vbRef.current);
  }, []);

  const zoomAt = useCallback(
    (f: number, cx: number, cy: number) => {
      const v = vbRef.current;
      apply(cx - (cx - v.x) / f, cy - (cy - v.y) / f, v.w / f);
    },
    [apply]
  );

  const zoomStep = useCallback(
    (f: number) => {
      const v = vbRef.current;
      zoomAt(f, v.x + v.w / 2, v.y + v.h / 2);
    },
    [zoomAt]
  );

  const reset = useCallback(() => apply(0, 0, FRAME.w), [apply]);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;

    // client point -> user-space point, honouring preserveAspectRatio="xMidYMid meet"
    const scaleOf = (r: DOMRect) => Math.min(r.width / vbRef.current.w, r.height / vbRef.current.h);
    const pt = (clientX: number, clientY: number) => {
      const r = svg.getBoundingClientRect();
      const v = vbRef.current;
      const sc = scaleOf(r);
      const ox = (r.width - v.w * sc) / 2;
      const oy = (r.height - v.h * sc) / 2;
      return { x: v.x + (clientX - r.left - ox) / sc, y: v.y + (clientY - r.top - oy) / sc, sc };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = pt(e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y);
    };
    const onDbl = (e: MouseEvent) => {
      const p = pt(e.clientX, e.clientY);
      zoomAt(1.6, p.x, p.y);
    };

    const ptrs = new Map<number, { x: number; y: number }>();
    let panStart: { cx: number; cy: number; vx: number; vy: number; sc: number } | null = null;
    let pinchD = 0;

    const onDown = (e: PointerEvent) => {
      svg.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) {
        const v = vbRef.current;
        panStart = { cx: e.clientX, cy: e.clientY, vx: v.x, vy: v.y, sc: pt(e.clientX, e.clientY).sc };
      }
      if (ptrs.size === 2) {
        const a = [...ptrs.values()];
        pinchD = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        panStart = null;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1 && panStart) {
        apply(
          panStart.vx - (e.clientX - panStart.cx) / panStart.sc,
          panStart.vy - (e.clientY - panStart.cy) / panStart.sc,
          vbRef.current.w
        );
      } else if (ptrs.size === 2) {
        const a = [...ptrs.values()];
        const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        if (pinchD > 0 && Math.abs(d - pinchD) > 2) {
          const p = pt((a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2);
          zoomAt(d / pinchD, p.x, p.y);
          pinchD = d;
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      ptrs.delete(e.pointerId);
      panStart = null;
      pinchD = 0;
    };

    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('dblclick', onDbl);
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);

    const measure = () => setUnitPx(scaleOf(svg.getBoundingClientRect()));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(svg);

    return () => {
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('dblclick', onDbl);
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointercancel', onUp);
      ro.disconnect();
    };
  }, [ref, apply, zoomAt]);

  // the rendered scale changes with the viewBox too, not only with the element size
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    setUnitPx(Math.min(r.width / vb.w, r.height / vb.h));
  }, [ref, vb]);

  return {
    viewBox: `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`,
    unitPx,
    zoomStep,
    reset,
  };
}
