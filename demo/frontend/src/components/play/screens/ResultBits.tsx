import { useState } from 'react';

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
export function MarksLine({ marks, lang, t }: { marks: readonly TicketMark[]; lang: Lang; t: T }) {
  const max = Math.max(...marks.map((mark) => mark.ratio), 0.05);
  return (
    <div className="playmarks" aria-label={t('play.marks.aria')}>
      <div className="playmarkrail">
        {marks.map((mark) => (
          <span
            key={mark.key}
            className={`playmark playmark-${mark.key}`}
            style={{ left: `${Math.min(98, (mark.ratio / max) * 94 + 2)}%` }}
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

/** "With service trucks / Without" — the switch of plan-technical §A.1. */
export function TrucksSwitch({
  trucks,
  onChange,
  t,
}: {
  trucks: boolean;
  onChange: (value: boolean) => void;
  t: T;
}) {
  return (
    <div className="playswitch seg" role="group" aria-label={t('play.trucks.h')}>
      <button aria-pressed={trucks} onClick={() => onChange(true)}>
        {t('play.trucks.with')}
      </button>
      <button aria-pressed={!trucks} onClick={() => onChange(false)}>
        {t('play.trucks.without')}
      </button>
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
