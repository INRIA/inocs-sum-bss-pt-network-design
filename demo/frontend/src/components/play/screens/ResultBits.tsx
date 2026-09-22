import { useState, type CSSProperties } from 'react';

import type { BikesFacts } from '../../../domain/game/predictions';
import type { LossRow, PeriodRow, ResultsView } from '../../../domain/game/results';
import type { TicketMark } from '../../../domain/game/ticket';
import { PeriodChart } from '../../Charts';
import { fmtInt, fmtNum, fmtPct } from '../../../lib/format';
import type { T } from '../../../lib/i18n';
import type { Lang } from '../../../lib/types';

/**
 * The pieces steps 4 and 5 both show, so the two screens can never drift apart
 * (plan.md §5: "same tiles in step 4 and step 5").
 *
 * Every tile answers ONE prediction and carries the visitor's own guess beside
 * the number — the consequence-and-reminder pair of UX reference §5. None of
 * them says right or wrong: the guess is shown, the number is shown, and the
 * visitor draws the line.
 */

/** The fallback engine ran: the UI is REQUIRED to say so (ports.ts `quality`). */
export function EstimateTag({ t }: { t: T }) {
  return <span className="playtag playest">{t('play.estimate.tag')}</span>;
}

export function Hero({
  hero,
  lang,
  t,
  quality,
}: {
  hero: ResultsView['hero'];
  lang: Lang;
  t: T;
  quality?: 'exact' | 'estimate';
}) {
  return (
    <div className="playhero">
      <b className="mono">{fmtPct(lang, hero.ratio, 0)}</b>
      <span>
        {t('play.hero.line', { served: fmtInt(hero.served), total: fmtInt(hero.demand) })}
        {quality === 'estimate' && <> <EstimateTag t={t} /></>}
      </span>
    </div>
  );
}

/**
 * Three marks on ONE line: a planner placing at random · you · the optimiser.
 * Positions, not a score — no ranking word appears here or in the copy.
 */
/** Two labels closer than this share of the line would overlap: stagger them. */
export const MARK_MIN_GAP_PCT = 12;

/**
 * A label centred on a mark near either end hangs off the card (the optimiser
 * is always the rightmost mark, so it always did). The DOT stays exactly on
 * its value; only the text is pulled back inside.
 */
export function markNudge(left: number): number {
  if (left > 85) return -22;
  if (left < 15) return 22;
  return 0;
}

/**
 * Where each mark sits on the line, and on which row its label goes.
 *
 * Marks are laid out left to right; a label whose mark is within
 * `MARK_MIN_GAP_PCT` of the previous one drops to the next row, so two nearly
 * coincident marks never print on top of each other. Pure: the screen only
 * turns the result into `left` and a `--tier` custom property.
 */
export function markTiers(
  positions: readonly number[],
  minGap = MARK_MIN_GAP_PCT,
): number[] {
  const order = positions.map((left, index) => ({ left, index })).sort((a, b) => a.left - b.left);
  const tiers = new Array<number>(positions.length).fill(0);
  let lastLeft = Number.NEGATIVE_INFINITY;
  let tier = 0;
  for (const entry of order) {
    tier = entry.left - lastLeft < minGap ? tier + 1 : 0;
    tiers[entry.index] = tier;
    lastLeft = entry.left;
  }
  return tiers;
}

export function MarksLine({ marks, lang, t }: { marks: readonly TicketMark[]; lang: Lang; t: T }) {
  const max = Math.max(...marks.map((mark) => mark.ratio), 0.05);
  const lefts = marks.map((mark) => Math.min(98, (mark.ratio / max) * 94 + 2));
  const tiers = markTiers(lefts);
  return (
    <div className="playmarks" aria-label={t('play.marks.aria')}>
      <div
        className="playmarkrail"
        style={{ '--tiers': Math.max(0, ...tiers) } as CSSProperties}
      >
        {marks.map((mark, index) => (
          <span
            key={mark.key}
            className={`playmark playmark-${mark.key}`}
            style={
              {
                left: `${lefts[index]}%`,
                '--tier': tiers[index],
                '--nudge': markNudge(lefts[index] ?? 0),
              } as CSSProperties
            }
          >
            <i aria-hidden="true" />
            <b>{t(mark.labelKey)}</b>
            <em>{fmtPct(lang, mark.ratio, 0)}</em>
          </span>
        ))}
      </div>
    </div>
  );
}

/** One KPI tile with the visitor's own answer under it. `guess` is null when unasked. */
export function GuessTile({
  label,
  value,
  sub,
  guess,
  t,
}: {
  label: string;
  value: string;
  sub?: string;
  guess: string | null;
  t: T;
}) {
  return (
    <div className="card playtile">
      <span className="playtilelab">{label}</span>
      <b className="mono">{value}</b>
      {sub && <span className="playtilesub">{sub}</span>}
      {guess && <span className="playguess">{t('play.tile.guess', { answer: guess })}</span>}
    </div>
  );
}

/** "Trips lost, and why" — the only strip that tells the visitor what to fix. */
export function LossStrip({
  losses,
  lang,
  t,
}: {
  losses: readonly LossRow[];
  lang: Lang;
  t: T;
}) {
  const shown = losses.filter((row) => row.flow > 0.5);
  return (
    <div className="playlosses">
      <p className="decklab">{t('play.loss.h')}</p>
      {shown.length === 0 ? (
        <p className="note">{t('play.loss.none')}</p>
      ) : (
        <ul>
          {shown.map((row) => (
            <li key={row.cause}>
              <b className="mono">{fmtInt(row.flow)}</b>
              <span>{t(`play.loss.${row.cause}`)}</span>
              <em>{fmtPct(lang, row.share, 0)}</em>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The period chart of the full demo, fed with the game's own rows. */
export function PeriodBlock({
  periods,
  split,
  lang,
  t,
}: {
  periods: readonly PeriodRow[];
  /** False for the estimate engine: with no flows there is no bike-only / bike + PT split. */
  split: boolean;
  lang: Lang;
  t: T;
}) {
  const served = periods.map((row) => row.served);
  const demand = periods.map((row) => row.demand);
  return (
    <div className="playchart">
      <p className="decklab">{t('play.chart.h')}</p>
      <PeriodChart
        demand={demand}
        bikeOnly={split ? periods.map((row) => row.bikeOnly) : served}
        bikePt={split ? periods.map((row) => row.bikePt) : periods.map(() => 0)}
        served={served}
        labels={periods.map((row) => t(`s5.per.${row.period}`))}
        shares={periods.map((row) =>
          t('play.chart.share', { pct: fmtPct(lang, row.demand > 0 ? row.served / row.demand : 0, 0) }),
        )}
        alt={t('play.chart.alt')}
      />
      <p className="note">{split ? t('play.chart.note') : t('play.chart.nosplit')}</p>
    </div>
  );
}

/** "How is this computed?" — the method note of plan.md §3, one tap away. */
export function MethodNote({ t }: { t: T }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="playmethod">
      <button className="ghostbtn small" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t('play.method.open')}
      </button>
      {open && (
        <div className="playmethodbody">
          <b>{t('play.method.title')}</b>
          <p className="note">{t('play.method.engine')}</p>
          <p className="note">{t('play.method.tolerance')}</p>
          <p className="note">{t('play.method.trucks')}</p>
          <p className="note">{t('play.method.upper')}</p>
        </div>
      )}
    </div>
  );
}

/** Two percentages in one tile value: "97 % · 89 %". */
export const twoRates = (lang: Lang, a: number, b: number): string =>
  `${fmtPct(lang, a, 0)} · ${fmtPct(lang, b, 0)}`;

/** A signed gap in percentage points, for the rush tile's sub-line. */
export const gapLabel = (lang: Lang, points: number, t: T): string =>
  t('play.tile.rush.gap', { gap: fmtNum(lang, Math.abs(points), 1) });

/** The five ways a potential trip ends, in the order the pie and its legend list them. */
export type TripFate = 'bikeOnly' | 'bikePt' | 'noStation' | 'noStock' | 'unreachable';

export const FATE_COLORS: Record<TripFate, string> = {
  bikeOnly: '#6b9410',
  bikePt: '#8ec5f0',
  noStation: '#d62828',
  noStock: '#f28c28',
  unreachable: '#949c93',
};

export interface FateSlice {
  readonly fate: TripFate;
  readonly trips: number;
  /** Share of the day's trips, 0..1. */
  readonly share: number;
  /** Running total of the shares up to and including this slice. */
  readonly accumulated: number;
}

/**
 * Where the day's potential trips ended, every share taken from the day's
 * TOTAL number of trips (`hero.demand`), so it matches the cards:
 * bike only = served - connected to public transport; bike + PT = the trips
 * the "connected to public transport" card counts; the three losses are their
 * flow over the total. Pure, so the pie and its legend can never disagree.
 */
export function fateSlices(view: Pick<ResultsView, 'hero' | 'pt' | 'losses'>): FateSlice[] {
  const lost = (cause: LossRow['cause']): number =>
    view.losses.find((row) => row.cause === cause)?.flow ?? 0;
  const total = view.hero.demand;
  const bikePt = Math.min(view.pt.trips, view.hero.served);
  const trips: Record<TripFate, number> = {
    bikeOnly: Math.max(0, view.hero.served - bikePt),
    bikePt,
    noStation: lost('noStation'),
    noStock: lost('noStock'),
    unreachable: lost('unreachable'),
  };
  const order: TripFate[] = ['bikeOnly', 'bikePt', 'noStation', 'noStock', 'unreachable'];
  let running = 0;
  return order.map((fate) => {
    const share = total > 0 ? trips[fate] / total : 0;
    running += share;
    return { fate, trips: trips[fate], share, accumulated: Math.min(1, running) };
  });
}

const arcPath = (from: number, to: number, r: number): string => {
  const point = (share: number): string =>
    `${(50 + r * Math.sin(share * 2 * Math.PI)).toFixed(3)} ${(50 - r * Math.cos(share * 2 * Math.PI)).toFixed(3)}`;
  return `M50 50 L${point(from)} A${r} ${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${point(to)} Z`;
};

/** "Where the day's trips went": a pie, with each share and the running total beside it. */
export function TripsPie({ view, lang, t }: { view: Pick<ResultsView, 'hero' | 'pt' | 'losses'>; lang: Lang; t: T }) {
  const slices = fateSlices(view);
  const shown = slices.filter((slice) => slice.share > 0);
  let start = 0;
  return (
    <div className="playpie">
      <p className="decklab">{t('play.pie.h')}</p>
      <div className="playpiebody">
        <svg viewBox="0 0 100 100" role="img" aria-label={t('play.pie.alt')} className="playpiesvg">
          {shown.length === 0 && <circle cx="50" cy="50" r="46" fill="var(--line)" />}
          {shown.length === 1 && <circle cx="50" cy="50" r="46" fill={FATE_COLORS[shown[0]!.fate]} />}
          {shown.length > 1 &&
            shown.map((slice) => {
              const from = start;
              start += slice.share;
              return (
                <path
                  key={slice.fate}
                  d={arcPath(from, start, 46)}
                  fill={FATE_COLORS[slice.fate]}
                  stroke="var(--surface)"
                  strokeWidth="0.8"
                />
              );
            })}
        </svg>
        <ul className="playpieleg">
          {slices.map((slice) => (
            <li key={slice.fate}>
              <i style={{ background: FATE_COLORS[slice.fate] }} aria-hidden="true" />
              <span>{t(`play.pie.${slice.fate}`)}</span>
              <b className="mono">{fmtPct(lang, slice.share, 0)}</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Service rate per period, as bars labelled with the percentage only. */
export function PeriodBars({ periods, lang, t }: { periods: readonly PeriodRow[]; lang: Lang; t: T }) {
  return (
    <div className="playbars">
      <p className="decklab">{t('play.bars.h')}</p>
      <ul>
        {periods.map((row) => {
          const rate = row.demand > 0 ? row.served / row.demand : 0;
          return (
            <li key={row.period}>
              <span>{t(`s5.per.${row.period}`)}</span>
              <div className="playbartrack" aria-hidden="true">
                <div className="playbarfill" style={{ width: `${Math.round(rate * 100)}%` }} />
              </div>
              <b className="mono">{fmtPct(lang, rate, 0)}</b>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The tiles, the trip-fate pie and the period bars of steps 4 and 5, in one
 * place so the visitor's network and the optimiser's are always read the same way.
 * `guess` is only passed on step 4, where a tile answers a step-3 prediction.
 */
export function ResultsBlock({
  view,
  guess,
  bikes,
  nothingToRebalance,
  trucksSub,
  lang,
  t,
}: {
  view: ResultsView;
  guess?: (id: 'served' | 'pt' | 'trucks' | 'bikes') => string | null;
  /**
   * The optimiser's own plan at this budget, for the "bikes per station" tile:
   * one figure for the whole plan, computed off the committed run, so it is the
   * same number whatever the visitor placed (and the same one the map badges).
   */
  bikes?: BikesFacts | null;
  nothingToRebalance: boolean;
  /** Overrides the trucks tile's sub-line (the optimiser knows its own run count). */
  trucksSub?: string;
  lang: Lang;
  t: T;
}) {
  const ask = guess ?? (() => null);
  return (
    <>
      <div className="facts playtiles">
        <GuessTile
          label={t('play.kpi.service')}
          value={fmtPct(lang, view.hero.ratio, 0)}
          sub={t('play.hero.line', { served: fmtInt(view.hero.served), total: fmtInt(view.hero.demand) })}
          guess={ask('served')}
          t={t}
        />
        <GuessTile
          label={t('play.tile.pt')}
          value={fmtPct(lang, view.pt.share, 0)}
          sub={t('play.tile.pt.sub', { trips: fmtInt(view.pt.trips) })}
          guess={ask('pt')}
          t={t}
        />
        <GuessTile
          label={t('play.kpi.trucks')}
          value={fmtInt(view.trucks.dependOnTrucks)}
          sub={
            nothingToRebalance
              ? t('play.tile.trucks.nothing')
              : (trucksSub ?? t('play.kpi.trucks.sub'))
          }
          guess={ask('trucks')}
          t={t}
        />
        <GuessTile
          label={t('play.kpi.stations')}
          value={fmtInt(view.built.stations)}
          sub={t('play.kpi.stations.sub', { n: fmtInt(view.built.atPtStops) })}
          guess={null}
          t={t}
        />
        {bikes && (
          <GuessTile
            label={t('play.kpi.bikes')}
            value={fmtInt(Math.round(bikes.mean))}
            sub={t('play.kpi.bikes.sub', {
              min: fmtInt(bikes.min),
              max: fmtInt(bikes.max),
              bikes: fmtInt(bikes.bikes),
              stations: fmtInt(bikes.stations),
            })}
            guess={ask('bikes')}
            t={t}
          />
        )}
      </div>
      <div className="playcharts">
        <TripsPie view={view} lang={lang} t={t} />
        <PeriodBars periods={view.periods} lang={lang} t={t} />
      </div>
    </>
  );
}
