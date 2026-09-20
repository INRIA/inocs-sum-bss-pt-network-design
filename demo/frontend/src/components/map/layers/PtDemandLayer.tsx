import type { StopBubble, Weekday } from '../../../lib/types';

/** Bubble radius formula — a design decision, not a physical unit (ux-plan section 2). */
export const bubbleR = (w: number, intensity: number, scale = 1) =>
  Math.max(1.3, (2 + 11 * w) * Math.max(0.18, intensity) * scale);

interface Props {
  stops: StopBubble[];
  weekday: Weekday;
  hour: number;
  scale: number;
  opacity: number;
}

/**
 * The PT demand pulse — SUM red so it jumps off the grey basemap; faded under the network kind
 * (CityMap between layers 6 and 7). One bubble per stop, sized by its hourly boarding weight.
 */
export default function PtDemandLayer({ stops, weekday, hour, scale, opacity }: Props) {
  return (
    <g>
      {stops.map((s) => (
        <circle
          key={s.name}
          cx={s.x}
          cy={s.y}
          r={bubbleR(s.w, (weekday === 'mon' ? s.mon : s.sun)[hour] ?? 0, scale).toFixed(1)}
          fill="#ff3514"
          opacity={opacity}
        >
          <title>{s.name}</title>
        </circle>
      ))}
    </g>
  );
}
