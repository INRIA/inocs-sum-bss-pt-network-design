import { useEffect, useRef, useState, type RefObject, type ReactNode } from 'react';
import MapCanvas from '../MapCanvas';
import { usePanZoom } from '../../../lib/usePanZoom';
import type { T } from '../../../lib/i18n';

/** What a chrome slot may need besides its own props — currently just the camera's px/unit scale. */
export interface FrameView {
  unitPx: number;
}

/**
 * The camera, handed back to the parent through `controlsRef`.
 *
 * Only the game uses it: an ambiguous tap must zoom in ON THE TAP and place
 * nothing (ux B.3), which no slot or prop can express. Additive — the frame
 * still owns the camera and renders the same markup without it.
 */
export interface MapControls {
  /** Zoom by `factor` about a point in MAP units. */
  zoomAt(x: number, y: number, factor: number): void;
  zoomStep(factor: number): void;
  reset(): void;
}

/** A slot is either fixed content or a function of the current frame view (render-prop variant). */
export type FrameSlot = ReactNode | ((view: FrameView) => ReactNode);

function renderSlot(slot: FrameSlot | undefined, view: FrameView): ReactNode {
  if (slot == null) return null;
  return typeof slot === 'function' ? slot(view) : slot;
}

interface Props {
  id: string;
  ariaLabel: string;
  t: T;
  /** top legend bar (ux-plan-v2 §4.2) */
  top?: FrameSlot;
  /** bottom legend bar */
  bottom?: FrameSlot;
  /** floats over the map, e.g. the closable results box */
  overlay?: FrameSlot;
  /** content of the mobile "Layers" popover behind the chip; the chip/open-state is owned here */
  popover?: FrameSlot;
  /** rendered after the clip and the dashed frame, outside it — e.g. POI labels */
  unclipped?: ReactNode;
  /** fired on pointer-up when a tap (not a drag) is detected on the map */
  onTap?: (p: { x: number; y: number }) => void;
  /** default true; the game switches this off while placing stations (ux B.3) */
  doubleTapZoom?: boolean;
  /** filled with the camera controls after mount; nothing else reads it */
  controlsRef?: RefObject<MapControls | null>;
  /**
   * Called when the px-per-map-unit scale changes (a zoom or a resize, never a
   * pan). The game needs it to convert its 22 screen-px touch radius into map
   * units; lifting it as an effect keeps pan frames free of parent renders.
   */
  onUnitPx?: (unitPx: number) => void;
  /** the layers drawn on the map */
  children: ReactNode;
}

/**
 * The map chrome (plan-technical.md §C.3): owns the SVG ref, the pan/zoom camera and the zoom
 * buttons, and lays out four slots around the canvas (top/bottom legend bars, an overlay over the
 * map, and the mobile "Layers" popover). It knows nothing about game or scenario state — callers
 * compose their own slot content and layers and decide what a tap means.
 */
export default function MapFrame({
  id,
  ariaLabel,
  t,
  top,
  bottom,
  overlay,
  popover,
  unclipped,
  onTap,
  doubleTapZoom,
  controlsRef,
  onUnitPx,
  children,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const { viewBox, unitPx, zoomStep, zoomAt, reset } = usePanZoom(svgRef, { onTap, doubleTapZoom });

  const unitPxCb = useRef(onUnitPx);
  unitPxCb.current = onUnitPx;
  useEffect(() => {
    unitPxCb.current?.(unitPx);
  }, [unitPx]);

  useEffect(() => {
    if (!controlsRef) return;
    controlsRef.current = { zoomAt: (x, y, factor) => zoomAt(factor, x, y), zoomStep, reset };
    return () => {
      controlsRef.current = null;
    };
  }, [controlsRef, zoomAt, zoomStep, reset]);
  const [popOpen, setPopOpen] = useState(false);
  const view: FrameView = { unitPx };
  const clip = `${id}-clip`;

  return (
    <div className="mapcard">
      <div className="maplegend maptop">{renderSlot(top, view)}</div>

      <div className="mapwrap">
        <MapCanvas svgRef={svgRef} viewBox={viewBox} ariaLabel={ariaLabel} clipId={clip} unitPx={unitPx} unclipped={unclipped}>
          {children}
        </MapCanvas>

        {renderSlot(overlay, view)}
      </div>

      <button className="layerchip" onClick={() => setPopOpen((o) => !o)} aria-expanded={popOpen}>
        ◉ <span>{t('map.layers')}</span>
      </button>
      {popOpen && <div className="layerpop">{renderSlot(popover, view)}</div>}

      <div className="mapzoom">
        <button onClick={() => zoomStep(1.35)} aria-label={t('map.zin')}>
          +
        </button>
        <button onClick={() => zoomStep(1 / 1.35)} aria-label={t('map.zout')}>
          −
        </button>
        <button onClick={reset} aria-label={t('map.zreset')}>
          ⌂
        </button>
      </div>

      <div className="maplegend mapbot">{renderSlot(bottom, view)}</div>
    </div>
  );
}
