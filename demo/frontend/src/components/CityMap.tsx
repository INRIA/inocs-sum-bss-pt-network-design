import type { RefObject } from 'react';
import type { Lang, Layers, MapData, StationMarker, Weekday } from '../lib/types';
import type { T } from '../lib/i18n';
import MapCanvas from './map/MapCanvas';
import { bubbleR } from './map/layers/PtDemandLayer';
import { stationR } from './map/layers/StationsLayer';
import { AdvancedLayers, AdvancedPois, type MapKind } from './map/AdvancedLayers';

export type { MapKind };
export { bubbleR, stationR };

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
  const clip = `${id}-clip`;

  return (
    <MapCanvas
      svgRef={svgRef}
      viewBox={viewBox}
      ariaLabel={t(`map.alt.${kind}`)}
      clipId={clip}
      unitPx={unitPx}
      unclipped={<AdvancedPois map={map} kind={kind} layers={layers} lang={lang} t={t} />}
    >
      <AdvancedLayers
        map={map}
        kind={kind}
        t={t}
        weekday={weekday}
        hour={hour}
        layers={layers}
        stations={stations}
        period={period}
        dropKey={dropKey}
      />
    </MapCanvas>
  );
}
