import type { RefObject } from 'react';
import type { Lang, Layers, MapData, StationMarker, Weekday } from '../lib/types';
import type { T } from '../lib/i18n';
import { C_EXISTING } from './glyphs';
import MapCanvas from './map/MapCanvas';
import BaseLayer from './map/layers/BaseLayer';
import PtLinesLayer from './map/layers/PtLinesLayer';
import ExistingBikesLayer from './map/layers/ExistingBikesLayer';
import PtDemandLayer, { bubbleR } from './map/layers/PtDemandLayer';
import StationsLayer, { stationR } from './map/layers/StationsLayer';
import PoiLayer from './map/layers/PoiLayer';

export type MapKind = 'city' | 'live' | 'network';
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
  const faint = kind === 'network';
  const clip = `${id}-clip`;
  const poiScale = kind === 'network' ? 0.82 : 1;

  return (
    <MapCanvas
      svgRef={svgRef}
      viewBox={viewBox}
      ariaLabel={t(`map.alt.${kind}`)}
      clipId={clip}
      unitPx={unitPx}
      unclipped={layers.poi && <PoiLayer pois={map.pois} scale={poiScale} lang={lang} t={t} />}
    >
      <BaseLayer map={map} gridOpacity={faint ? 0.35 : 0.5} />

      <PtLinesLayer lines={map.ptLines} visible={layers} opacity={faint ? 0.7 : 1} t={t} />

      {layers.bike && <ExistingBikesLayer dots={map.bikeDots} color={C_EXISTING} opacity={faint ? 0.45 : 0.75} />}

      {(kind === 'live' || kind === 'network') && layers.stops && (
        <PtDemandLayer
          stops={map.stops}
          weekday={weekday}
          hour={hour}
          scale={kind === 'network' ? 0.8 : 1}
          opacity={kind === 'network' ? 0.25 : 0.8}
        />
      )}

      {kind === 'network' && stations && (
        <StationsLayer
          variant="plan"
          stations={stations}
          show={{ transfer: layers.transfer, regular: layers.regular, capacity: layers.capacity, inventory: layers.inventory }}
          period={period}
          dropKey={dropKey}
          t={t}
        />
      )}
    </MapCanvas>
  );
}
