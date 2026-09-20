export type GlyphKey = 'rail' | 'uni' | 'hosp' | 'land' | 'mkt' | 'old';
export type Weekday = 'mon' | 'sun';
export type Lang = 'en' | 'fr';

/**
 * Every legend item is a layer toggle (ux-plan-v2 section 4.2); the state is global and persists
 * across steps. `capacity` / `inventory` are the two v3 station read-outs: docks (on by default)
 * and bikes in stock per model period (off by default).
 */
export type LayerKey =
  | 'stops'
  | 'tram'
  | 'bus'
  | 'rail'
  | 'poi'
  | 'bike'
  | 'transfer'
  | 'regular'
  | 'capacity'
  | 'inventory';
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

/** One built station of a plan: projected once, carrying the model's own per-period inventory. */
export interface StationMarker {
  id: string;
  x: number;
  y: number;
  transfer: boolean;
  capacity: number;
  /** `v_{i,t}` at each period boundary (length = periods + 1). */
  inventory: number[];
}

/** kpis.json -> `paper` (implementation.md section 0.4). A key the run did not produce is null. */
export interface PaperKpis {
  demandTotal: number;
  servedTotal: number;
  servedRatio: number;
  demandByPeriod: number[];
  servedByPeriod: number[];
  bikeOnlyByPeriod: number[];
  bikePtByPeriod: number[];
  flowBikeOnly: number;
  flowBikePt: number;
  ptAssistedShare: number;
  avgTimeGainMin: number;
  avgTravelTimeMin: number;
  timeSavingRatio: number;
  stations: number;
  nReg: number;
  nTrans: number;
  docks: number;
  bikes: number;
  capexUsedEur: number;
  budgetEur: number;
  opBudgetEur: number;
  dispatches: number;
  bikesRebalanced: number;
  dispatchCostEur: number;
  investmentPerServedTripEur: number;
  coveredOdRatio: number;
  odPairsTotal: number;
  odPairsCovered: number;
  nearestNeighborM: number | null;
  meanPairwiseM: number | null;
}

export interface ScenarioParams {
  budget: number;
  opsRatio: number;
  epsilon: number;
  solveMode: string;
  demandPeriods: number;
  periodWeights: number[];
  splitMethod: string;
  seed: number;
}

export interface ScenarioData {
  id: string;
  /** "baseline" | "budget" | "ops_ratio" | "epsilon" | "rhythm" */
  family: string;
  /** "card" | "compare" */
  role: string;
  /** cards only: "starter" | "essential" | "reference" | "ambitious" */
  card: string | null;
  legacy: boolean;
  /** the run exists on disk; false = a scenario the notebook has still to solve */
  hasResults: boolean;
  axisLabel: string;
  temporalProfile: string;
  outsidePaperRange: boolean;
  paperReference: string;
  params: ScenarioParams;
  /** Fallbacks used when no `scen.<id>.*` i18n key exists (a brand-new scenario file). */
  fallback: { name: string; pitch: string; narrative: string };
  paper: PaperKpis | null;
  /** kpis.json -> `technical` plus the run record of stations.json: the model's own ExperimentRow keys and solver statistics (step 1 facts, the story sheet). */
  technical: Record<string, number | string | null>;
  stations: StationMarker[];
  /** model periods (T) and the local hour of each inventory snapshot, e.g. [6, 10, 16, 22]. */
  periods: number;
  periodHours: number[];
  capexBudget: number;
  provenance: string;
  ranAt: string;
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
    /** profiles.json — observed period weights per day type, and the period boundaries. */
    periodWeights: Record<string, number[]>;
    periodBounds: number[][];
    tripsPerDayObserved: Record<string, number>;
  };
  warnings: string[];
}
