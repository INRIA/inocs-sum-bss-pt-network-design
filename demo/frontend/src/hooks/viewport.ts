/**
 * viewport.ts — the four layouts of plan-technical §B.1, as a pure function.
 *
 * Breakpoints: under 640 phone, 640 to 980 tablet, 981 and up desktop; a
 * landscape phone (height 500 or less, wider than tall) gets the side-panel
 * layout instead of the bottom sheet; "short" is the existing compact-desktop
 * rule (981 wide and up, under 820 high).
 */
export type Viewport = 'phone' | 'phone-landscape' | 'tablet' | 'desktop';

export const PHONE_MAX = 639;
export const TABLET_MAX = 980;
export const LANDSCAPE_MAX_HEIGHT = 500;
export const SHORT_MAX_HEIGHT = 819;

export interface ViewportState {
  readonly viewport: Viewport;
  /** A desktop with little vertical room: tighter tiles, shorter chart. */
  readonly short: boolean;
}

/** Media queries `useViewport` subscribes to. Classification stays below. */
export const VIEWPORT_QUERIES: readonly string[] = [
  `(max-width: ${PHONE_MAX}px)`,
  `(min-width: ${PHONE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`,
  `(min-width: ${TABLET_MAX + 1}px)`,
  `(max-height: ${LANDSCAPE_MAX_HEIGHT}px) and (orientation: landscape)`,
  `(min-width: ${TABLET_MAX + 1}px) and (max-height: ${SHORT_MAX_HEIGHT}px)`,
];

export function classifyViewport(width: number, height: number): ViewportState {
  const desktop = width > TABLET_MAX;
  const landscape = width > height && height <= LANDSCAPE_MAX_HEIGHT;
  const viewport: Viewport = desktop
    ? 'desktop'
    : landscape
      ? 'phone-landscape'
      : width > PHONE_MAX
        ? 'tablet'
        : 'phone';
  return { viewport, short: desktop && height <= SHORT_MAX_HEIGHT };
}

/** What the server renders, and what a client without `window` keeps. */
export const SSR_VIEWPORT: ViewportState = { viewport: 'desktop', short: false };
