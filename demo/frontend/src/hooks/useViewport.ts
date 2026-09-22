/**
 * useViewport.ts — which of the four layouts of plan-technical §B.1 applies.
 *
 * `matchMedia` drives the subscription; the classification itself is the pure
 * function in `viewport.ts`, so the breakpoints are unit-tested without a DOM.
 * The SSR default is `desktop` and not short, which is what the server renders
 * and therefore what the first client render must agree with.
 */
import { useEffect, useState } from 'react';

import { SSR_VIEWPORT, VIEWPORT_QUERIES, classifyViewport, type ViewportState } from './viewport';

export type { Viewport, ViewportState } from './viewport';

export function useViewport(): ViewportState {
  const [state, setState] = useState<ViewportState>(SSR_VIEWPORT);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const read = (): void => {
      setState((previous) => {
        const next = classifyViewport(window.innerWidth, window.innerHeight);
        return next.viewport === previous.viewport && next.short === previous.short
          ? previous
          : next;
      });
    };
    read();
    const lists = VIEWPORT_QUERIES.map((query) => window.matchMedia(query));
    for (const list of lists) list.addEventListener('change', read);
    // A soft keyboard or a rotation changes the height without crossing a
    // width query, so the resize event is watched too.
    window.addEventListener('resize', read);
    window.addEventListener('orientationchange', read);
    return () => {
      for (const list of lists) list.removeEventListener('change', read);
      window.removeEventListener('resize', read);
      window.removeEventListener('orientationchange', read);
    };
  }, []);

  return state;
}
