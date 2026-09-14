import type { ReactNode } from 'react';
import type { GlyphKey } from '../lib/types';

/**
 * Hand-drawn POI glyphs — deliberately NOT emoji (unpredictable SVG rendering across browsers,
 * ux-plan section 7). Each glyph is drawn in a 1x-scaled local frame centred on 0,0.
 */
const B = '#004494';

/** Bike-station colours (ux-plan-v2 section 4.1) — one glyph, colour = role. */
export const C_EXISTING = '#949C93';
export const C_TRANSFER = '#004494';
/** SUM green, deepened so the line icon stays legible on the grey basemap. */
export const C_REGULAR = '#6B9410';

/** The two wheels + frame of the tiny line-drawn bike, in its own 1x frame centred on 0,0. */
const BIKE_PATH = 'M-3.1,1.7 L-1.2,-1.5 L1.7,-1.5 L3.1,1.7 M-1.2,-1.5 L0.3,1.7 M-2,-2.6 L-0.6,-2.6 M1.7,-1.5 L2.5,-2.8';

/**
 * One tiny bike glyph for every bike station on the map (ux-plan-v2 section 4.1).
 * Nested translate -> drop-animation wrapper -> scale, so the drop animation never fights the
 * positioning transform. `dot` degrades the glyph to a plain dot when it would render below ~3px
 * (v2 section 6, note 2) — the bikes come back as the player zooms in.
 */
export function BikeGlyph({
  x,
  y,
  s,
  color,
  halo = false,
  drop = false,
  delay,
  dot = false,
  children,
}: {
  x: number;
  y: number;
  s: number;
  color: string;
  halo?: boolean;
  drop?: boolean;
  delay?: string;
  dot?: boolean;
  children?: ReactNode;
}) {
  return (
    <g transform={`translate(${x},${y})`}>
      <g className={drop ? 'drop' : undefined} style={drop && delay ? { animationDelay: delay } : undefined}>
        {dot ? (
          <g>
            <circle r={1.7 * (s / 0.5)} fill={color} />
            {children}
          </g>
        ) : (
          <g
            transform={`scale(${s})`}
            fill="none"
            stroke={color}
            strokeWidth={1.15}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {halo && <circle r={6} fill="#fff" stroke="none" opacity={0.88} />}
            <circle cx={-3.1} cy={1.7} r={2} />
            <circle cx={3.1} cy={1.7} r={2} />
            <path d={BIKE_PATH} />
            {children}
          </g>
        )}
      </g>
    </g>
  );
}

/** The same glyph inline, for the legend bars and the mobile layers popover — map and legend must match. */
export function BikeSwatch({ color }: { color: string }) {
  return (
    <svg width="15" height="11" viewBox="-7.5 -5.5 15 11" aria-hidden="true">
      <g fill="none" stroke={color} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx={-3.1} cy={1.7} r={2} />
        <circle cx={3.1} cy={1.7} r={2} />
        <path d={BIKE_PATH} />
      </g>
    </svg>
  );
}

export function Glyph({ g }: { g: GlyphKey }) {
  switch (g) {
    case 'rail':
      return (
        <g>
          <rect x={-3.2} y={-4.4} width={6.4} height={6.6} rx={1.4} fill={B} />
          <rect x={-2} y={-3.2} width={4} height={2.4} rx={0.5} fill="#fff" />
          <path d="M-2,2.4 L-3.4,4.6 M2,2.4 L3.4,4.6" stroke={B} strokeWidth={1.3} strokeLinecap="round" fill="none" />
        </g>
      );
    case 'uni':
      return (
        <g>
          <path d="M0,-4 L6.2,-1.1 L0,1.8 L-6.2,-1.1 Z" fill={B} />
          <path d="M-3,0.3 L-3,3 Q0,4.9 3,3 L3,0.3" fill="none" stroke={B} strokeWidth={1.4} />
        </g>
      );
    case 'hosp':
      return (
        <g>
          <rect x={-1.5} y={-4.6} width={3} height={9.2} rx={0.8} fill={B} />
          <rect x={-4.6} y={-1.5} width={9.2} height={3} rx={0.8} fill={B} />
        </g>
      );
    case 'land':
      return <path d="M0,4.8 C-3.3,1.6 -3.3,-1.8 0,-4.8 C3.3,-1.8 3.3,1.6 0,4.8 Z" fill={B} />;
    case 'mkt':
      return (
        <g>
          {[
            [-3.6, -3.6],
            [0.8, -3.6],
            [-3.6, 0.8],
            [0.8, 0.8],
          ].map(([x, y], i) => (
            <rect key={i} x={x} y={y} width={2.8} height={2.8} rx={0.6} fill={B} />
          ))}
        </g>
      );
    case 'old':
    default:
      return (
        <g>
          <path d="M0,-5.2 L4.6,-0.6 L4.6,4.6 L-4.6,4.6 L-4.6,-0.6 Z" fill={B} />
          <rect x={-1.3} y={1.2} width={2.6} height={3.4} rx={1.3} fill="#fff" />
        </g>
      );
  }
}
