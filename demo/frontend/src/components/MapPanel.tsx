import { useRef, useState } from 'react';
import CityMap, { type MapKind } from './CityMap';
import { LayerToggles } from './Legend';
import NetFacts from './NetFacts';
import type { GameData, Lang, LayerKey, Layers, ScenarioData, Weekday } from '../lib/types';
import type { T } from '../lib/i18n';
import { usePanZoom } from '../lib/usePanZoom';
import { fmtEur } from '../lib/format';
import type { SheetKind } from './Sheet';

/**
 * The right column (ux-plan-v2 sections 4 and 6): ONE map instance for the whole game, framed by
 * two legend bars whose every item is a layer toggle, with the "what you built" net panel under it
 * on step D. Below 980px the card goes full-bleed, the bars hide and the same toggles move into
 * the "Layers" popover behind the chip.
 *
 * This component is mounted once at Game level and never unmounted, which is what makes the
 * pan/zoom camera and the layer state survive every step change.
 */
export default function MapPanel({
  data,
  kind,
  t,
  lang,
  weekday,
  hour,
  layers,
  onToggleLayer,
  scenario,
  day,
  dropKey,
  onSheet,
}: {
  data: GameData;
  kind: MapKind;
  t: T;
  lang: Lang;
  weekday: Weekday;
  hour: number;
  layers: Layers;
  onToggleLayer: (k: LayerKey) => void;
  scenario: ScenarioData | undefined;
  day: string;
  dropKey: number;
  onSheet: (s: SheetKind) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const { viewBox, unitPx, zoomStep, reset } = usePanZoom(svgRef);
  const [popOpen, setPopOpen] = useState(false);

  const toggles = (group: 'pt' | 'bike') => (
    <LayerToggles group={group} kind={kind} map={data.map} t={t} layers={layers} onToggle={onToggleLayer} />
  );

  return (
    <div className="mapcard">
      <div className="maplegend maptop">
        <b className="leghead">{t('leg.pt.h')}</b>
        {toggles('pt')}
        {kind === 'city' && (
          <span className="legcap">
            {t('a.mapcap')} · {t('a.mapcap2', { zones: data.city.gridCells, stops: data.city.ptStops })}
          </span>
        )}
      </div>

      <div className="mapwrap">
        <CityMap
          id="map"
          map={data.map}
          kind={kind}
          t={t}
          lang={lang}
          weekday={weekday}
          hour={hour}
          layers={layers}
          stations={scenario?.stations}
          dropKey={dropKey}
          svgRef={svgRef}
          viewBox={viewBox}
          unitPx={unitPx}
        />
      </div>

      <button className="layerchip" onClick={() => setPopOpen((o) => !o)} aria-expanded={popOpen}>
        ◉ <span>{t('map.layers')}</span>
      </button>
      {popOpen && (
        <div className="layerpop">
          <b className="leghead">{t('leg.pt.h')}</b>
          {toggles('pt')}
          <b className="leghead" style={{ marginTop: 6 }}>
            {t('leg.bike.h')}
          </b>
          {toggles('bike')}
          <p className="note">{t('map.attrib')}</p>
        </div>
      )}

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

      <div className="maplegend mapbot">
        <b className="leghead">{t('leg.bike.h')}</b>
        {toggles('bike')}
      </div>

      {kind === 'network' && scenario && (
        <div className="netpanel">
          <NetFacts sc={scenario} day={day} t={t} />
          <div className="dockrow">
            {/* a results folder that does not report capex_spent_eur states the budget alone,
                rather than claiming "0 € spent" */}
            <span className="note">
              {scenario.capexSpent > 0
                ? t('d.capexspent', { a: fmtEur(scenario.capexSpent), b: fmtEur(scenario.capexBudget) })
                : `${t('c.p.capex')}: ${fmtEur(scenario.capexBudget)}`}
            </span>
            {/* rendered only while the results carry the placeholder flag — disappears with zero code change */}
            {scenario.placeholder && (
              <button className="provlink" onClick={() => onSheet({ kind: 'prov' })}>
                {t('d.prov')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
