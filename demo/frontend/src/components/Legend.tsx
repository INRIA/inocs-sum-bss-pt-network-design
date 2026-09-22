import type { LayerKey, Layers, MapData, StationMarker } from '../lib/types';
import type { T } from '../lib/i18n';
import type { MapKind } from './CityMap';
import LegendGroup, { type LegendItem } from './map/frame/LegendGroup';
import { BikeSwatch, C_EXISTING, C_REGULAR, C_TRANSFER } from './glyphs';

/**
 * The two legend bars framing the map (ux-plan-v2 section 4.2): every item is a live show/hide
 * toggle for its map layer. A hidden layer's item stays in place at 35% opacity — the bar doubles
 * as the state indicator, so there is no layout shift and no layer buttons anywhere else in the UI.
 *
 * Three groups: `pt` (top bar), `bike` (bottom bar) and `readouts` — the model's two per-period
 * station read-outs, capacity and bikes in stock, which live in the results box over the map.
 * The same groups fill the mobile "Layers" popover, so the swatch styles must stay shared
 * (see global.css: `.maplegend i, .layerpop i`).
 *
 * Built on the generic `LegendGroup` (plan-technical.md §C.3): this only decides which items exist
 * for a given group/kind, and emits the exact same markup as before.
 */
export function LayerToggles({
  group,
  kind,
  map,
  t,
  layers,
  onToggle,
  stations,
}: {
  group: 'pt' | 'bike' | 'readouts';
  kind: MapKind;
  map: MapData;
  t: T;
  layers: Layers;
  onToggle: (k: LayerKey) => void;
  stations?: StationMarker[];
}) {
  if (group === 'readouts') {
    if (kind !== 'network') return null;
    const caps = (stations ?? []).map((s) => s.capacity);
    const range = caps.length ? `${Math.min(...caps)}–${Math.max(...caps)}` : '';
    const items: LegendItem<LayerKey>[] = [
      {
        key: 'capacity',
        label: range ? t('leg.capacity.n', { range }) : t('leg.capacity'),
        swatch: <i style={{ background: '#fff', border: `1px solid ${C_TRANSFER}` }} />,
        pressed: layers.capacity,
      },
      {
        key: 'inventory',
        label: t('leg.inventory'),
        swatch: <i style={{ background: C_TRANSFER, opacity: 0.55 }} />,
        pressed: layers.inventory,
      },
    ];
    return <LegendGroup items={items} onToggle={onToggle} />;
  }

  if (group === 'bike') {
    const items: LegendItem<LayerKey>[] = [
      { key: 'bike', label: t('leg.bike'), swatch: <BikeSwatch color={C_EXISTING} />, pressed: layers.bike },
    ];
    if (kind === 'network') {
      items.push({ key: 'regular', label: t('leg.regular'), swatch: <BikeSwatch color={C_REGULAR} />, pressed: layers.regular });
      items.push({ key: 'transfer', label: t('leg.transfer'), swatch: <BikeSwatch color={C_TRANSFER} />, pressed: layers.transfer });
    }
    return <LegendGroup items={items} onToggle={onToggle} />;
  }

  // PT-mode rows come from the real line data, so the legend can never claim a mode the GTFS
  // extract does not contain (ux-plan section 7).
  const modes = [...new Set(map.ptLines.map((l) => l.mode))];
  const colorOf = (mode: string) => [...new Set(map.ptLines.filter((l) => l.mode === mode).map((l) => l.color))];

  const items: LegendItem<LayerKey>[] = [];
  if (kind === 'live') {
    items.push({ key: 'stops', label: t('leg.stop'), swatch: <i style={{ background: '#ff3514' }} />, pressed: layers.stops });
  }
  if (kind === 'network') {
    items.push({
      key: 'stops',
      label: t('leg.ptdemand'),
      swatch: <i style={{ background: '#ff3514', opacity: 0.3 }} />,
      pressed: layers.stops,
    });
  }
  for (const mode of modes) {
    items.push({
      key: mode as LayerKey,
      label: t(`leg.${mode}`),
      swatch:
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
      pressed: layers[mode as LayerKey],
    });
  }
  items.push({ key: 'poi', label: t('leg.poi'), swatch: <i className="poi" />, pressed: layers.poi });

  return <LegendGroup items={items} onToggle={onToggle} />;
}
