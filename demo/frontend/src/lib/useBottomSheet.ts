import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * Mobile bottom sheet (ux-plan-v2 section 6): the left accordion becomes a Google-Maps-style
 * draggable sheet over the map. Height rides on a CSS var (`--sh`) so the desktop grid layout is
 * untouched; the transition is 250ms except while dragging. Snap points peek / half / full;
 * dragging clamps 130px..92vh and releases to the nearest snap; a tap on the handle cycles
 * peek -> half -> full -> half.
 */
export type Snap = 'peek' | 'half' | 'full';

/** The sheet's height at each snap. Exported: the map reserves room under it. */
export const SNAP_HEIGHT: Record<Snap, string> = { peek: '184px', half: '52vh', full: '90vh' };
const CSS = SNAP_HEIGHT;

export const isMobile = () => typeof window !== 'undefined' && window.matchMedia('(max-width:980px)').matches;

export function useBottomSheet(
  sheetRef: RefObject<HTMLElement | null>,
  handleRef: RefObject<HTMLElement | null>
) {
  const pos = useRef<Snap>('half');

  const snapTo = useCallback(
    (name: Snap) => {
      pos.current = name;
      sheetRef.current?.style.setProperty('--sh', CSS[name]);
    },
    [sheetRef]
  );

  useEffect(() => {
    const sheet = sheetRef.current;
    const handle = handleRef.current;
    if (!sheet || !handle) return;

    let startY = 0;
    let startH = 0;
    let drag = false;
    let moved = false;

    const down = (e: PointerEvent) => {
      if (!isMobile()) return;
      drag = true;
      moved = false;
      startY = e.clientY;
      startH = sheet.getBoundingClientRect().height;
      sheet.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const d = startY - e.clientY;
      if (Math.abs(d) > 6) moved = true;
      sheet.style.setProperty('--sh', `${Math.min(window.innerHeight * 0.92, Math.max(130, startH + d))}px`);
    };
    const end = () => {
      if (!drag) return;
      drag = false;
      sheet.classList.remove('dragging');
      if (!moved) {
        // a tap cycles the sheet instead of resizing it
        snapTo(pos.current === 'peek' ? 'half' : pos.current === 'half' ? 'full' : 'half');
        return;
      }
      const cur = sheet.getBoundingClientRect().height;
      const px: Record<Snap, number> = { peek: 184, half: window.innerHeight * 0.52, full: window.innerHeight * 0.9 };
      const nearest = (Object.keys(px) as Snap[]).reduce((a, b) =>
        Math.abs(px[a] - cur) < Math.abs(px[b] - cur) ? a : b
      );
      snapTo(nearest);
    };

    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    return () => {
      handle.removeEventListener('pointerdown', down);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
  }, [sheetRef, handleRef, snapTo]);

  return snapTo;
}
