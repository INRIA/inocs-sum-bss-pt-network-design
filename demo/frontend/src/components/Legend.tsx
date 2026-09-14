import type { ReactNode } from 'react';
import type { LayerKey, Layers, MapData } from '../lib/types';
import type { T } from '../lib/i18n';
import type { MapKind } from './CityMap';
import { BikeSwatch, C_EXISTING, C_REGULAR, C_TRANSFER } from './glyphs';

/**
 * The two legend bars framing the map (ux-plan-v2 section 4.2): every item is a live show/hide
 * toggle for its map layer. A hidden layer's item stays in place at 35% opacity — the bar doubles
 * as the state indicator, so there is no layout shift and no layer buttons anywhere else in the UI.
 *
 * The same two groups fill the mobile "Layers" popover, so the swatch styles must stay shared
 * (see global.css: `.maplegend i, .layerpop i`).
 */
export function LayerToggles({
  group,
  kind,
  map,
  t,
  layers,
  onToggle,
}: {
  group: 'pt' | 'bike';
  kind: MapKind;
  map: MapData;
  t: T;
  layers: Layers;
  onToggle: (k: LayerKey) => void;
}) {
  const item = (key: LayerKey, swatch: ReactNode, label: string) => (
    <button key={key} className="legit" aria-pressed={layers[key]} onClick={() => onToggle(key)}>
      {swatch}
      <span>{label}</span>
    </button>
  );

  if (group === 'bike') {
    return (
      <>
        {item('bike', <BikeSwatch color={C_EXISTING} />, t('leg.bike'))}
        {kind === 'network' && item('transfer', <BikeSwatch color={C_TRANSFER} />, t('leg.transfer'))}
        {kind === 'network' && item('regular', <BikeSwatch color={C_REGULAR} />, t('leg.regular'))}
      </>
    );
  }

  // PT-mode rows come from the real line data, so the legend can never claim a mode the GTFS
  // extract does not contain (ux-plan section 7).
  const modes = [...new Set(map.ptLines.map((l) => l.mode))];
  const colorOf = (mode: string) => [...new Set(map.ptLines.filter((l) => l.mode === mode).map((l) => l.color))];

  return (
    <>
      {kind === 'live' && item('stops', <i style={{ background: '#ff3514' }} />, t('leg.stop'))}
      {kind === 'network' && item('stops', <i style={{ background: '#ff3514', opacity: 0.3 }} />, t('leg.ptdemand'))}
      {modes.map((mode) =>
        item(
          mode,
          mode === 'rail' ? (
            <i className="ln" style={{ background: 'repeating-linear-gradient(90deg,#2E2D29 0 4px,transparent 4px 7px)' }} />
          ) : (
            <span style={{ display: 'inline-flex', gap: 3 }}>
              {colorOf(mode)
                .slice(0, 2)
                .map((c) => (
                  <i key={c} className="ln" style={{ background: c }} />
                ))}
            </span>
          ),
          t(`leg.${mode}`)
        )
      )}
      {item('poi', <i className="poi" />, t('leg.poi'))}
    </>
  );
}
