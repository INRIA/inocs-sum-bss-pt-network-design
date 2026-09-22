import type { ReactNode, RefObject } from 'react';
import { FRAME } from '../../lib/geo';
import { MapViewProvider } from './MapContext';

interface Props {
  svgRef: RefObject<SVGSVGElement | null>;
  viewBox: string;
  ariaLabel: string;
  clipId: string;
  unitPx: number;
  children: ReactNode;
  /** rendered after the clip and the dashed frame — POI labels, e.g., so an edge landmark keeps its full label */
  unclipped?: ReactNode;
}

/**
 * The bare SVG (plan-technical.md §C.3): the element, its viewBox (the pan/zoom camera owned by
 * usePanZoom), the clip and the dashed frame circle. It knows nothing about kinds or scenarios —
 * layers are composed by the caller and receive the same `MapView` context this used to compute
 * inline (unitPx, clip id).
 */
export default function MapCanvas({ svgRef, viewBox, ariaLabel, clipId, unitPx, children, unclipped }: Props) {
  return (
    <svg ref={svgRef} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label={ariaLabel}>
      <defs>
        <clipPath id={clipId}>
          <circle cx={FRAME.cx} cy={FRAME.cy} r={FRAME.r} />
        </clipPath>
      </defs>

      <MapViewProvider value={{ unitPx, clipId }}>
        <g clipPath={`url(#${clipId})`}>{children}</g>

        <circle cx={FRAME.cx} cy={FRAME.cy} r={FRAME.r - 1} fill="none" stroke="#B7BCB5" strokeWidth={1} strokeDasharray="2 5" />

        {unclipped}
      </MapViewProvider>
    </svg>
  );
}
