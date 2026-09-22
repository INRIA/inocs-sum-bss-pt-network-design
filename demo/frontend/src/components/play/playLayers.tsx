import { BikeSwatch, C_EXISTING, C_REGULAR, C_TRANSFER } from '../glyphs';
import LegendGroup, { type LegendItem } from '../map/frame/LegendGroup';
import type { MapData } from '../../lib/types';
import type { T } from '../../lib/i18n';

/**
 * The game's own layer keys and legend items.
 *
 * Each mode owns its keys (plan-technical §C.3): the advanced `Layers` type is
 * untouched, and `LegendGroup` is generic over them. The convention of §B.4
 * holds — public transport on top, bikes at the bottom, every item a toggle.
 */
export type PlayLayerKey =
  | 'tram'
  | 'bus'
  | 'rail'
  | 'stops'
  | 'pulse'
  | 'candidates'
  | 'mine'
  /** Step 5: the optimiser's own network. */
  | 'plan'
  /** Step 5: the visitor's stations, kept underneath in grey. */
  | 'ghost';
export type PlayLayers = Record<PlayLayerKey, boolean>;

export const DEFAULT_PLAY_LAYERS: PlayLayers = {
  tram: true,
  bus: true,
  rail: true,
  stops: true,
  pulse: true,
  candidates: true,
  mine: true,
  plan: true,
  ghost: true,
};

/** Which bike items the bottom legend offers. One per step that draws bikes. */
export type BikeLegendMode = 'build' | 'run' | 'optimiser';

export function PtLegend({
  map,
  layers,
  onToggle,
  t,
}: {
  map: MapData;
  layers: PlayLayers;
  onToggle: (key: PlayLayerKey) => void;
  t: T;
}) {
  const modes = [...new Set(map.ptLines.map((line) => line.mode))];
  const items: LegendItem<PlayLayerKey>[] = [
    { key: 'stops', label: t('play.legend.stops'), swatch: <i style={{ background: '#ff3514' }} />, pressed: layers.stops },
  ];
  for (const mode of modes) {
    const color = map.ptLines.find((line) => line.mode === mode)?.color ?? '#004494';
    items.push({
      key: mode,
      label: t(`leg.${mode}`),
      swatch: <i style={{ background: color }} />,
      pressed: layers[mode],
    });
  }
  return <LegendGroup items={items} onToggle={onToggle} />;
}

export function BikeLegend({
  layers,
  onToggle,
  mode,
  t,
}: {
  layers: PlayLayers;
  onToggle: (key: PlayLayerKey) => void;
  mode: BikeLegendMode;
  t: T;
}) {
  const items: LegendItem<PlayLayerKey>[] = [];
  if (mode === 'optimiser') {
    items.push({
      key: 'plan',
      label: t('play.legend.plan'),
      swatch: <BikeSwatch color={C_REGULAR} />,
      pressed: layers.plan,
    });
    items.push({
      key: 'ghost',
      label: t('play.legend.ghost'),
      swatch: <BikeSwatch color={C_EXISTING} />,
      pressed: layers.ghost,
    });
    return <LegendGroup items={items} onToggle={onToggle} />;
  }
  if (mode === 'build') {
    items.push({
      key: 'candidates',
      label: t('play.legend.candidates'),
      swatch: <i style={{ background: '#fff', border: `1px solid ${C_REGULAR}` }} />,
      pressed: layers.candidates,
    });
  }
  items.push({
    key: 'mine',
    label: t('play.legend.mine'),
    swatch: <BikeSwatch color={C_TRANSFER} />,
    pressed: layers.mine,
  });
  items.push({
    key: 'pulse',
    label: mode === 'run' ? t('play.legend.run') : t('play.legend.pulse'),
    swatch: <i style={{ background: '#d62828', borderRadius: '50%' }} />,
    pressed: layers.pulse,
  });
  return <LegendGroup items={items} onToggle={onToggle} />;
}
