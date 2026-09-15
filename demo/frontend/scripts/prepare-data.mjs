#!/usr/bin/env node
/**
 * prepare-data.mjs — the ONE data bridge between the Python experiment layer and this site.
 *
 * Runs automatically on `npm run dev` (predev) and `npm run build` (prebuild), so local dev
 * and CI consume byte-identical inputs. Reads the git-tracked source of truth in
 * `demo/experiments/` and writes the derived, gitignored tree `public/data/`.
 *
 *   ../experiments/scenarios/<id>.json              -> public/data/scenarios/<id>.json   (copy)
 *   ../experiments/results/<id>/*.json              -> public/data/results/<id>/*.json   (copy)
 *   ../experiments/results/<id>/model_plan.json     -> public/data/results/<id>/plan_slim.json (slim)
 *   ../experiments/data/geneva_1.5km-radius/*       -> public/data/city/*                (slim)
 *   ../experiments/data/pt_ridership_summary.json   -> public/data/city/pt_summary.json  (copy)
 *   ../experiments/data/profiles.json               -> public/data/city/profiles.json    (copy)
 *   (all of the above)                              -> public/data/manifest.json         (index)
 *
 * Rules (demo v3, .specs/demo-v3/implementation.md sections 0.2 and 0.5):
 *  - Never hardcode a scenario id. The manifest lists EVERY `scenarios/<id>.json` that carries the
 *    v3 fields, and marks which of them already have results, so the compare step can draw the
 *    runs that are still pending. Adding a scenario is a JSON file, never a code change.
 *  - A scenario JSON without the v3 fields (`schema`, `family`, `role`, `model_parameters`) is
 *    SKIPPED with a warning; a results folder missing a required file leaves the scenario in the
 *    manifest as "no results yet" instead of hiding it. Missing city inputs fail the build loudly —
 *    they are repo-wide prerequisites.
 *  - The 1 MB model_plan.json is NEVER shipped: only the built stations, with their per-period
 *    inventories, are extracted into plan_slim.json.
 *  - The 10 MB ridership.geojson is NEVER shipped: it is aggregated here into a ~30 KB
 *    per-stop hourly profile layer.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..'); // demo/frontend
const EXP = resolve(ROOT, '../experiments'); // demo/experiments
const CITY_SRC = join(EXP, 'data/geneva_1.5km-radius');
const OUT = join(ROOT, 'public/data');

/** v3 contract (implementation.md section 0.5): the model's own solution is the evaluation. */
const REQUIRED_RESULTS = ['stations.json', 'kpis.json', 'model_plan.json'];
// metrics.json is the full evaluator row; the two sim_<day> files only back the advanced
// "stress test with observed trips" block, so a scenario without them still renders everything else.
const OPTIONAL_RESULTS = ['metrics.json', 'sim_monday.json', 'sim_sunday.json'];
/** Copied verbatim to public/data/results/<id>/ ; model_plan.json is slimmed instead. */
const COPIED_RESULTS = ['stations.json', 'kpis.json', ...OPTIONAL_RESULTS];
/** The v3 scenario fields a front-end scenario cannot be built without. */
const SCENARIO_FIELDS = ['family', 'role', 'model_parameters'];
/** How many PT stops the live map shows (design decision, see ux-plan §2). */
const TOP_STOPS = 40;

const warnings = [];
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJSON = (p, v) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v));
};
const kb = (p) => Math.round(statSync(p).size / 1024);
const r5 = (n) => Math.round(n * 1e5) / 1e5;
const r3 = (n) => Math.round(n * 1e3) / 1e3;

function requireFile(p, what) {
  if (!existsSync(p)) {
    console.error(`\n[prepare-data] FATAL: missing required input ${what}\n  expected at: ${p}\n`);
    process.exit(1);
  }
  return p;
}

// ---------------------------------------------------------------- clean slate
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- scenarios + results
const resultsDir = requireFile(join(EXP, 'results'), 'demo/experiments/results/');
const scenarioDir = requireFile(join(EXP, 'scenarios'), 'demo/experiments/scenarios/');

/**
 * Discovery is driven by the SCENARIO files, not by the results folders: the compare step has to
 * know about the runs that do not exist yet (they are drawn as "run pending" marks).
 */
const scenarioFiles = readdirSync(scenarioDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

/** model_plan.json (~1 MB) -> the built stations and their per-period inventories only. */
function slimPlan(plan) {
  const stations = (plan.stations ?? [])
    .filter((s) => s.built === true)
    .map((s) => ({
      id: s.id,
      type: s.type,
      lon: r5(Number(s.lon)),
      lat: r5(Number(s.lat)),
      capacity: Number(s.capacity),
      inventory: (s.inventory ?? []).map((v) => Number(v)),
    }));
  return { periods: Number(plan.periods ?? 0), stations };
}

const scenarios = [];
for (const file of scenarioFiles) {
  const id = file.replace(/\.json$/, '');
  const scenario = readJSON(join(scenarioDir, file));
  const missingFields = SCENARIO_FIELDS.filter((k) => scenario[k] == null);
  if (scenario.id !== id || missingFields.length) {
    warnings.push(
      `scenarios/${file}: skipped — ${scenario.id !== id ? `id "${scenario.id}" does not match the file name` : `missing ${missingFields.join(', ')} (schema ${scenario.schema ?? 'unset'})`}`
    );
    continue;
  }

  const dir = join(resultsDir, id);
  const missing = existsSync(dir) ? REQUIRED_RESULTS.filter((f) => !existsSync(join(dir, f))) : REQUIRED_RESULTS;
  const hasResults = missing.length === 0;
  if (!hasResults && existsSync(dir)) {
    warnings.push(`results/${id}: incomplete — missing ${missing.join(', ')}; listed as a pending run`);
  }

  writeJSON(join(OUT, 'scenarios', `${id}.json`), scenario);
  const files = {};
  let kpis = null;
  if (hasResults) {
    for (const f of COPIED_RESULTS) {
      const src = join(dir, f);
      if (!existsSync(src)) continue;
      writeJSON(join(OUT, 'results', id, f), readJSON(src));
      files[f.replace('.json', '')] = `results/${id}/${f}`;
    }
    const slim = slimPlan(readJSON(join(dir, 'model_plan.json')));
    writeJSON(join(OUT, 'results', id, 'plan_slim.json'), slim);
    files.plan_slim = `results/${id}/plan_slim.json`;
    kpis = readJSON(join(dir, 'kpis.json'));
    if (kpis.schema !== 'kpis-v3') {
      warnings.push(`results/${id}: kpis.json schema is "${kpis.schema ?? 'unset'}", expected "kpis-v3"`);
    }
  }

  scenarios.push({
    id,
    title: scenario.title ?? id,
    family: scenario.family,
    role: scenario.role,
    card: scenario.card ?? null,
    legacy: scenario.legacy === true,
    axis_label: scenario.axis_label ?? null,
    temporal_profile: scenario.temporal_profile ?? null,
    outside_paper_range: scenario.outside_paper_range === true,
    paper_reference: scenario.paper_reference ?? null,
    has_results: hasResults,
    files,
    stress_days: kpis ? Object.keys(kpis.stress_test ?? {}) : [],
  });
}

if (!scenarios.length) {
  console.error('\n[prepare-data] FATAL: no usable scenario found under demo/experiments/scenarios/\n');
  process.exit(1);
}
if (!scenarios.some((s) => s.has_results)) {
  warnings.push('no scenario has results yet — the demo will render its "no results" state');
}

// ---------------------------------------------------------------- city layers
const city = {};

/** grid.geojson — 59 H3 cells. Drop the `center`/`polygon`/`points` props (they duplicate the geometry). */
{
  const src = readJSON(requireFile(join(CITY_SRC, 'grid.geojson'), 'grid.geojson'));
  const features = src.features.map((f) => ({
    type: 'Feature',
    properties: { id: f.properties.id },
    geometry: {
      type: f.geometry.type,
      coordinates: f.geometry.coordinates.map((ring) => ring.map(([x, y]) => [r5(x), r5(y)])),
    },
  }));
  writeJSON(join(OUT, 'city/grid.geojson'), { type: 'FeatureCollection', features });
  city.grid = { path: 'city/grid.geojson', features: features.length };
}

/** stops.geojson — 438 PT stops. Keep id/name/coords/active. */
{
  const src = readJSON(requireFile(join(CITY_SRC, 'stops.geojson'), 'stops.geojson'));
  const features = src.features.map((f) => ({
    type: 'Feature',
    properties: { stop_id: f.properties.stop_id, stop_name: f.properties.stop_name, active: f.properties.active },
    geometry: { type: 'Point', coordinates: f.geometry.coordinates.map(r5) },
  }));
  writeJSON(join(OUT, 'city/stops.geojson'), { type: 'FeatureCollection', features });
  city.stops = { path: 'city/stops.geojson', features: features.length };
}

/** bike_stations.geojson — 139 existing Donkey stations. Drop `history` / `rental_methods`. */
{
  const src = readJSON(requireFile(join(CITY_SRC, 'bike_stations.geojson'), 'bike_stations.geojson'));
  const features = src.features.map((f) => ({
    type: 'Feature',
    properties: { name: f.properties.name, capacity: f.properties.capacity },
    geometry: { type: 'Point', coordinates: f.geometry.coordinates.map(r5) },
  }));
  writeJSON(join(OUT, 'city/bike_stations.geojson'), { type: 'FeatureCollection', features });
  city.bike_stations = { path: 'city/bike_stations.geojson', features: features.length };
}

/** bike_trips.geojson — 1,658 observed trips. Only the count + the median distance are displayed. */
{
  const src = readJSON(requireFile(join(CITY_SRC, 'bike_trips.geojson'), 'bike_trips.geojson'));
  const dists = src.features
    .map((f) => Number(f.properties.distance_in_km))
    .filter((d) => Number.isFinite(d))
    .sort((a, b) => a - b);
  const mid = Math.floor(dists.length / 2);
  const median = dists.length % 2 ? dists[mid] : (dists[mid - 1] + dists[mid]) / 2;
  city.bike_trips = { features: src.features.length, median_km: r3(median) };
}

/** pois.geojson — sub-task 3.2 output, copied verbatim. */
{
  const p = join(CITY_SRC, 'pois.geojson');
  if (existsSync(p)) {
    const src = readJSON(p);
    writeJSON(join(OUT, 'city/pois.geojson'), src);
    city.pois = { path: 'city/pois.geojson', features: src.features.length };
  } else {
    warnings.push('city: pois.geojson not found — the landmark layer will be empty');
  }
}

/**
 * itineraries.geojson — REAL GTFS shapes with REAL TPG line numbers and official line colours.
 * Deduplicated to one representative shape per line number (the longest one), so the map shows
 * each Geneva line once. route_type: 0 = tram, 2 = rail, 3 = bus/trolleybus.
 */
{
  const src = readJSON(requireFile(join(CITY_SRC, 'itineraries.geojson'), 'itineraries.geojson'));
  const geoLen = (c) => {
    let d = 0;
    for (let i = 1; i < c.length; i++) d += Math.hypot((c[i][0] - c[i - 1][0]) * 0.69, c[i][1] - c[i - 1][1]);
    return d;
  };
  const best = new Map();
  for (const f of src.features) {
    const p = f.properties;
    const line = String(p.route_short_name ?? '').trim();
    if (!line) continue;
    const len = geoLen(f.geometry.coordinates);
    const cur = best.get(line);
    if (!cur || len > cur._len) {
      best.set(line, {
        _len: len,
        type: 'Feature',
        properties: {
          line,
          // 0 = tram, 2 = rail, 3 = bus / trolleybus (GTFS route_type)
          route_type: Number(p.route_type),
          mode: Number(p.route_type) === 0 ? 'tram' : Number(p.route_type) === 2 ? 'rail' : 'bus',
          color: p.color ? `#${p.color}` : null,
          headsign: p.headsign ?? null,
        },
        geometry: { type: 'LineString', coordinates: f.geometry.coordinates.map(([x, y]) => [r5(x), r5(y)]) },
      });
    }
  }
  // The map frame is 360x300 px: drawing all 26 lines would be unreadable. Keep the longest
  // in-frame representative of each mode (design decision, ux-plan section 7 "colour by mode").
  const perMode = { tram: 3, rail: 1, bus: 2 };
  const picked = [];
  for (const mode of Object.keys(perMode)) {
    picked.push(
      ...[...best.values()]
        .filter((f) => f.properties.mode === mode && f.geometry.coordinates.length >= 3)
        .sort((a, b) => b._len - a._len)
        .slice(0, perMode[mode])
    );
  }
  const features = picked
    .sort((a, b) => a.properties.line.localeCompare(b.properties.line, 'en', { numeric: true }))
    .map(({ _len, ...f }) => f);
  writeJSON(join(OUT, 'city/pt_lines.geojson'), { type: 'FeatureCollection', features });
  city.pt_lines = { path: 'city/pt_lines.geojson', features: features.length };
}

/**
 * ridership.geojson (10 MB) — NEVER shipped. Aggregated here into per-stop Monday/Sunday hourly
 * profiles for the top-N stops, exactly what screen B's bubble map needs:
 *   intensity[h] = (boardings+alightings at h) normalised against that stop's own daily peak
 *   w            = that stop's share of total ridership among the displayed stops
 */
{
  const src = readJSON(requireFile(join(CITY_SRC, 'ridership.geojson'), 'ridership.geojson'));
  const byStop = new Map();
  for (const f of src.features) {
    const p = f.properties;
    // Aggregate by stop NAME: the feed splits a stop into per-direction platforms
    // ("Gare Cornavin" x4), which the map must show as one bubble.
    const id = p.stop_name;
    let s = byStop.get(id);
    if (!s) {
      s = { id, name: p.stop_name, lon: p.stop_lon, lat: p.stop_lat, mon: Array(24).fill(0), sun: Array(24).fill(0), total: 0 };
      byStop.set(id, s);
    }
    const h = Math.round(Number(p.timeslot));
    if (!(h >= 0 && h < 24)) continue;
    const v = (Number(p.boardings) || 0) + (Number(p.alightings) || 0);
    s.total += v;
    if (p.day_index === 1) s.mon[h] += v;
    else if (p.day_index === 7) s.sun[h] += v;
  }
  const all = [...byStop.values()].filter((s) => Number.isFinite(s.lon) && Number.isFinite(s.lat));
  const top = all.sort((a, b) => b.total - a.total).slice(0, TOP_STOPS);
  const sum = top.reduce((acc, s) => acc + s.total, 0) || 1;
  const norm = (arr) => {
    const peak = Math.max(...arr, 1);
    return arr.map((v) => r3(v / peak));
  };
  const features = top.map((s) => ({
    type: 'Feature',
    properties: {
      name: s.name,
      w: r3(s.total / sum / (top[0].total / sum)), // 0..1, relative to the busiest displayed stop
      mon: norm(s.mon),
      sun: norm(s.sun),
    },
    geometry: { type: 'Point', coordinates: [r5(s.lon), r5(s.lat)] },
  }));
  writeJSON(join(OUT, 'city/ridership_stops.geojson'), { type: 'FeatureCollection', features });
  city.ridership_stops = { path: 'city/ridership_stops.geojson', features: features.length, source_stops: all.length };
}

/**
 * profiles.json — the observed temporal profiles the model's period weights come from. Step 2
 * reads `period_weights` (weekday / sunday) and `period_bounds_local` from it.
 */
{
  const src = readJSON(requireFile(join(EXP, 'data/profiles.json'), 'profiles.json'));
  writeJSON(join(OUT, 'city/profiles.json'), src);
  city.profiles = { path: 'city/profiles.json', periods: (src.period_bounds_local ?? []).length };
}

/** pt_ridership_summary.json — city-wide daily totals + hourly shares + peak hours. */
{
  const src = readJSON(requireFile(join(EXP, 'data/pt_ridership_summary.json'), 'pt_ridership_summary.json'));
  writeJSON(join(OUT, 'city/pt_summary.json'), src);
  city.pt_summary = { path: 'city/pt_summary.json', n_stops: src.n_stops };
}

// ---------------------------------------------------------------- manifest
const manifest = {
  generated_at: new Date().toISOString(),
  source: 'demo/experiments (scenarios/, results/, data/geneva_1.5km-radius/)',
  scenarios,
  city,
  warnings,
};
writeJSON(join(OUT, 'manifest.json'), manifest);

// ---------------------------------------------------------------- report
const total = (function du(d) {
  return readdirSync(d, { withFileTypes: true }).reduce(
    (acc, e) => acc + (e.isDirectory() ? du(join(d, e.name)) : statSync(join(d, e.name)).size),
    0
  );
})(OUT);

const withResults = scenarios.filter((s) => s.has_results);
console.log(
  `[prepare-data] ${scenarios.length} scenario(s), ${withResults.length} with results: ${withResults.map((s) => s.id).join(', ') || '(none)'}`
);
const pending = scenarios.filter((s) => !s.has_results);
if (pending.length) console.log(`[prepare-data] pending runs: ${pending.map((s) => s.id).join(', ')}`);
console.log(
  `[prepare-data] city layers: grid ${city.grid.features} · stops ${city.stops.features} · bikes ${city.bike_stations.features} · ` +
    `PT lines ${city.pt_lines.features} · stop profiles ${city.ridership_stops.features} · POIs ${city.pois?.features ?? 0}`
);
for (const w of warnings) console.warn(`[prepare-data] WARN ${w}`);
console.log(`[prepare-data] wrote public/data (${Math.round(total / 1024)} KB, manifest ${kb(join(OUT, 'manifest.json'))} KB)`);
