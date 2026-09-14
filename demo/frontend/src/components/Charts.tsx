import type { DayData, Lang } from '../lib/types';
import type { T } from '../lib/i18n';
import { fmtNum, hh } from '../lib/format';

/**
 * SUM blue = served / capacity, SUM red = riders turned away. Green is never a data series
 * (ux-plan section 6) — it belongs to the "you / commit" register.
 */
const AX = [0, 6, 12, 18, 23];

export function TripsChart({
  hourly,
  t,
  lang,
  onPick,
  alt,
}: {
  hourly: DayData['hourly'];
  t: T;
  lang: Lang;
  onPick: (s: string) => void;
  alt: string;
}) {
  const T_ = 110;
  const B = 112;
  const max = Math.max(...hourly.demand, 1);
  const ticks = max < 2 ? [0, 1] : [0, 0.5, 1];
  // xMidYMax meet inside a flex-sized card is what keeps the chart large in the stacked
  // right-hand column (ux-plan-v2 section 9.6)
  return (
    <svg viewBox="0 0 360 126" preserveAspectRatio="xMidYMax meet" role="img" aria-label={alt}>
      {ticks.map((f) => (
        <g key={f}>
          <line className="grid" x1={0} x2={360} y1={B - f * T_ * 0.94} y2={B - f * T_ * 0.94} />
          <text className="axlbl" x={2} y={B - f * T_ * 0.94 - 3}>
            {Math.round(max * f)}
          </text>
        </g>
      ))}
      {hourly.demand.map((d, h) => {
        const srv = hourly.served[h];
        const uns = Math.max(0, d - srv);
        const x = h * 15 + 2;
        const w = 11;
        const hs = (srv / max) * T_ * 0.94;
        const hu = (uns / max) * T_ * 0.94;
        return (
          <g
            key={h}
            style={{ cursor: 'pointer' }}
            onClick={() =>
              onPick(
                `${hh(h)} — ${d} ${t('d.ch1.l1').toLowerCase()}: ${fmtNum(lang, srv)}${
                  uns > 0 ? ` · ${t('d.ch1.l2').toLowerCase()}: ${fmtNum(lang, uns)}` : ''
                }`
              )
            }
          >
            {srv > 0 && <rect x={x} y={B - hs} width={w} height={hs} rx={2} fill="#004494" />}
            {uns > 0 && <rect x={x} y={B - hs - hu - 2} width={w} height={Math.max(1.5, hu)} rx={2} fill="#ff3514" />}
            {d === 0 && <rect x={x} y={B - 1.5} width={w} height={1.5} fill="#C6D9CD" />}
            <rect x={x - 2} y={0} width={15} height={B} fill="transparent" />
            <title>{`${h}:00 — ${d} / ${fmtNum(lang, srv)}`}</title>
          </g>
        );
      })}
      {AX.map((h) => (
        <text key={h} className="axlbl" x={h * 15 + 2} y={B + 11}>
          {h}h
        </text>
      ))}
    </svg>
  );
}

export function EmptyFullChart({
  hourly,
  t,
  onPick,
  alt,
}: {
  hourly: DayData['hourly'];
  t: T;
  onPick: (s: string) => void;
  alt: string;
}) {
  const T_ = 86;
  const B = 92;
  const max = Math.max(...hourly.empty, ...hourly.full, 1);
  const ticks = max < 2 ? [0, 1] : [0, 0.5, 1];
  return (
    <svg viewBox="0 0 360 106" preserveAspectRatio="xMidYMax meet" role="img" aria-label={alt}>
      {ticks.map((f) => (
        <g key={f}>
          <line className="grid" x1={0} x2={360} y1={B - f * T_} y2={B - f * T_} />
          <text className="axlbl" x={2} y={B - f * T_ - 3}>
            {Math.round(max * f)}
          </text>
        </g>
      ))}
      {Array.from({ length: 24 }, (_, h) => {
        const x = h * 15 + 2;
        const he = (hourly.empty[h] / max) * T_;
        const hf = (hourly.full[h] / max) * T_;
        return (
          <g
            key={h}
            style={{ cursor: 'pointer' }}
            onClick={() => onPick(`${hh(h)} — ${t('d.ch2.l1')}: ${hourly.empty[h]} · ${t('d.ch2.l2')}: ${hourly.full[h]}`)}
          >
            {hourly.empty[h] > 0 && <rect x={x} y={B - he} width={5} height={he} rx={1.5} fill="#ff3514" />}
            {hourly.full[h] > 0 && <rect x={x + 6} y={B - hf} width={5} height={hf} rx={1.5} fill="#004494" />}
            {hourly.empty[h] === 0 && hourly.full[h] === 0 && <rect x={x} y={B - 1.2} width={11} height={1.2} fill="#C6D9CD" />}
            <rect x={x - 2} y={0} width={15} height={B} fill="transparent" />
            <title>{`${h}:00 — ${hourly.empty[h]} / ${hourly.full[h]}`}</title>
          </g>
        );
      })}
      {AX.map((h) => (
        <text key={h} className="axlbl" x={h * 15 + 2} y={B + 11}>
          {h}h
        </text>
      ))}
    </svg>
  );
}
