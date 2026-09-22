import { FRAME } from '../../../lib/geo';
import type { Lang, MapData } from '../../../lib/types';
import type { T } from '../../../lib/i18n';
import { Glyph } from '../../glyphs';

/**
 * POI labels sit on REAL coordinates, so two landmarks can end up 200 m apart (University /
 * Plainpalais). Greedy placement: prefer below the marker, flip above when that box would collide
 * with an already-placed label. Deterministic — same output on the server and in the browser.
 */
function placeLabels(pois: MapData['pois'], t: T, poiScale: number) {
  const R = 11.5 * poiScale;
  const fs = 9.6 * Math.max(0.86, poiScale);
  const boxes: [number, number, number, number][] = [];
  const hits = (b: [number, number, number, number]) =>
    boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);

  return pois.map((p) => {
    const w = t(`poi.${p.glyph}`).length * fs * 0.52;
    const below: [number, number, number, number] = [p.x - w / 2, p.y + R + 5, p.x + w / 2, p.y + R + 5 + fs];
    const above: [number, number, number, number] = [p.x - w / 2, p.y - R - 7 - fs, p.x + w / 2, p.y - R - 7];
    const clipped = below[3] > FRAME.h - 1; // a label below the frame would be cut off
    const up = (clipped || hits(below)) && !hits(above);
    boxes.push(up ? above : below);
    return { p, up };
  });
}

interface Props {
  pois: MapData['pois'];
  scale: number;
  lang: Lang;
  t: T;
}

/**
 * POI markers and their greedily-placed labels — rendered OUTSIDE the map's clip (by the caller,
 * via `MapCanvas`'s `unclipped` slot) so an edge landmark keeps its full label.
 */
export default function PoiLayer({ pois, scale, lang, t }: Props) {
  return (
    <g>
      {placeLabels(pois, t, scale).map(({ p, up }) => {
        const R = 11.5 * scale;
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
              fontSize={(9.6 * Math.max(0.86, scale)).toFixed(1)}
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
  );
}
