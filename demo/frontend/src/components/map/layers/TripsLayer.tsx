import type { CSSProperties } from 'react';
import './trips.css';

export type TripStatus = 'served' | 'reached' | 'potential' | 'lost-no-station' | 'lost-no-stock' | 'unreachable';

export interface TripSprite {
  id: string;
  from: [number, number];
  to: [number, number];
  delayMs: number;
  durationMs: number;
  status: TripStatus;
}

interface Props {
  sprites: TripSprite[];
  /** infinite animation-iteration-count — the Build step's city pulse */
  loop?: boolean;
  radius?: number;
}

/**
 * Flows turned into moving sprites (plan-technical.md §C.5): one circle per sprite, animated only
 * by CSS via inline --dx/--dy custom properties (destination minus origin, in map units) so no
 * React state changes per frame. Colours (ux B): served/reached olive, potential grey, lost-* red,
 * unreachable dark grey. A matching, normally-hidden line takes over under
 * prefers-reduced-motion (trips.css).
 */
export default function TripsLayer({ sprites, loop = false, radius = 1.1 }: Props) {
  return (
    <g className="trips">
      {sprites.map((s) => {
        const dx = s.to[0] - s.from[0];
        const dy = s.to[1] - s.from[1];
        const style = {
          '--dx': dx,
          '--dy': dy,
          animationDelay: `${s.delayMs}ms`,
          animationDuration: `${s.durationMs}ms`,
          animationIterationCount: loop ? 'infinite' : 1,
        } as CSSProperties;
        return (
          <g key={s.id}>
            <circle className={`trip trip-${s.status}`} cx={s.from[0]} cy={s.from[1]} r={radius} style={style} />
            <line className={`tripline trip-${s.status}`} x1={s.from[0]} y1={s.from[1]} x2={s.to[0]} y2={s.to[1]} />
          </g>
        );
      })}
    </g>
  );
}
