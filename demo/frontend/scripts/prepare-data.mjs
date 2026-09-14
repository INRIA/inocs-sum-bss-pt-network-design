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
 *   ../experiments/data/geneva_1.5km-radius/*       -> public/data/city/*                (slim)
 *   ../experiments/data/pt_ridership_summary.json   -> public/data/city/pt_summary.json  (copy)
 *   (all of the above)                              -> public/data/manifest.json         (index)
 *
 * Rules:
 *  - Never hardcode a scenario id. Scenarios are DISCOVERED by listing results subfolders, so adding a
 *    fourth scenario folder requires zero front-end code changes.
 *  - A results folder missing a required file is SKIPPED with a warning (scenario hidden, no
 *    crash). Missing city inputs fail the build loudly — they are repo-wide prerequisites.
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

const REQUIRED_RESULTS = ['stations.json', 'kpis.json', 'sim_monday.json', 'sim_sunday.json', 'sim_monday_x25.json'];
// sim_instance.json is optional: a results folder solved before the instance mode existed still
// shows its three observed/hypothesis days instead of being hidden.
const OPTIONAL_RESULTS = ['metrics.json', 'sim_instance.json'];
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

const candidates = readdirSync(resultsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const scenarios = [];
for (const id of candidates) {
  const dir = join(resultsDir, id);
  const missing = REQUIRED_RESULTS.filter((f) => !existsSync(join(dir, f)));
  if (missing.length) {
    warnings.push(`results/${id}: skipped — missing ${missing.join(', ')}`);
    continue;
  }
  const scenarioFile = join(scenarioDir, `${id}.json`);
  if (!existsSync(scenarioFile)) {
    warnings.push(`results/${id}: skipped — no scenarios/${id}.json (narrative + parameters required for the game)`);
    continue;
  }
  const scenario = readJSON(scenarioFile);
  const stations = readJSON(join(dir, 'stations.json'));
  const kpis = readJSON(join(dir, 'kpis.json'));

  writeJSON(join(OUT, 'scenarios', `${id}.json`), scenario);
  const files = {};
  for (const f of [...REQUIRED_RESULTS, ...OPTIONAL_RESULTS]) {
    const src = join(dir, f);
    if (!existsSync(src)) continue;
    writeJSON(join(OUT, 'results', id, f), readJSON(src));
    files[f.replace('.json', '')] = `results/${id}/${f}`;
  }
  scenarios.push({
    id,
    title: scenario.title ?? id,
    files,
    placeholder: stations.placeholder === true || kpis.placeholder_model_results === true,
    days: Object.keys(kpis.days ?? {}),
  });
}

if (!scenarios.length) {
  console.error('\n[prepare-data] FATAL: no usable scenario found under demo/experiments/results/\n');
  process.exit(1);
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

console.log(`[prepare-data] ${scenarios.length} scenario(s): ${scenarios.map((s) => s.id).join(', ')}`);
console.log(
  `[prepare-data] city layers: grid ${city.grid.features} · stops ${city.stops.features} · bikes ${city.bike_stations.features} · ` +
    `PT lines ${city.pt_lines.features} · stop profiles ${city.ridership_stops.features} · POIs ${city.pois?.features ?? 0}`
);
for (const w of warnings) console.warn(`[prepare-data] WARN ${w}`);
console.log(`[prepare-data] wrote public/data (${Math.round(total / 1024)} KB, manifest ${kb(join(OUT, 'manifest.json'))} KB)`);
