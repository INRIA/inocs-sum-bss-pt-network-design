import type { KeyboardEvent } from 'react';
import { C_REGULAR, C_TRANSFER } from '../../glyphs';
import { useMapView } from '../MapContext';

export interface Candidate {
  id: string;
  x: number;
  y: number;
  transfer: boolean;
}

interface Props {
  candidates: Candidate[];
  onToggle?: (id: string) => void;
  label: (c: Candidate) => string;
}

/**
 * The free candidate positions the visitor can place a station on (plan-technical.md §C.3, ux
 * B.3). Placement itself is driven by `MapFrame`'s `onTap` plus a hit test in
 * `domain/placement/hitTest.ts` — pointer capture on the SVG means a child `onClick` here would
 * not fire reliably. The per-candidate handler below is for KEYBOARD use only (Enter/Space), so
 * the game works without a pointer.
 */
export default function CandidatesLayer({ candidates, onToggle, label }: Props) {
  const { unitPx } = useMapView();
  // a 22 screen-px hit target, converted to map units at the current zoom, never below the marker
  const hitR = Math.max(1.6, 22 / unitPx);

  const onKeyDown = (id: string) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    onToggle?.(id);
  };

  return (
    <g className="candidates">
      {candidates.map((c) => {
        const color = c.transfer ? C_TRANSFER : C_REGULAR;
        return (
          <g
            key={c.id}
            transform={`translate(${c.x},${c.y})`}
            tabIndex={0}
            role="button"
            aria-label={label(c)}
            onKeyDown={onKeyDown(c.id)}
          >
            <circle r={1.6} fill="#fff" stroke={color} strokeWidth={0.5} />
            <circle r={hitR} fill="transparent" />
          </g>
        );
      })}
    </g>
  );
}
