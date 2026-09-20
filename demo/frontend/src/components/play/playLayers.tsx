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
export type PlayLayerKey = 'tram' | 'bus' | 'rail' | 'stops' | 'pulse' | 'candidates' | 'mine';
export type PlayLayers = Record<PlayLayerKey, boolean>;

export const DEFAULT_PLAY_LAYERS: PlayLayers = {
  tram: true,
  bus: true,
  rail: true,
  stops: true,
  pulse: true,
  candidates: true,
  mine: true,
};

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
  showCandidates,
  t,
}: {
  layers: PlayLayers;
  onToggle: (key: PlayLayerKey) => void;
  showCandidates: boolean;
  t: T;
}) {
  const items: LegendItem<PlayLayerKey>[] = [];
  if (showCandidates) {
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
    label: t('play.legend.pulse'),
    swatch: <i style={{ background: C_EXISTING, borderRadius: '50%' }} />,
    pressed: layers.pulse,
  });
  return <LegendGroup items={items} onToggle={onToggle} />;
}
