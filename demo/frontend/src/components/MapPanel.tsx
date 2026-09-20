import { useState } from 'react';
import MapFrame, { type FrameView } from './map/frame/MapFrame';
import { stationR } from './map/layers/StationsLayer';
import { AdvancedLayers, AdvancedPois, type MapKind } from './map/AdvancedLayers';
import { LayerToggles } from './Legend';
import NetFacts from './NetFacts';
import { C_TRANSFER } from './glyphs';
import type { GameData, Lang, LayerKey, Layers, ScenarioData, Weekday } from '../lib/types';
import type { T } from '../lib/i18n';
import { fmtEur, hlabel } from '../lib/format';
import { scenName } from '../lib/scen';

export { stationR };

/**
 * The right column (ux-plan-v2 sections 4 and 6): ONE map instance for the whole game, framed by
 * two thin legend bars whose every item is a layer toggle. Once a plan is built, everything the
 * solution adds — the capacity / bikes-in-stock read-outs, the period control and the "what you
 * built" facts — lives in a results box floating OVER the map on its right side (about 30 % of
 * the map width), opened and closed from the "Optimized network results" button at the bottom
 * right, so the map itself never loses height to them. Below 980px the card goes full-bleed, the
 * bars and the box hide, and the same toggles move into the "Layers" popover behind the chip.
 *
 * This component is mounted once at Game level and never unmounted, which is what makes the
 * pan/zoom camera, the layer state and the box state survive every step change.
 *
 * Built on `MapFrame` (plan-technical.md §C.3), which owns the SVG ref, the pan/zoom camera and
 * the zoom buttons: this component only decides what fills the frame's slots and layers, the same
 * composition `CityMap` used to own. Byte-identical to the pre-refactor markup — pinned by
 * `cityMap.guard.test.tsx`'s `mappanel-network` snapshot.
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
  const [resOpen, setResOpen] = useState(true);

  const toggles = (group: 'pt' | 'bike' | 'readouts') => (
    <LayerToggles
      group={group}
      kind={kind}
      map={data.map}
      t={t}
      layers={layers}
      onToggle={onToggleLayer}
      stations={scenario?.stations}
    />
  );

  const showNet = kind === 'network' && !!scenario?.stations.length;
  // one control per inventory snapshot the model wrote (period boundaries: 06h / 10h / 16h / 22h)
  const snapshots = scenario?.stations[0]?.inventory.length ?? 0;
  const hours = scenario?.periodHours ?? [];
  const plabel = (i: number) => (hours[i] != null ? hlabel(hours[i]) : `P${i + 1}`);

  const periodSeg = (
    <div className="seg" role="group" aria-label={t('map.period')}>
      {Array.from({ length: snapshots }, (_, i) => (
        <button key={i} aria-pressed={period === i} onClick={() => onPeriod(i)}>
          {plabel(i)}
        </button>
      ))}
    </div>
  );

  // what the number beside each station means, given which read-outs are on (CityMap.tsx)
  const labelNote =
    layers.capacity && layers.inventory
      ? t('map.label.both')
      : layers.capacity
        ? t('map.label.cap')
        : layers.inventory
          ? t('map.label.inv')
          : null;


  return (
    <MapFrame
      id="map"
      ariaLabel={t(`map.alt.${kind}`)}
      t={t}
      unclipped={<AdvancedPois map={data.map} kind={kind} layers={layers} lang={lang} t={t} />}
      top={
        <>
          <b className="leghead">{t('leg.pt.h')}</b>
          {toggles('pt')}
          {kind === 'city' && (
            <span className="legcap">
              {t('map.cap')} · {t('map.cap2', { zones: data.city.gridCells, stops: data.city.ptStops })}
            </span>
          )}
        </>
      }
      bottom={
        <>
          <b className="leghead">{t('leg.bike.h')}</b>
          {toggles('bike')}
        </>
      }
      overlay={
        showNet && scenario
          ? (view: FrameView) => {
              const tooSmall = 4.2 * view.unitPx < 6;
              return (
                <>
                  <button
                    className="resbtn"
                    onClick={() => setResOpen((o) => !o)}
                    aria-expanded={resOpen}
                    aria-controls="respanel"
                  >
                    <span>{t('map.results.h')}</span>
                    <b aria-hidden="true">{resOpen ? '▾' : '▴'}</b>
                  </button>

                  {resOpen && (
                    <section className="respanel" id="respanel" aria-label={t('map.results.h')}>
                      <div className="reshead">
                        <b>{t('map.results.h')}</b>
                        <button className="resclose" onClick={() => setResOpen(false)} aria-label={t('map.results.hide')}>
                          ×
                        </button>
                      </div>
                      <div className="resname">{scenName(scenario, t)}</div>

                      <NetFacts sc={scenario} t={t} className="resfacts" />
                      <p className="note">
                        {t('map.capex.short', {
                          spent: fmtEur(scenario.paper?.capexUsedEur ?? scenario.capexBudget),
                          budget: fmtEur(scenario.capexBudget),
                        })}
                        {scenario.ranAt && <span className="mono"> · {scenario.ranAt.slice(0, 10)}</span>}
                      </p>

                      <b className="leghead">{t('map.readouts')}</b>
                      <div className="resleg">{toggles('readouts')}</div>
                      <SizeKey stations={scenario.stations} fill={layers.inventory} t={t} />
                      {labelNote && <p className="note">{tooSmall ? t('map.label.zoom') : labelNote}</p>}

                      {snapshots > 1 && (
                        <>
                          <b className="leghead">{t('map.period')}</b>
                          {periodSeg}
                          <p className="note">
                            {layers.inventory ? t('map.period.stock', { h: plabel(period) }) : t('map.period.cap')}
                          </p>
                        </>
                      )}
                    </section>
                  )}
                </>
              );
            }
          : null
      }
      popover={
        <>
          <b className="leghead">{t('leg.pt.h')}</b>
          {toggles('pt')}
          <b className="leghead" style={{ marginTop: 6 }}>
            {t('leg.bike.h')}
          </b>
          {toggles('bike')}
          {showNet && (
            <>
              <b className="leghead" style={{ marginTop: 6 }}>
                {t('map.readouts')}
              </b>
              {toggles('readouts')}
            </>
          )}
          {showNet && snapshots > 1 && (
            <>
              <b className="leghead" style={{ marginTop: 6 }}>
                {t('map.period')}
              </b>
              {periodSeg}
            </>
          )}
          <p className="note">{t('map.attrib')}</p>
        </>
      }
    >
      <AdvancedLayers
        map={data.map}
        kind={kind}
        t={t}
        weekday={weekday}
        hour={hour}
        layers={layers}
        stations={scenario?.stations}
        period={period}
        dropKey={dropKey}
      />
    </MapFrame>
  );
}

/**
 * The size key of the capacity circle: smallest, median and largest station of THIS plan, drawn
 * with the exact radius formula the map uses, each with its number of docks underneath. The
 * half-fill appears only while the "bikes in stock" layer is on, like on the map.
 */
function SizeKey({ stations, fill, t }: { stations: ScenarioData['stations']; fill: boolean; t: T }) {
  const caps = [...new Set(stations.map((s) => s.capacity))].sort((a, b) => a - b);
  if (!caps.length) return null;
  const pick = [caps[0], caps[Math.floor(caps.length / 2)], caps[caps.length - 1]].filter((c, i, a) => a.indexOf(c) === i);
  const k = 1.9; // px per map unit, roughly the default desktop zoom
  const rmax = stationR(pick[pick.length - 1]) * k;
  const w = pick.reduce((acc, c) => acc + stationR(c) * 2 * k + 14, 0);
  let x = 4;
  return (
    <div className="sizekey">
      <svg width={w} height={rmax * 2 + 20} aria-hidden="true">
        {pick.map((c) => {
          const r = stationR(c) * k;
          const cx = x + r;
          x += r * 2 + 14;
          return (
            <g key={c}>
              <circle cx={cx} cy={rmax + 2} r={r} fill="#fff" stroke={C_TRANSFER} strokeWidth={1} />
              {fill && <circle cx={cx} cy={rmax + 2} r={r * 0.7} fill={C_TRANSFER} opacity={0.5} />}
              <text x={cx} y={rmax * 2 + 15} textAnchor="middle" className="axlbl">
                {c}
              </text>
            </g>
          );
        })}
      </svg>
      <span>{t('leg.docks')}</span>
    </div>
  );
}
