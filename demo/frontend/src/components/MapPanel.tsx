import { useRef, useState } from 'react';
import CityMap, { type MapKind } from './CityMap';
import { LayerToggles } from './Legend';
import NetFacts from './NetFacts';
import type { GameData, Lang, LayerKey, Layers, ScenarioData, Weekday } from '../lib/types';
import type { T } from '../lib/i18n';
import { usePanZoom } from '../lib/usePanZoom';
import { fmtEur, hlabel } from '../lib/format';
import { scenName } from '../lib/scen';

/**
 * The right column (ux-plan-v2 sections 4 and 6): ONE map instance for the whole game, framed by
 * two legend bars whose every item is a layer toggle, with the period control and the "what you
 * built" net panel under it once a plan is built. Below 980px the card goes full-bleed, the bars
 * hide and the same toggles move into the "Layers" popover behind the chip.
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
  period,
  onPeriod,
  dropKey,
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
  period: number;
  onPeriod: (p: number) => void;
  dropKey: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const { viewBox, unitPx, zoomStep, reset } = usePanZoom(svgRef);
  const [popOpen, setPopOpen] = useState(false);

  const toggles = (group: 'pt' | 'bike') => (
    <LayerToggles group={group} kind={kind} map={data.map} t={t} layers={layers} onToggle={onToggleLayer} />
  );

  const showNet = kind === 'network' && scenario?.stations.length;
  // one control per inventory snapshot the model wrote (period boundaries: 06h / 10h / 16h / 22h)
  const snapshots = scenario?.stations[0]?.inventory.length ?? 0;
  const hours = scenario?.periodHours ?? [];

  return (
    <div className="mapcard">
      <div className="maplegend maptop">
        <b className="leghead">{t('leg.pt.h')}</b>
        {toggles('pt')}
        {kind === 'city' && (
          <span className="legcap">
            {t('map.cap')} · {t('map.cap2', { zones: data.city.gridCells, stops: data.city.ptStops })}
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
          period={period}
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
          {showNet && snapshots > 1 && (
            <>
              <b className="leghead" style={{ marginTop: 6 }}>
                {t('map.period')}
              </b>
              <div className="seg">
                {Array.from({ length: snapshots }, (_, i) => (
                  <button key={i} aria-pressed={period === i} onClick={() => onPeriod(i)}>
                    {hours[i] != null ? hlabel(hours[i]) : `P${i + 1}`}
                  </button>
                ))}
              </div>
            </>
          )}
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

      {showNet && scenario && (
        <>
          {snapshots > 1 && (
            <div className="perctl">
              <span className="leghead">{t('map.period')}</span>
              <span className="seg" role="group" aria-label={t('map.period')}>
                {Array.from({ length: snapshots }, (_, i) => (
                  <button key={i} aria-pressed={period === i} onClick={() => onPeriod(i)}>
                    {hours[i] != null ? hlabel(hours[i]) : `P${i + 1}`}
                  </button>
                ))}
              </span>
              <span className="note">
                {layers.inventory
                  ? t('map.period.stock', { h: hours[period] != null ? hlabel(hours[period]) : `P${period + 1}` })
                  : t('map.period.cap')}
              </span>
            </div>
          )}
          <div className="netpanel">
            <NetFacts sc={scenario} t={t} />
            <div className="dockrow">
              <span className="note">
                {t('map.capex', {
                  name: scenName(scenario, t),
                  spent: fmtEur(scenario.paper?.capexUsedEur ?? scenario.capexBudget),
                  budget: fmtEur(scenario.capexBudget),
                })}
              </span>
              {scenario.ranAt && <span className="note mono">{scenario.ranAt.slice(0, 10)}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
