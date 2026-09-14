#!/usr/bin/env node
/**
 * fetch-basemap.mjs — ONE-OFF, MANUAL script (NOT part of the build).
 *
 * Downloads the real street network and water bodies of the Geneva study area from
 * OpenStreetMap (Overpass API, ODbL) and writes them, already simplified, to
 *   src/data/basemap.geojson   (checked into git)
 *
 * The build NEVER touches the network: `npm run build` reads the committed file.
 * Re-run this only when the basemap should be refreshed:
 *   node scripts/fetch-basemap.mjs
 *
 * Attribution requirement: © OpenStreetMap contributors, ODbL. Rendered in the
 * map caption of every screen.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/data/basemap.geojson');

// Study area (from demo/experiments/data/geneva_1.5km-radius/grid.geojson: lon 6.1357..6.1651,
// lat 46.1919..46.2144) padded so the basemap still covers the corners of the 360x300 SVG frame.
const BBOX = [46.1865, 6.1245, 46.2200, 6.1765]; // s, w, n, e

const MAJOR = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
const MINOR = ['residential', 'unclassified', 'living_street', 'pedestrian'];
const MIN_WATER_AREA_M2 = 3000; // keeps the lake, the Rhône and the Arve; drops fountains and pools
const MIN_STREET_LEN_M = 45; // drops driveway stubs and service slivers

const query = `[out:json][timeout:120];
(
  way["natural"="water"](${BBOX.join(',')});
  relation["natural"="water"](${BBOX.join(',')});
  way["waterway"="riverbank"](${BBOX.join(',')});
  way["highway"~"^(${[...MAJOR, ...MINOR].join('|')})$"](${BBOX.join(',')});
);
out geom;`;

const round = (n) => Math.round(n * 1e5) / 1e5;

/**
 * Sutherland–Hodgman clip of a polygon ring against the bbox rectangle.
 * Overpass returns whole relation geometries (the entire Lake Geneva outline), so
 * without this the file would carry tens of thousands of points that never render.
 */
function clipRing(ring, [s, w, n, e]) {
  const edges = [
    { keep: (p) => p[0] >= w, cut: (a, b) => lerpX(a, b, w) },
    { keep: (p) => p[0] <= e, cut: (a, b) => lerpX(a, b, e) },
    { keep: (p) => p[1] >= s, cut: (a, b) => lerpY(a, b, s) },
    { keep: (p) => p[1] <= n, cut: (a, b) => lerpY(a, b, n) },
  ];
  const lerpX = (a, b, x) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1e-12)];
  const lerpY = (a, b, y) => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] || 1e-12), y];
  let out = ring;
  for (const { keep, cut } of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn = keep(cur);
      const prevIn = keep(prev);
      if (curIn) {
        if (!prevIn) out.push(cut(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(cut(prev, cur));
      }
    }
    if (out.length === 0) return [];
  }
  return out;
}

/** Rough planar area in m² of a lon/lat ring (equirectangular around its own centre). */
function ringArea(pts) {
  const lat0 = (pts.reduce((s, p) => s + p[1], 0) / pts.length) * (Math.PI / 180);
  const mx = 111320 * Math.cos(lat0);
  const my = 110540;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += (x1 * mx) * (y2 * my) - (x2 * mx) * (y1 * my);
  }
  return Math.abs(a / 2);
}

/** Approximate length in m of a lon/lat polyline. */
function lineLength(pts) {
  const lat0 = (pts[0][1] * Math.PI) / 180;
  const mx = 111320 * Math.cos(lat0);
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += Math.hypot((pts[i][0] - pts[i - 1][0]) * mx, (pts[i][1] - pts[i - 1][1]) * 110540);
  }
  return d;
}

/** Douglas–Peucker-ish decimation: keep every point further than eps degrees from the last kept one. */
function decimate(pts, eps = 8e-5) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [px, py] = out[out.length - 1];
    if (Math.abs(x - px) > eps || Math.abs(y - py) > eps) out.push([x, y]);
  }
  if (pts.length > 1) out.push(pts[pts.length - 1]);
  return out.map(([x, y]) => [round(x), round(y)]);
}

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

async function overpass() {
  let last;
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent':
              'sum-network-design-bike-sharing/1.0 (INOCS Inria, EU SUM project; static demo basemap, one-off)',
          },
          body: new URLSearchParams({ data: query }),
        });
        if (res.ok) return res.json();
        last = `${url} → ${res.status}`;
      } catch (e) {
        last = `${url} → ${e.message}`;
      }
      console.warn(`  retry (${last})`);
      await new Promise((r) => setTimeout(r, 8000));
    }
  }
  throw new Error(`Overpass unavailable: ${last}`);
}

const osm = await overpass();

const features = [];
let nWater = 0;
let nStreet = 0;

for (const el of osm.elements) {
  if (el.type === 'way' && el.geometry) {
    const pts = el.geometry.map((p) => [p.lon, p.lat]);
    if (pts.length < 2) continue;
    const tags = el.tags || {};
    if (tags.natural === 'water' || tags.waterway === 'riverbank') {
      // Only real water bodies (lake / Rhône / Arve). Drops fountains, pools, basins.
      if (ringArea(pts) < MIN_WATER_AREA_M2) continue;
      const ring = clipRing(pts, BBOX);
      if (ring.length < 4) continue;
      features.push({
        type: 'Feature',
        properties: { kind: 'water', name: tags.name || null },
        geometry: { type: 'Polygon', coordinates: [decimate(ring, 6e-5)] },
      });
      nWater++;
    } else if (tags.highway) {
      if (lineLength(pts) < MIN_STREET_LEN_M) continue;
      features.push({
        type: 'Feature',
        properties: { kind: 'street', rank: MAJOR.includes(tags.highway) ? 'major' : 'minor' },
        geometry: { type: 'LineString', coordinates: decimate(pts) },
      });
      nStreet++;
    }
  } else if (el.type === 'relation' && el.members) {
    // multipolygon lake / river: keep the outer rings
    for (const m of el.members) {
      if (m.role !== 'outer' || !m.geometry) continue;
      const pts = m.geometry.map((p) => [p.lon, p.lat]);
      if (pts.length < 4) continue;
      if (ringArea(pts) < MIN_WATER_AREA_M2) continue;
      const ring = clipRing(pts, BBOX);
      if (ring.length < 4) continue;
      features.push({
        type: 'Feature',
        properties: { kind: 'water', name: (el.tags && el.tags.name) || null },
        geometry: { type: 'Polygon', coordinates: [decimate(ring, 6e-5)] },
      });
      nWater++;
    }
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({
    type: 'FeatureCollection',
    name: 'geneva_study_area_basemap',
    attribution: '© OpenStreetMap contributors (ODbL)',
    generated_by: 'demo/frontend/scripts/fetch-basemap.mjs (manual, not part of the build)',
    generated_at: new Date().toISOString().slice(0, 10),
    bbox_s_w_n_e: BBOX,
    features,
  })
);
console.log(`basemap.geojson written — ${nWater} water polygons, ${nStreet} street lines`);
