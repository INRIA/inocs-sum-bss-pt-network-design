export type GlyphKey = 'rail' | 'uni' | 'hosp' | 'land' | 'mkt' | 'old';
export type Weekday = 'mon' | 'sun';
export type Lang = 'en' | 'fr';

/** Every legend item is a layer toggle (ux-plan-v2 section 4.2); the state is global and persists. */
export type LayerKey = 'stops' | 'tram' | 'bus' | 'rail' | 'poi' | 'bike' | 'transfer' | 'regular';
export type Layers = Record<LayerKey, boolean>;

export interface PoiMarker {
  x: number;
  y: number;
  glyph: GlyphKey;
  /** Full real name from pois.geojson — shown in the marker tooltip, not as the map label. */
  name: string;
  name_fr: string | null;
  note: string | null;
  source: string | null;
}

export interface StopBubble {
  name: string;
  x: number;
  y: number;
  /** 0..1 weight relative to the busiest displayed stop (drives the bubble ceiling). */
  w: number;
  mon: number[];
  sun: number[];
}

export interface PtLine {
  line: string;
  mode: 'tram' | 'bus' | 'rail';
  color: string;
  d: string;
  badge: [number, number];
  headsign: string | null;
}

export interface MapData {
  water: string[];
  streetsMajor: string;
  streetsMinor: string;
  grid: string;
  ptLines: PtLine[];
  bikeDots: [number, number][];
  pois: PoiMarker[];
  stops: StopBubble[];
}

export interface StationMarker {
  x: number;
  y: number;
  transfer: boolean;
  capacity: number;
  bikes: number;
}

export interface DayData {
  /** verbatim `kpis.json -> days.<day>` */
  kpi: any;
  hourly: { demand: number[]; served: number[]; empty: number[]; full: number[] };
  rebalancing: { bikes_moved: number; truck_dispatches: number; cost_eur: number };
  /** verbatim `sim_<day>.json -> method` */
  method: any;
}

export interface ScenarioData {
  id: string;
  short: string;
  /** Fallbacks used when no `scen.<id>.*` i18n key exists (a brand-new scenario folder). */
  fallback: {
    name: string;
    pitch: string;
    narrative: string;
    expect: { service: string; environment: string; economics: string };
  };
  highlight: boolean;
  params: {
    budget: number;
    opsRatio: number;
    epsilon: number;
    solveMode: string;
    demandPeriods: number;
    periodWeights: number[];
    splitMethod: string;
  };
  capexBudget: number;
  capexSpent: number;
  placeholder: boolean;
  provenance: string;
  placeholderNote: string;
  stations: StationMarker[];
  transferCount: number;
  /** keyed by the day ids found in kpis.json: monday | sunday | monday_x25 | ... */
  days: Record<string, DayData>;
  dayIds: string[];
}

export interface GameData {
  generatedAt: string;
  scenarios: ScenarioData[];
  map: MapData;
  city: {
    gridCells: number;
    ptStops: number;
    bikeStations: number;
    bikeTrips: number;
    medianTripKm: number;
    ptBoardings: Record<string, number>;
  };
  /** min/max of operating_result_eur_per_day across every scenario x every day (ux-plan section 4). */
  opRange: { min: number; max: number };
  warnings: string[];
}
