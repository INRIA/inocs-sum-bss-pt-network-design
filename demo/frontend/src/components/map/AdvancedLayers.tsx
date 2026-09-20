import type { Lang, Layers, MapData, StationMarker, Weekday } from '../../lib/types';
import type { T } from '../../lib/i18n';
import { C_EXISTING } from '../glyphs';
import BaseLayer from './layers/BaseLayer';
import PtLinesLayer from './layers/PtLinesLayer';
import ExistingBikesLayer from './layers/ExistingBikesLayer';
import PtDemandLayer from './layers/PtDemandLayer';
import StationsLayer from './layers/StationsLayer';
import PoiLayer from './layers/PoiLayer';

/** The three views of the full demo: the city, the live day, and a built network. */
export type MapKind = 'city' | 'live' | 'network';

export interface AdvancedLayersProps {
  map: MapData;
  kind: MapKind;
  t: T;
  weekday: Weekday;
  hour: number;
  layers: Layers;
  stations?: StationMarker[];
  period?: number;
  dropKey?: number;
}

/**
 * The full demo's composition of map layers: the ONE place where a view `kind` and the legend
 * toggles are translated into explicit layer props (what is drawn, how faded, at what scale).
 * Both `MapPanel` (the live page) and `CityMap` (the bare map pinned by the markup guard) render
 * this, so the rule cannot drift between them. Fragments add no markup.
 */
export function AdvancedLayers({ map, kind, t, weekday, hour, layers, stations, period = 0, dropKey = 0 }: AdvancedLayersProps) {
  const faint = kind === 'network';
  return (
    <>
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
    </>
  );
}

/** Landmarks are drawn outside the clip so an edge landmark keeps its full label. */
export function AdvancedPois({ map, kind, layers, lang, t }: { map: MapData; kind: MapKind; layers: Layers; lang: Lang; t: T }) {
  if (!layers.poi) return null;
  return <PoiLayer pois={map.pois} scale={kind === 'network' ? 0.82 : 1} lang={lang} t={t} />;
}
