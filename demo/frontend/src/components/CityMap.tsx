import type { RefObject } from 'react';
import { FRAME } from '../lib/geo';
import type { Lang, Layers, MapData, StationMarker, Weekday } from '../lib/types';
import type { T } from '../lib/i18n';
import { BikeGlyph, C_EXISTING, C_REGULAR, C_TRANSFER, Glyph } from './glyphs';

export type MapKind = 'city' | 'live' | 'network';

interface Props {
  id: string;
  map: MapData;
  kind: MapKind;
  t: T;
  lang: Lang;
  weekday: Weekday;
  hour: number;
  layers: Layers;
  stations?: StationMarker[];
  /** index of the inventory snapshot the "bikes in stock" layer reads (06h / 10h / 16h / 22h) */
  period?: number;
  /** changes on scenario switch -> replays the station drop-in stagger (ux-plan section 9.4) */
  dropKey?: number;
  svgRef: RefObject<SVGSVGElement | null>;
  /** pan/zoom camera, owned by usePanZoom so the view survives every step change */
  viewBox: string;
  /** px per user unit at the current zoom — drives the micro-bike degradation */
  unitPx: number;
}

/**
 * POI labels sit on REAL coordinates, so two landmarks can end up 200 m apart (University /
 * Plainpalais). Greedy placement: prefer below the marker, flip above when that box would collide
 * with an already-placed label. Deterministic — same output on the server and in the browser.
 */
function placeLabels(map: MapData, t: T, poiScale: number) {
  const R = 11.5 * poiScale;
  const fs = 9.6 * Math.max(0.86, poiScale);
  const boxes: [number, number, number, number][] = [];
  const hits = (b: [number, number, number, number]) =>
    boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);

  return map.pois.map((p) => {
    const w = t(`poi.${p.glyph}`).length * fs * 0.52;
    const below: [number, number, number, number] = [p.x - w / 2, p.y + R + 5, p.x + w / 2, p.y + R + 5 + fs];
    const above: [number, number, number, number] = [p.x - w / 2, p.y - R - 7 - fs, p.x + w / 2, p.y - R - 7];
    const clipped = below[3] > FRAME.h - 1; // a label below the frame would be cut off
    const up = (clipped || hits(below)) && !hits(above);
    boxes.push(up ? above : below);
    return { p, up };
  });
}

/** Bubble radius formula — a design decision, not a physical unit (ux-plan section 2). */
export const bubbleR = (w: number, intensity: number, scale = 1) =>
  Math.max(1.3, (2 + 11 * w) * Math.max(0.18, intensity) * scale);

/** The bike glyph spans ~10.2 user units; under 6 rendered px its wheels stop reading as a bike. */
const GLYPH_UNITS = 10.2;

/** Capacity circle radius (map units) for a station with `docks` docks — shared with the size key. */
export const stationR = (docks: number) => 2.2 + Math.sqrt(Math.max(0, docks)) * 0.75;

/** Station number labels are drawn at 4.2 map units; below 6 rendered px they would only be noise. */
const LABEL_UNITS = 4.2;

/**
 * The single persistent map (ux-plan-v2 section 4). One SVG for the whole game: the element, its
 * viewBox (the pan/zoom camera) and the layer state survive every step change — only `kind`
 * switches what is drawn on top of the identical base.
 */
export default function CityMap({
  id,
  map,
  kind,
  t,
  lang,
  weekday,
  hour,
  layers,
  stations,
  period = 0,
  dropKey = 0,
  svgRef,
  viewBox,
  unitPx,
}: Props) {
  const faint = kind === 'network';
  const clip = `${id}-clip`;
  const poiScale = kind === 'network' ? 0.82 : 1;
  // v2 section 6, note 2: below a rendered size threshold the 139 existing stations become dots
  // again — they turn back into bikes as the player zooms in.
  const microDot = GLYPH_UNITS * 0.5 * unitPx < 6;
  const showLabels = LABEL_UNITS * unitPx >= 6;

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={t(`map.alt.${kind}`)}
    >
      <defs>
        <clipPath id={clip}>
          <circle cx={FRAME.cx} cy={FRAME.cy} r={FRAME.r} />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clip})`}>
        {/* 1. grey city ground */}
        <rect x={0} y={0} width={FRAME.w} height={FRAME.h} fill="#E4E5E2" />

        {/* 2. real water (Lake Geneva, the Rhone, the Arve) — OpenStreetMap, desaturated */}
        {map.water.map((d, i) => (
          <path key={i} d={d} fill="#D4DBDC" />
        ))}

        {/* 3. real street network on top of the water, so the bridges draw themselves */}
        <g stroke="#FAFAF9" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={map.streetsMinor} strokeWidth={1} />
          <path d={map.streetsMajor} strokeWidth={2.2} />
        </g>

        {/* 4. H3 study grid, faint hairlines (real cell geometry) */}
        <path d={map.grid} stroke="#C9CCC5" fill="none" strokeWidth={0.6} opacity={faint ? 0.35 : 0.5} />

        {/* 5. the only coloured base layer: the public-transport network (real GTFS shapes).
               Each mode is an independent layer toggle from the legend bar. */}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={faint ? 0.7 : 1}>
          {map.ptLines
            .filter((l) => layers[l.mode])
            .map((l) => (
              <path
                key={`c${l.line}`}
                d={l.d}
                stroke="#FFFFFF"
                strokeWidth={(l.mode === 'tram' ? 3.4 : 2.6) + 2.6}
                opacity={0.75}
              />
            ))}
          {map.ptLines
            .filter((l) => layers[l.mode])
            .map((l) => (
              <path
                key={l.line}
                d={l.d}
                stroke={l.color}
                strokeWidth={l.mode === 'tram' ? 3.4 : 2.6}
                strokeDasharray={l.mode === 'rail' ? '6 5' : undefined}
              />
            ))}
          {map.ptLines
            .filter((l) => layers[l.mode])
            .map((l) => (
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

        {/* 6. existing bike stations — the same bike glyph, grey, unhaloed (v2 section 4.1) */}
        {layers.bike && (
          <g opacity={faint ? 0.45 : 0.75}>
            {map.bikeDots.map(([x, y], i) => (
              <BikeGlyph key={i} x={x} y={y} s={0.5} color={C_EXISTING} dot={microDot} />
            ))}
          </g>
        )}

        {/* PT demand — SUM red so the pulse jumps off the grey basemap; faded under the network on D */}
        {(kind === 'live' || kind === 'network') && layers.stops && (
          <g>
            {map.stops.map((s) => (
              <circle
                key={s.name}
                cx={s.x}
                cy={s.y}
                r={bubbleR(s.w, (weekday === 'mon' ? s.mon : s.sun)[hour] ?? 0, kind === 'network' ? 0.8 : 1).toFixed(1)}
                fill="#ff3514"
                opacity={kind === 'network' ? 0.25 : 0.8}
              >
                <title>{s.name}</title>
              </circle>
            ))}
          </g>
        )}

        {/* The plan's stations. Regular and transfer are independent layers; on top of the glyph,
            two read-outs the model itself produced: CAPACITY (circle = docks, on by default) and
            BIKES IN STOCK (filled circle = v_{i,t} at the selected period boundary, off by
            default). With capacity off and stock on, the circle is sized by the bikes present.
            The number beside the station spells the read-out(s) out — "bikes / docks" when both
            are on — and hides below the readable zoom, like the glyph degrades to a dot. */}
        {kind === 'network' && stations && (
          <g key={dropKey}>
            {stations
              .filter((s) => (s.transfer ? layers.transfer : layers.regular))
              .map((s, i) => {
                const color = s.transfer ? C_TRANSFER : C_REGULAR;
                const r = stationR(s.capacity);
                const inv = s.inventory[period] ?? s.inventory[0] ?? 0;
                const ri = layers.capacity
                  ? r * Math.sqrt(s.capacity > 0 ? Math.min(1, inv / s.capacity) : 0)
                  : stationR(inv);
                const decorated = layers.capacity || layers.inventory;
                const label =
                  layers.capacity && layers.inventory
                    ? `${inv}/${s.capacity}`
                    : layers.capacity
                      ? `${s.capacity}`
                      : layers.inventory
                        ? `${inv}`
                        : null;
                const rShown = layers.capacity ? r : ri;
                return (
                  <g
                    key={i}
                    transform={`translate(${s.x},${s.y})`}
                    className="drop"
                    style={{ animationDelay: `${i * 14}ms` }}
                  >
                    {layers.capacity && <circle r={r} fill="#fff" fillOpacity={0.9} stroke={color} strokeWidth={0.6} />}
                    {layers.inventory && <circle r={ri} fill={color} opacity={0.5} />}
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
        )}
      </g>

      <circle cx={FRAME.cx} cy={FRAME.cy} r={FRAME.r - 1} fill="none" stroke="#B7BCB5" strokeWidth={1} strokeDasharray="2 5" />

      {/* POIs last and OUTSIDE the clip, so an edge landmark keeps its full label */}
      {layers.poi && (
        <g>
          {placeLabels(map, t, poiScale).map(({ p, up }) => {
            const R = 11.5 * poiScale;
            const label = t(`poi.${p.glyph}`);
            return (
              <g key={p.glyph} transform={`translate(${p.x},${p.y})`}>
                <circle r={R + 2.4} fill="#FFFFFF" opacity={0.85} />
                <circle r={R} fill="#FFFFFF" stroke="#004494" strokeWidth={2.4} />
                <g transform={`scale(${((R / 11.5) * 1.05).toFixed(2)})`}>
                  <Glyph g={p.glyph} />
                </g>
                <text
                  x={0}
                  y={up ? -(R + 7) : R + 13}
                  textAnchor="middle"
                  fontFamily='"Public Sans",sans-serif'
                  fontSize={(9.6 * Math.max(0.86, poiScale)).toFixed(1)}
                  fontWeight={700}
                  fill="#2E2D29"
                  paintOrder="stroke"
                  stroke="#FFFFFF"
                  strokeWidth={3.4}
                  strokeLinejoin="round"
                >
                  {label}
                </text>
                <title>{`${(lang === 'fr' && p.name_fr) || p.name}${p.note ? ` — ${p.note}` : ''}`}</title>
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}
