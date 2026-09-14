/**
 * Build-time data layer. Runs in Node during `astro build` / `astro dev` (never in the browser).
 *
 * Reads ONLY `public/data/`, the tree produced by `scripts/prepare-data.mjs` from the git-tracked
 * experiment outputs, and projects everything into the fixed 360x300 map frame so the client
 * receives a small, ready-to-render payload and does no geodesy.
 *
 * Contract rules honoured here (structure-plan section 4):
 *  - keys are read, values are never hardcoded;
 *  - unknown extra keys are ignored;
 *  - a scenario that prepare-data could not validate simply is not in the manifest -> the game
 *    renders without it instead of crashing.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundsOfGeoJSON, makeProjection, pathOf, badgeSpot, inFrame, type Project } from './geo';
import type { GameData, GlyphKey, MapData, PoiMarker, ScenarioData, StationMarker } from './types';

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

function hourlySeries(sim: any) {
  const h = Array.isArray(sim.hourly) ? sim.hourly : [];
  const at = (i: number, k: string) => Number(h[i]?.[k] ?? 0);
  return {
    demand: Array.from({ length: 24 }, (_, i) => at(i, 'demand')),
    served: Array.from({ length: 24 }, (_, i) => at(i, 'served')),
    empty: Array.from({ length: 24 }, (_, i) => at(i, 'empty_stations')),
    full: Array.from({ length: 24 }, (_, i) => at(i, 'full_stations')),
  };
}

/** monday -> sim_monday.json, monday_x25 -> sim_monday_x25.json, instance -> sim_instance.json */
const simFileFor = (day: string) => `sim_${day}.json`;

function buildScenario(entry: any, project: Project): ScenarioData | null {
  const scenario = read(join(DATA, 'scenarios', `${entry.id}.json`));
  const stationsFile = read(join(DATA, 'results', entry.id, 'stations.json'));
  const kpis = read(join(DATA, 'results', entry.id, 'kpis.json'));

  const stations: StationMarker[] = (stationsFile.stations ?? []).map((s: any) => {
    const [x, y] = project(s.lon, s.lat);
    return { x, y, transfer: s.type === 'TransferStation', capacity: Number(s.capacity), bikes: Number(s.initial_bikes) };
  });

  const days: ScenarioData['days'] = {};
  const dayIds: string[] = [];
  for (const day of Object.keys(kpis.days ?? {})) {
    const simPath = join(DATA, 'results', entry.id, simFileFor(day));
    if (!existsSync(simPath)) continue;
    const sim = read(simPath);
    days[day] = {
      kpi: kpis.days[day],
      hourly: hourlySeries(sim),
      rebalancing: {
        bikes_moved: Number(sim.rebalancing?.bikes_moved ?? 0),
        truck_dispatches: Number(sim.rebalancing?.truck_dispatches ?? 0),
        cost_eur: Number(sim.rebalancing?.cost_eur ?? 0),
      },
      method: sim.method ?? kpis.days[day]?.method ?? {},
    };
    dayIds.push(day);
  }
  if (!dayIds.length) return null;
  // Present the days in the order the game talks about them: the two observed days, then the
  // optimiser's own planning day, then the hypothesis last.
  const order = ['monday', 'sunday', 'instance', 'monday_x25'];
  dayIds.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));

  const mp = scenario.model_parameters ?? {};
  return {
    id: entry.id,
    short: entry.id.split('_')[0].toUpperCase().slice(0, 3),
    fallback: {
      name: scenario.title ?? entry.id,
      pitch: scenario.audience_pitch ?? '',
      narrative: scenario.narrative ?? '',
      expect: {
        service: scenario.expected_story?.service ?? '',
        environment: scenario.expected_story?.environment ?? '',
        economics: scenario.expected_story?.economics ?? '',
      },
    },
    // ux-plan section 13.9: driven by the data, defaulting to the published Geneva reference.
    highlight: scenario.highlight === true || entry.id === 'S2_balanced',
    params: {
      budget: Number(mp.total_budget ?? 0),
      opsRatio: Number(mp.op_budget_ratio ?? 0),
      epsilon: Number(mp.epsilon ?? 0),
      solveMode: String(mp.solve_mode ?? ''),
      demandPeriods: Number(mp.demand_periods ?? 0),
      periodWeights: Array.isArray(mp.period_weights) ? mp.period_weights : [],
      splitMethod: String(mp.split_method ?? ''),
    },
    capexBudget: Number(stationsFile.capex_budget_eur ?? mp.total_budget ?? 0),
    capexSpent: Number(stationsFile.capex_spent_eur ?? 0),
    placeholder: stationsFile.placeholder === true || kpis.placeholder_model_results === true,
    provenance: String(stationsFile.provenance ?? ''),
    placeholderNote: String(kpis.placeholder_note ?? ''),
    stations,
    transferCount: stations.filter((s) => s.transfer).length,
    days,
    dayIds,
  };
}

let cached: GameData | null = null;

export function loadGameData(): GameData {
  if (cached) return cached;
  const manifest = read(join(DATA, 'manifest.json'));

  const grid = read(join(DATA, 'city/grid.geojson'));
  const project = makeProjection(boundsOfGeoJSON(grid));

  const scenarios = manifest.scenarios
    .map((entry: any) => buildScenario(entry, project))
    .filter((s: ScenarioData | null): s is ScenarioData => s !== null);

  // Operating-result range across every scenario x every day (never hardcoded, ux-plan section 4).
  const results = scenarios.flatMap((s: ScenarioData) =>
    Object.values(s.days).map((d) => Number(d.kpi?.economics?.operating_result_eur_per_day ?? 0))
  );
  const opRange = { min: results.length ? Math.min(...results) : 0, max: results.length ? Math.max(...results) : 0 };

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
    },
    opRange,
    warnings: manifest.warnings ?? [],
  };
  return cached;
}
