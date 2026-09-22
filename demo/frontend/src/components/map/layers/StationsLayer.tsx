import { BikeGlyph, C_EXISTING, C_REGULAR, C_TRANSFER } from '../../glyphs';
import type { StationMarker } from '../../../lib/types';
import type { T } from '../../../lib/i18n';
import { useMapView } from '../MapContext';

/** Capacity circle radius (map units) for a station with `docks` docks — shared with the size key. */
export const stationR = (docks: number) => 2.2 + Math.sqrt(Math.max(0, docks)) * 0.75;

/** Station number labels are drawn at 4.2 map units; below 6 rendered px they would only be noise. */
const LABEL_UNITS = 4.2;

/** A station the player (or the assistant, on the player's behalf) has placed in the game. */
export interface PlayerStation {
  x: number;
  y: number;
  transfer: boolean;
  /** placed by the assistant rather than the player — drawn with an extra dashed outline */
  assisted?: boolean;
}

/** A station the player placed on an earlier scenario attempt, kept faint for reference. */
export interface GhostStation {
  x: number;
  y: number;
}

interface ShowFlags {
  transfer: boolean;
  regular: boolean;
  capacity: boolean;
  inventory: boolean;
}

type Props =
  | { variant: 'plan'; stations: StationMarker[]; show: ShowFlags; period: number; dropKey: number; t: T }
  | { variant: 'player'; stations: PlayerStation[]; dropKey?: number; bikes?: number | null }
  | { variant: 'ghost'; stations: GhostStation[]; dropKey?: number };

/**
 * One layer, three variants (plan-technical.md §C.3): `plan` is the model's own output — the
 * CityMap station block, moved here verbatim — `player` is the visitor's in-progress layout
 * (haloed glyph, dashed outline when the assistant placed it), `ghost` is a past attempt (grey,
 * unhaloed, dimmed). Only `plan` reads a `show`/`period`/`t`; `player` takes at most one read-out,
 * the model's bikes-per-station badge, and `ghost` none.
 */
export default function StationsLayer(props: Props) {
  const { unitPx } = useMapView();
  const showLabels = LABEL_UNITS * unitPx >= 6;

  if (props.variant === 'plan') {
    const { stations, show, period, dropKey, t } = props;
    return (
      <g key={dropKey}>
        {stations
          .filter((s) => (s.transfer ? show.transfer : show.regular))
          .map((s, i) => {
            const color = s.transfer ? C_TRANSFER : C_REGULAR;
            const r = stationR(s.capacity);
            const inv = s.inventory[period] ?? s.inventory[0] ?? 0;
            const ri = show.capacity
              ? r * Math.sqrt(s.capacity > 0 ? Math.min(1, inv / s.capacity) : 0)
              : stationR(inv);
            const decorated = show.capacity || show.inventory;
            const label =
              show.capacity && show.inventory
                ? `${inv}/${s.capacity}`
                : show.capacity
                  ? `${s.capacity}`
                  : show.inventory
                    ? `${inv}`
                    : null;
            const rShown = show.capacity ? r : ri;
            return (
              <g
                key={i}
                transform={`translate(${s.x},${s.y})`}
                className="drop"
                style={{ animationDelay: `${i * 14}ms` }}
              >
                {show.capacity && <circle r={r} fill="#fff" fillOpacity={0.9} stroke={color} strokeWidth={0.6} />}
                {show.inventory && <circle r={ri} fill={color} opacity={0.5} />}
                <BikeGlyph
                  x={0}
                  y={0}
                  s={decorated ? 0.5 : s.transfer ? 1.1 : 0.85}
                  color={color}
                  halo={!decorated}
                />
                {label && showLabels && (
                  <text
                    x={rShown + 1.2}
                    y={LABEL_UNITS * 0.36}
                    fontFamily='"Spline Sans Mono",monospace'
                    fontSize={LABEL_UNITS}
                    fontWeight={700}
                    fill={color}
                    paintOrder="stroke"
                    stroke="#FFFFFF"
                    strokeWidth={1.6}
                    strokeLinejoin="round"
                  >
                    {label}
                  </text>
                )}
                <title>{`${s.transfer ? t('leg.transfer') : t('leg.regular')} — ${s.capacity} ${t(
                  'leg.docks'
                )}, ${inv} ${t('leg.bikes')}`}</title>
              </g>
            );
          })}
      </g>
    );
  }

  if (props.variant === 'player') {
    // `bikes` is the model's own bikes-per-station figure for the chosen budget
    // (`optimiserFacts.bikesPerStation`): ONE number for the whole plan, so every
    // station carries the same badge — the game never sizes a visitor's station.
    const badge = props.bikes != null ? String(Math.round(props.bikes)) : null;
    return (
      <g key={props.dropKey}>
        {props.stations.map((s, i) => {
          const color = s.transfer ? C_TRANSFER : C_REGULAR;
          return (
            <g key={i} transform={`translate(${s.x},${s.y})`}>
              {s.assisted && (
                <circle r={7} fill="none" stroke={color} strokeWidth={1} strokeDasharray="2 2" />
              )}
              <BikeGlyph x={0} y={0} s={0.85} color={color} halo />
              {badge && showLabels && (
                <text
                  x={4}
                  y={LABEL_UNITS * 0.36}
                  fontFamily='"Spline Sans Mono",monospace'
                  fontSize={LABEL_UNITS}
                  fontWeight={700}
                  fill={color}
                  paintOrder="stroke"
                  stroke="#FFFFFF"
                  strokeWidth={1.6}
                  strokeLinejoin="round"
                >
                  {badge}
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  }

  return (
    <g key={props.dropKey} opacity={0.6}>
      {props.stations.map((s, i) => (
        <BikeGlyph key={i} x={s.x} y={s.y} s={0.85} color={C_EXISTING} />
      ))}
    </g>
  );
}
