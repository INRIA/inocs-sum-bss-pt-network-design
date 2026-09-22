import { createContext, useContext } from 'react';

/**
 * What a layer needs and nothing else (plan-technical.md §C.3): the current px-per-user-unit (the
 * micro-glyph / label-hiding thresholds) and the clip id, if a layer ever needs to reference it
 * directly. Layers take their data as props; they do not read game or scenario state from here.
 */
export interface MapView {
  unitPx: number;
  clipId: string;
}

const MapContext = createContext<MapView | null>(null);

export function useMapView(): MapView {
  const ctx = useContext(MapContext);
  if (!ctx) throw new Error('useMapView must be used within a MapCanvas');
  return ctx;
}

export const MapViewProvider = MapContext.Provider;
