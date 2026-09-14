/**
 * Projection from WGS84 lon/lat into the fixed 360x300 SVG map frame.
 *
 * The map never pans or zooms (ux-plan section 12): the study area is framed identically on
 * screens A, B and D so the city visually "stays put" through the whole game. The frame is
 * derived ONCE from the real bounds of `grid.geojson` (the 59 H3 cells that define the study
 * area), so if the study area ever moves, the map follows with no code change.
 */
export const FRAME = { w: 360, h: 300, cx: 180, cy: 150, r: 148 } as const;

export type XY = [number, number];
export type Project = (lon: number, lat: number) => XY;

export interface Bounds {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

export function boundsOfGeoJSON(fc: { features: any[] }): Bounds {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const visit = (c: any) => {
    if (typeof c[0] === 'number') {
      minLon = Math.min(minLon, c[0]);
      maxLon = Math.max(maxLon, c[0]);
      minLat = Math.min(minLat, c[1]);
      maxLat = Math.max(maxLat, c[1]);
    } else for (const x of c) visit(x);
  };
  for (const f of fc.features) visit(f.geometry.coordinates);
  return { minLon, maxLon, minLat, maxLat };
}

/** Local equirectangular projection: accurate to a few metres over a 2.5 km square. */
export function makeProjection(b: Bounds, fill = 0.99): Project {
  const clon = (b.minLon + b.maxLon) / 2;
  const clat = (b.minLat + b.maxLat) / 2;
  const mx = 111320 * Math.cos((clat * Math.PI) / 180); // metres per degree of longitude
  const my = 110540; // metres per degree of latitude
  const widthM = (b.maxLon - b.minLon) * mx;
  const heightM = (b.maxLat - b.minLat) * my;
  const span = FRAME.r * 2 * fill;
  const s = Math.min(span / widthM, span / heightM); // px per metre
  return (lon, lat) => [
    round1(FRAME.cx + (lon - clon) * mx * s),
    round1(FRAME.cy - (lat - clat) * my * s),
  ];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** SVG path data for a lon/lat ring or line string. */
export function pathOf(coords: number[][], project: Project, close = false): string {
  if (!coords.length) return '';
  let d = '';
  for (let i = 0; i < coords.length; i++) {
    const [x, y] = project(coords[i][0], coords[i][1]);
    d += `${i ? 'L' : 'M'}${x},${y}`;
  }
  return close ? `${d}Z` : d;
}

/** Is this projected point inside the circular map clip (plus a small margin)? */
export function inFrame([x, y]: XY, margin = 6): boolean {
  return Math.hypot(x - FRAME.cx, y - FRAME.cy) <= FRAME.r + margin;
}

/**
 * Where to hang a line-number badge: on the line, inside the frame, and as far as possible from
 * anything that would bury it (POI discs, badges already placed). Candidates are the polyline's
 * vertices plus the midpoints between them, so a two-point line still gets a usable spot.
 */
export function badgeSpot(coords: number[][], project: Project, avoid: XY[]): XY {
  const pts: XY[] = [];
  const projected = coords.map(([lon, lat]) => project(lon, lat));
  for (let i = 0; i < projected.length; i++) {
    pts.push(projected[i]);
    if (i + 1 < projected.length) {
      pts.push([(projected[i][0] + projected[i + 1][0]) / 2, (projected[i][1] + projected[i + 1][1]) / 2]);
    }
  }
  const inside = pts.filter((p) => inFrame(p, -12));
  const pool = inside.length ? inside : pts;
  let best = pool[0] ?? [FRAME.cx, FRAME.cy];
  let bestScore = -Infinity;
  for (const p of pool) {
    const near = avoid.length ? Math.min(...avoid.map((a) => Math.hypot(p[0] - a[0], p[1] - a[1]))) : 999;
    // prefer clear space, then a spot away from the frame edge
    const score = Math.min(near, 40) * 2 - Math.hypot(p[0] - FRAME.cx, p[1] - FRAME.cy) * 0.15;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}
