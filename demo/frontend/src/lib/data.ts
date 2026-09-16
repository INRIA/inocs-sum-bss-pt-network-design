/**
 * Build-time data layer. Runs in Node during `astro build` / `astro dev` (never in the browser).
 *
 * Reads ONLY `public/data/`, the tree produced by `scripts/prepare-data.mjs` from the git-tracked
 * experiment outputs, and projects everything into the fixed 360x300 map frame so the client
 * receives a small, ready-to-render payload and does no geodesy.
 *
 * Contract rules honoured here (structure-plan section 4, demo-v3 implementation.md sections
 * 0.2 / 0.4 / 0.5):
 *  - keys are read, values are never hardcoded;
 *  - unknown extra keys are ignored;
 *  - a scenario with no results yet stays in the list with `hasResults: false`, so the compare
 *    step can draw it as a pending run instead of pretending it does not exist.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundsOfGeoJSON, makeProjection, pathOf, badgeSpot, inFrame, type Project } from './geo';
import type { GameData, GlyphKey, MapData, PaperKpis, PoiMarker, ScenarioData, StationMarker } from './types';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve a project-relative path. During `astro build` this module is bundled into a temporary
 * chunk, so `import.meta.url` cannot be trusted; the npm scripts always run with the project root
 * as cwd, which can. Both candidates are tried so `astro dev`, `astro build` and a direct
 * `node --import tsx` run all find the same files.
 */
function projectPath(rel: string): string {
  const candidates = [resolve(process.cwd(), rel), resolve(HERE, '../..', rel)];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

const DATA = projectPath('public/data');
const BASEMAP = projectPath('src/data/basemap.geojson');

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const num = (v: unknown, fallback = 0): number => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const numOrNull = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const arr = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => num(x)) : []);

/**
 * The six validated landmarks (ux-plan section 7). `pois.geojson` carries 18 curated POIs; the map
 * shows the six the design validated, picked by category + preferred name so a regenerated POI
 * file keeps working. Order = drawing order.
 */
const POI_SPEC: { glyph: GlyphKey; category: string; prefer: RegExp }[] = [
  { glyph: 'rail', category: 'transit_hub', prefer: /cornavin/i },
  { glyph: 'uni', category: 'university', prefer: /bastions|université|university/i },
  { glyph: 'hosp', category: 'hospital', prefer: /hug/i },
  { glyph: 'land', category: 'landmark', prefer: /jet d'eau|rotonde/i },
  { glyph: 'mkt', category: 'park', prefer: /plainpalais/i },
  { glyph: 'old', category: 'landmark', prefer: /pierre|cath/i },
];

function buildPois(fc: any, project: Project): PoiMarker[] {
  const out: PoiMarker[] = [];
  const used = new Set<any>();
  for (const spec of POI_SPEC) {
    const pool = fc.features.filter((f: any) => !used.has(f) && f.properties.category === spec.category);
    const f = pool.find((p: any) => spec.prefer.test(p.properties.name ?? '')) ?? pool[0];
    if (!f) continue;
    used.add(f);
    const [x, y] = project(f.geometry.coordinates[0], f.geometry.coordinates[1]);
    out.push({
      x,
      y,
      glyph: spec.glyph,
      name: f.properties.name,
      name_fr: f.properties.name_fr ?? null,
      note: f.properties.note ?? null,
      source: f.properties.source ?? null,
    });
  }
  return out;
}

function buildMap(project: Project): MapData {
  const basemap = existsSync(BASEMAP) ? read(BASEMAP) : { features: [] };
  const water: string[] = [];
  const major: string[] = [];
  const minor: string[] = [];
  for (const f of basemap.features) {
    if (f.properties.kind === 'water') {
      water.push(pathOf(f.geometry.coordinates[0], project, true));
    } else if (f.properties.kind === 'street') {
      const d = pathOf(f.geometry.coordinates, project);
      (f.properties.rank === 'major' ? major : minor).push(d);
    }
  }

  const grid = read(join(DATA, 'city/grid.geojson'));
  const gridPath = grid.features.map((f: any) => pathOf(f.geometry.coordinates[0], project, true)).join('');

  const poiFile = join(DATA, 'city/pois.geojson');
  const pois = existsSync(poiFile) ? buildPois(read(poiFile), project) : [];

  const lines = read(join(DATA, 'city/pt_lines.geojson'));
  // Badges are laid out after the POIs so a line number is never hidden under a landmark disc.
  const taken: [number, number][] = pois.map((p) => [p.x, p.y] as [number, number]);
  const ptLines = lines.features.map((f: any) => {
    const badge = badgeSpot(f.geometry.coordinates, project, taken);
    taken.push(badge);
    return {
      line: f.properties.line as string,
      mode: f.properties.mode as 'tram' | 'bus' | 'rail',
      // Colour by MODE, not by the operator's own line colour: the design reserves blue/green/red
      // for the three semantic registers (ux-plan section 6). The operator colour stays in the data.
      color: f.properties.mode === 'tram' ? '#004494' : f.properties.mode === 'rail' ? '#2E2D29' : '#ff3514',
      d: pathOf(f.geometry.coordinates, project),
      badge,
      headsign: f.properties.headsign ?? null,
    };
  });
  // Second tram gets the green of the "tram = blue/green pair" convention.
  const trams = ptLines.filter((l: any) => l.mode === 'tram');
  if (trams[1]) trams[1].color = '#98C33A';

  const bikes = read(join(DATA, 'city/bike_stations.geojson'));
  const bikeDots = bikes.features
    .map((f: any) => project(f.geometry.coordinates[0], f.geometry.coordinates[1]))
    .filter((p: [number, number]) => inFrame(p, 0));

  const stopsFc = read(join(DATA, 'city/ridership_stops.geojson'));
  const stops = stopsFc.features.map((f: any) => {
    const [x, y] = project(f.geometry.coordinates[0], f.geometry.coordinates[1]);
    return { name: f.properties.name, x, y, w: f.properties.w, mon: f.properties.mon, sun: f.properties.sun };
  });

  return { water, streetsMajor: major.join(''), streetsMinor: minor.join(''), grid: gridPath, ptLines, bikeDots, pois, stops };
}

/** kpis.json -> `paper`, renamed to camelCase. Nothing is recomputed here. */
function buildPaper(p: any): PaperKpis {
  return {
    demandTotal: num(p.demand_total),
    servedTotal: num(p.served_total),
    servedRatio: num(p.served_ratio),
    demandByPeriod: arr(p.demand_by_period),
    servedByPeriod: arr(p.served_by_period),
    bikeOnlyByPeriod: arr(p.bike_only_by_period),
    bikePtByPeriod: arr(p.bike_pt_by_period),
    flowBikeOnly: num(p.flow_bike_only),
    flowBikePt: num(p.flow_bike_pt),
    ptAssistedShare: num(p.pt_assisted_share),
    avgTimeGainMin: num(p.avg_time_gain_min),
    avgTravelTimeMin: num(p.avg_travel_time_min),
    timeSavingRatio: num(p.time_saving_ratio),
    stations: num(p.stations),
    nReg: num(p.n_reg),
    nTrans: num(p.n_trans),
    docks: num(p.docks),
    bikes: num(p.bikes),
    capexUsedEur: num(p.capex_used_eur),
    budgetEur: num(p.budget_eur),
    opBudgetEur: num(p.op_budget_eur),
    dispatches: num(p.dispatches),
    bikesRebalanced: num(p.bikes_rebalanced),
    dispatchCostEur: num(p.dispatch_cost_eur),
    investmentPerServedTripEur: num(p.investment_per_served_trip_eur),
    coveredOdRatio: num(p.covered_od_ratio),
    odPairsTotal: num(p.od_pairs_total),
    odPairsCovered: num(p.od_pairs_covered),
    nearestNeighborM: numOrNull(p.nearest_neighbor_m),
    meanPairwiseM: numOrNull(p.mean_pairwise_m),
  };
}

function buildScenario(entry: any, project: Project, periodBounds: number[][]): ScenarioData {
  const scenario = read(join(DATA, 'scenarios', `${entry.id}.json`));
  const mp = scenario.model_parameters ?? {};
  const hasResults = entry.has_results === true;

  let paper: PaperKpis | null = null;
  let technical: Record<string, number | string | null> = {};
  let stations: StationMarker[] = [];
  let periods = num(mp.demand_periods);
  let capexBudget = num(mp.total_budget);
  let provenance = '';
  let ranAt = '';

  if (hasResults) {
    const kpis = read(join(DATA, 'results', entry.id, 'kpis.json'));
    paper = buildPaper(kpis.paper ?? {});
    technical = { ...(kpis.technical ?? {}) };

    const meta = read(join(DATA, 'results', entry.id, 'stations.json'));
    capexBudget = num(meta.capex_budget_eur, capexBudget);
    provenance = String(meta.provenance ?? '');
    ranAt = String(meta.run?.ran_at ?? technical.ran_at ?? '');
    // `run` carries the solver statistics the evaluator row does not: keep them in `technical`
    // so the story sheet reads one flat record (implementation.md section 0.4).
    for (const k of ['n_variables', 'n_constraints', 'gurobi_status', 'mip_gap', 'wall_clock_s'] as const) {
      if (technical[k] == null && meta.run?.[k] != null) technical[k] = meta.run[k];
    }
    if (technical.ran_at == null && ranAt) technical.ran_at = ranAt;

    const plan = read(join(DATA, 'results', entry.id, 'plan_slim.json'));
    periods = num(plan.periods, periods);
    stations = (plan.stations ?? []).map((s: any) => {
      const [x, y] = project(num(s.lon), num(s.lat));
      return { x, y, transfer: s.type === 'TransferStation', capacity: num(s.capacity), inventory: arr(s.inventory) };
    });
  }

  // Inventory snapshots sit on the period boundaries: [start of p1, start of p2, ..., end of pT].
  const periodHours = periodBounds.length
    ? [...periodBounds.map((b) => num(b[0])), num(periodBounds[periodBounds.length - 1]?.[1])]
    : [];

  return {
    id: entry.id,
    family: String(entry.family ?? scenario.family ?? ''),
    role: String(entry.role ?? scenario.role ?? 'compare'),
    card: entry.card ?? scenario.card ?? null,
    legacy: entry.legacy === true,
    hasResults,
    axisLabel: String(entry.axis_label ?? scenario.axis_label ?? ''),
    temporalProfile: String(entry.temporal_profile ?? scenario.temporal_profile ?? ''),
    outsidePaperRange: entry.outside_paper_range === true,
    paperReference: String(entry.paper_reference ?? scenario.paper_reference ?? ''),
    params: {
      budget: num(mp.total_budget),
      opsRatio: num(mp.op_budget_ratio),
      epsilon: num(mp.epsilon),
      solveMode: String(mp.solve_mode ?? ''),
      demandPeriods: num(mp.demand_periods),
      periodWeights: arr(mp.period_weights),
      splitMethod: String(mp.split_method ?? ''),
      seed: num(mp.seed),
    },
    fallback: {
      name: scenario.title ?? entry.id,
      pitch: scenario.audience_pitch ?? '',
      narrative: scenario.narrative ?? '',
    },
    paper,
    technical,
    stations,
    periods,
    periodHours,
    capexBudget,
    provenance,
    ranAt,
  };
}

let cached: GameData | null = null;

export function loadGameData(): GameData {
  if (cached) return cached;
  const manifest = read(join(DATA, 'manifest.json'));

  const grid = read(join(DATA, 'city/grid.geojson'));
  const project = makeProjection(boundsOfGeoJSON(grid));

  const profiles = existsSync(join(DATA, 'city/profiles.json')) ? read(join(DATA, 'city/profiles.json')) : {};
  const periodBounds: number[][] = Array.isArray(profiles.period_bounds_local) ? profiles.period_bounds_local : [];

  const scenarios: ScenarioData[] = manifest.scenarios.map((entry: any) => buildScenario(entry, project, periodBounds));

  const summary = read(join(DATA, 'city/pt_summary.json'));

  cached = {
    generatedAt: manifest.generated_at,
    scenarios,
    map: buildMap(project),
    city: {
      gridCells: manifest.city.grid.features,
      ptStops: manifest.city.stops.features,
      bikeStations: manifest.city.bike_stations.features,
      bikeTrips: manifest.city.bike_trips.features,
      medianTripKm: manifest.city.bike_trips.median_km,
      ptBoardings: summary.daily_boardings_avg ?? {},
      periodWeights: profiles.period_weights ?? {},
      periodBounds,
      tripsPerDayObserved: profiles.trips_per_day_observed ?? {},
    },
    warnings: manifest.warnings ?? [],
  };
  return cached;
}
