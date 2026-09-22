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
  /** Stations the trip touches, in order — the static route of the run animation. */
  via?: [number, number][];
  /** The trip combines a bike with a tram or bus: its middle leg is drawn dashed. */
  pt?: boolean;
}

interface Props {
  sprites: TripSprite[];
  /** infinite animation-iteration-count — the Build step's city pulse */
  loop?: boolean;
  radius?: number;
  /**
   * Draw the static route under the sprites (the run animation): the bike legs
   * as a faint line, the public-transport leg of a `pt` trip dashed and
   * lighter. Off by default, so the city pulse keeps exactly the markup it had.
   */
  routes?: boolean;
  /** `demand`: served, reached and potential sprites are drawn red; lost and unreachable ones keep their colour. */
  tone?: 'demand';
}

/**
 * Flows turned into moving sprites (plan-technical.md §C.5): one circle per sprite, animated only
 * by CSS via inline --dx/--dy custom properties (destination minus origin, in map units) so no
 * React state changes per frame. Colours (ux B): served/reached olive, potential grey, lost-* red,
 * unreachable dark grey. A matching, normally-hidden line takes over under
 * prefers-reduced-motion (trips.css).
 */
export default function TripsLayer({ sprites, loop = false, radius = 1.1, routes = false, tone }: Props) {
  return (
    <g className={`${routes ? 'trips trips-routes' : 'trips'}${tone === 'demand' ? ' trips-demand' : ''}`}>
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
        const legs = s.via && s.via.length > 0 ? [s.from, ...s.via, s.to] : [s.from, s.to];
        return (
          <g key={s.id}>
            <circle className={`trip trip-${s.status}`} cx={s.from[0]} cy={s.from[1]} r={radius} style={style} />
            <polyline
              className={`tripline trip-${s.status}${s.pt ? ' trip-pt' : ''}`}
              points={legs.map((p) => `${p[0]},${p[1]}`).join(' ')}
              fill="none"
            />
          </g>
        );
      })}
    </g>
  );
}
