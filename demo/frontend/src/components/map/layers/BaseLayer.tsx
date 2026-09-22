import { FRAME } from '../../../lib/geo';
import type { MapData } from '../../../lib/types';

interface Props {
  map: MapData;
  /** faint on the network kind (ux-plan section 4) */
  gridOpacity: number;
}

/**
 * Ground, real water, real streets and the H3 study grid — the identical base under every kind
 * (CityMap layers 1-4). No wrapper `<g>`: a Fragment keeps these as direct siblings inside the
 * clipped group, matching the pinned markup.
 */
export default function BaseLayer({ map, gridOpacity }: Props) {
  return (
    <>
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
      <path d={map.grid} stroke="#C9CCC5" fill="none" strokeWidth={0.6} opacity={gridOpacity} />
    </>
  );
}
