import { Fragment } from 'react';

/**
 * The three SVG charts of the v3 demo (no chart library, no dependency).
 *
 * Palette rule (ux-plan section 6): SUM blue #004494 is the primary data series, the lighter
 * #2b7bd3 is the PT-assisted part of it, grey #dfebe5 is "potential, not served". Green is never a
 * data series. Runs that do not exist yet are drawn hollow in SUM red-ink, never as a zero.
 */
export const C_SERIES = '#004494';
export const C_SERIES2 = '#2b7bd3';
export const C_POTENTIAL = '#dfebe5';
export const C_POTENTIAL_LINE = '#c6d9cd';
export const C_PENDING = '#be280b';

const ticks = [0, 0.5, 1];

/** Potential vs served trips per model period, served split into direct / PT-assisted. */
export function PeriodChart({
  demand,
  bikeOnly,
  bikePt,
  served,
  labels,
  shares,
  alt,
}: {
  demand: number[];
  bikeOnly: number[];
  bikePt: number[];
  served: number[];
  labels: string[];
  /** "95 % served" per period, already formatted */
  shares: string[];
  alt: string;
}) {
  const W = 360;
  const H = 152;
  const B = 118;
  const T = 100;
  const max = Math.max(...demand, 1);
  const n = Math.max(demand.length, 1);
  const slot = (W - 40) / n;
  const bw = Math.min(38, slot * 0.36);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={alt}>
      <line className="axis" x1={30} x2={W} y1={B} y2={B} />
      {ticks.map((f) => (
        <Fragment key={f}>
          <line className="grid" x1={30} x2={W} y1={B - f * T} y2={B - f * T} />
          <text className="axlbl" x={26} y={B - f * T + 3} textAnchor="end">
            {Math.round(max * f)}
          </text>
        </Fragment>
      ))}
      {demand.map((dem, p) => {
        const x0 = 38 + p * slot;
        const hd = (dem / max) * T;
        const hb = ((bikeOnly[p] ?? 0) / max) * T;
        const hp = ((bikePt[p] ?? 0) / max) * T;
        return (
          <g key={p}>
            <rect x={x0} y={B - hd} width={bw} height={hd} rx={3} fill={C_POTENTIAL} stroke={C_POTENTIAL_LINE} />
            <rect x={x0 + bw + 6} y={B - hb} width={bw} height={hb} rx={3} fill={C_SERIES} />
            <rect x={x0 + bw + 6} y={B - hb - hp - 2} width={bw} height={Math.max(0, hp)} rx={3} fill={C_SERIES2} />
            <text className="dl" x={x0 + bw / 2} y={B - hd - 4} textAnchor="middle">
              {dem}
            </text>
            <text className="dl" x={x0 + bw + 6 + bw / 2} y={B - hb - hp - 6} textAnchor="middle">
              {served[p] ?? 0}
            </text>
            <text className="axlbl" x={x0 + bw + 3} y={B + 12} textAnchor="middle">
              {labels[p]}
            </text>
            <text className="axlbl" x={x0 + bw + 3} y={B + 23} textAnchor="middle">
              {shares[p]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export interface LadderPoint {
  id: string;
  /** position on the family axis (budget €, ops ratio, ε, evening share…) */
  x: number;
  /** printed under the axis */
  tick: string;
  /** null = the run does not exist yet */
  value: number | null;
  legacy: boolean;
  /** printed above the marker */
  label: string;
}

/**
 * A family axis: solid SUM-blue line + dots for the runs that exist, a dashed line with square
 * markers for legacy runs (a different parameter regime), and hollow red ticks on the axis for the
 * runs still pending.
 */
export function LadderChart({
  points,
  ymax,
  yTick,
  pendingLabel,
  alt,
}: {
  points: LadderPoint[];
  ymax: number;
  yTick: (v: number) => string;
  pendingLabel: string;
  alt: string;
}) {
  const W = 360;
  const H = 146;
  const L = 34;
  const R = 350;
  const B = 108;
  const T = 90;
  const xs = points.map((p) => p.x);
  const min = Math.min(...xs, 0);
  const span = Math.max(...xs, 1) - min || 1;
  const X = (v: number) => L + ((v - min) / span) * (R - L);
  const Y = (v: number) => B - (Math.max(0, Math.min(v, ymax)) / (ymax || 1)) * T;

  const series = (legacy: boolean) =>
    points.filter((p) => p.legacy === legacy && p.value != null).sort((a, b) => a.x - b.x);
  const line = (pts: LadderPoint[]) => pts.map((p) => `${X(p.x).toFixed(1)} ${Y(p.value ?? 0).toFixed(1)}`).join(' L');

  const paper = series(false);
  const legacy = series(true);
  // ticks are de-duplicated so two runs at the same budget do not print the label twice
  const seen = new Set<string>();

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={alt}>
      <line className="axis" x1={L} x2={R} y1={B} y2={B} />
      {ticks.map((f) => (
        <Fragment key={f}>
          <line className="grid" x1={L} x2={R} y1={B - f * T} y2={B - f * T} />
          <text className="axlbl" x={L - 4} y={B - f * T + 3} textAnchor="end">
            {yTick(ymax * f)}
          </text>
        </Fragment>
      ))}
      {points.map((p) => {
        if (seen.has(p.tick)) return null;
        seen.add(p.tick);
        return (
          <text className="axlbl" key={`t${p.id}`} x={X(p.x)} y={B + 13} textAnchor="middle">
            {p.tick}
          </text>
        );
      })}
      {paper.length > 1 && <path d={`M${line(paper)}`} fill="none" stroke={C_SERIES} strokeWidth={2} />}
      {legacy.length > 1 && (
        <path d={`M${line(legacy)}`} fill="none" stroke={C_SERIES} strokeWidth={1.4} strokeDasharray="4 3" opacity={0.75} />
      )}
      {points.map((p) =>
        p.value == null ? (
          <g key={`p${p.id}`}>
            <circle cx={X(p.x)} cy={B} r={4} fill="#fff" stroke={C_PENDING} strokeWidth={1.5} strokeDasharray="2 1.5" />
            <title>{`${p.tick} — ${pendingLabel}`}</title>
          </g>
        ) : p.legacy ? (
          <g key={`p${p.id}`}>
            <rect
              x={X(p.x) - 4.2}
              y={Y(p.value) - 4.2}
              width={8.4}
              height={8.4}
              fill="#fff"
              stroke={C_SERIES}
              strokeWidth={2}
            />
            <text className="dl" x={X(p.x)} y={Y(p.value) - 9} textAnchor="middle">
              {p.label}
            </text>
          </g>
        ) : (
          <g key={`p${p.id}`}>
            <circle cx={X(p.x)} cy={Y(p.value)} r={5} fill={C_SERIES} stroke="#fff" strokeWidth={2} />
            <text className="dl" x={X(p.x)} y={Y(p.value) - 9} textAnchor="middle">
              {p.label}
            </text>
          </g>
        )
      )}
    </svg>
  );
}

export interface BarRow {
  id: string;
  label: string;
  sub?: string;
  /** optional third line under the axis */
  sub2?: string;
  /** null = the run does not exist yet -> dashed hollow bar */
  value: number | null;
  /** already formatted, printed on top of the bar */
  text?: string;
}

export function BarsChart({
  rows,
  ymax,
  yTick,
  color = C_SERIES,
  pendingLabel,
  alt,
  width = 360,
  left = 32,
}: {
  rows: BarRow[];
  ymax: number;
  yTick: (v: number) => string;
  color?: string;
  pendingLabel: string;
  alt: string;
  /** viewBox width — 520 for a full-column chart with many bars, 360 for a half-width one */
  width?: number;
  /** room for the y tick labels */
  left?: number;
}) {
  const W = width;
  const H = rows.some((r) => r.sub2) ? 136 : 126;
  const L = left;
  const B = 92;
  const T = 72;
  const n = Math.max(rows.length, 1);
  const slot = (W - L - 6) / n;
  const bw = Math.min(42, slot * 0.6);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={alt}>
      <line className="axis" x1={L} x2={W} y1={B} y2={B} />
      {ticks.map((f) => (
        <Fragment key={f}>
          <line className="grid" x1={L} x2={W} y1={B - f * T} y2={B - f * T} />
          <text className="axlbl" x={L - 4} y={B - f * T + 3} textAnchor="end">
            {yTick(ymax * f)}
          </text>
        </Fragment>
      ))}
      {rows.map((r, i) => {
        const cx = L + (i + 0.5) * slot;
        const h = r.value == null ? T * 0.35 : (Math.max(0, Math.min(r.value, ymax)) / (ymax || 1)) * T;
        return (
          <g key={r.id}>
            {r.value == null ? (
              <>
                <rect
                  x={cx - bw / 2}
                  y={B - h}
                  width={bw}
                  height={h}
                  rx={3}
                  fill="none"
                  stroke={C_PENDING}
                  strokeDasharray="3 2"
                />
                <text className="axlbl" x={cx} y={B - h - 4} textAnchor="middle" fill={C_PENDING}>
                  {pendingLabel}
                </text>
              </>
            ) : (
              <>
                <rect x={cx - bw / 2} y={B - h} width={bw} height={h} rx={3} fill={color} />
                <text className="dl" x={cx} y={B - h - 4} textAnchor="middle">
                  {r.text ?? ''}
                </text>
              </>
            )}
            <text className="axlbl" x={cx} y={B + 12} textAnchor="middle">
              {r.label}
            </text>
            {r.sub && (
              <text className="axlbl" x={cx} y={B + 22} textAnchor="middle">
                {r.sub}
              </text>
            )}
            {r.sub2 && (
              <text className="axlbl" x={cx} y={B + 32} textAnchor="middle">
                {r.sub2}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export interface RhythmPanelData {
  id: string;
  title: string;
  /** printed under the title: "90 % served · 40/20/40" */
  sub: string;
  /** share of the day's potential trips in each period, 0..1 (from the scenario's own weights) */
  share: number[];
  /** served / potential per period, 0..1 — null while the run is pending */
  served: number[] | null;
}

/**
 * Question 4: one small panel per rhythm, the model's periods on the x axis. Bar height = the
 * period's share of the day's trips (its magnitude), the filled part = the share of it the model
 * serves. Every panel uses the same y scale so the rhythms compare at a glance.
 */
export function RhythmPanels({
  panels,
  periods,
  ymax,
  pendingLabel,
  servedLabel,
  alt,
}: {
  panels: RhythmPanelData[];
  /** two lines per period: name and hours */
  periods: [string, string][];
  /** ceiling of the share axis, 0..1 */
  ymax: number;
  pendingLabel: string;
  servedLabel: (ratio: number) => string;
  alt: string;
}) {
  const W = 200;
  const H = 150;
  const L = 28;
  const B = 94;
  const T = 76;
  return (
    <div className="multi" role="img" aria-label={alt}>
      {panels.map((p) => {
        const n = Math.max(p.share.length, 1);
        const slot = (W - L - 6) / n;
        const bw = Math.min(40, slot * 0.6);
        return (
          <div className="mpanel" key={p.id}>
            <div className="mtitle">
              <b>{p.title}</b>
              <span>{p.sub}</span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <line className="axis" x1={L} x2={W} y1={B} y2={B} />
              {ticks.map((f) => (
                <Fragment key={f}>
                  <line className="grid" x1={L} x2={W} y1={B - f * T} y2={B - f * T} />
                  <text className="axlbl" x={L - 4} y={B - f * T + 3} textAnchor="end">
                    {Math.round(ymax * f * 100)}
                  </text>
                </Fragment>
              ))}
              {p.share.map((s, i) => {
                const cx = L + (i + 0.5) * slot;
                const h = (Math.min(s, ymax) / ymax) * T;
                const r = p.served?.[i];
                const hs = r == null ? 0 : h * Math.max(0, Math.min(1, r));
                return (
                  <g key={i}>
                    <rect
                      x={cx - bw / 2}
                      y={B - h}
                      width={bw}
                      height={h}
                      rx={3}
                      fill={p.served ? C_POTENTIAL : 'none'}
                      stroke={p.served ? C_POTENTIAL_LINE : C_PENDING}
                      strokeDasharray={p.served ? undefined : '3 2'}
                    />
                    {p.served && <rect x={cx - bw / 2} y={B - hs} width={bw} height={hs} rx={3} fill={C_SERIES} />}
                    <text className="dl" x={cx} y={B - h - 4} textAnchor="middle">
                      {Math.round(s * 100)} %
                    </text>
                    <text className="axlbl" x={cx} y={B + 11} textAnchor="middle">
                      {periods[i]?.[0] ?? i + 1}
                    </text>
                    <text className="axlbl" x={cx} y={B + 21} textAnchor="middle">
                      {periods[i]?.[1] ?? ''}
                    </text>
                    <text className="dl" x={cx} y={B + 33} textAnchor="middle" fill={r == null ? C_PENDING : C_SERIES}>
                      {r == null ? pendingLabel : servedLabel(r)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        );
      })}
    </div>
  );
}
