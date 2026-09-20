import type { PtLine } from '../../../lib/types';
import type { T } from '../../../lib/i18n';

interface Props {
  lines: PtLine[];
  visible: Record<'tram' | 'bus' | 'rail', boolean>;
  opacity: number;
  /** i18n for the badge titles */
  t: T;
}

/**
 * The public-transport network (real GTFS shapes): white halo, coloured line, badge with the line
 * number — CityMap layer 5. Each mode is an independent toggle from the legend bar.
 */
export default function PtLinesLayer({ lines, visible, opacity, t }: Props) {
  const shown = lines.filter((l) => visible[l.mode]);
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={opacity}>
      {shown.map((l) => (
        <path
          key={`c${l.line}`}
          d={l.d}
          stroke="#FFFFFF"
          strokeWidth={(l.mode === 'tram' ? 3.4 : 2.6) + 2.6}
          opacity={0.75}
        />
      ))}
      {shown.map((l) => (
        <path
          key={l.line}
          d={l.d}
          stroke={l.color}
          strokeWidth={l.mode === 'tram' ? 3.4 : 2.6}
          strokeDasharray={l.mode === 'rail' ? '6 5' : undefined}
        />
      ))}
      {shown.map((l) => (
        <g key={`b${l.line}`}>
          <circle cx={l.badge[0]} cy={l.badge[1]} r={5.8} fill="#fff" stroke={l.color} strokeWidth={1.8} />
          <text
            x={l.badge[0]}
            y={l.badge[1] + 2.6}
            textAnchor="middle"
            fontFamily='"Public Sans",sans-serif'
            fontSize={l.line.length > 2 ? 5.4 : 7}
            fontWeight={700}
            fill={l.color}
          >
            {l.line}
          </text>
          <title>{`${t(`leg.${l.mode}`)} ${l.line}${l.headsign ? ` → ${l.headsign}` : ''}`}</title>
        </g>
      ))}
    </g>
  );
}
