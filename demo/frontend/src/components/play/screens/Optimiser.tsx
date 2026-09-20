import { useState } from 'react';

import type { CompareRow } from '../../../domain/game/results';
import type { PredictionQuestion } from '../../../domain/game/predictions';
import type { BudgetId } from '../../../domain/game/session';
import { LadderChart, type LadderPoint } from '../../Charts';
import { fmtEur, fmtInt, fmtNum, fmtPct } from '../../../lib/format';
import type { T } from '../../../lib/i18n';
import type { Lang } from '../../../lib/types';
import type { BudgetRung, ContributionFacts } from '../optimiserFacts';
import type { Reveal } from '../reveal';
import { TrucksSwitch } from './ResultBits';

/**
 * Step 5 — the same budget, optimised.
 *
 * The expert contribution arrives right after the visitor felt the difficulty
 * (UX reference §5), and it is stated honestly (plan.md §2bis): placing
 * stations where people are gets most of the way, so the table leads with the
 * SIZING — stations, docks, bikes, truck runs — and only then with served
 * trips. Both columns come from the same engine, and the published figure is
 * one tap away rather than in place of it.
 *
 * The in-context poll is asked BEFORE the budget CTA, and the CTA it motivates
 * is what reveals the four budget chips.
 */
export interface OptimiserProps {
  contribution: ContributionFacts | null;
  rows: readonly CompareRow[];
  published: { served: number; ratio: number };
  mine: number;
  shared: number;
  trucks: boolean;
  onTrucks: (value: boolean) => void;
  question: PredictionQuestion;
  answer: string | undefined;
  onAnswer: (optionId: string) => void;
  reveal: Reveal | null;
  budgets: readonly { id: BudgetId; eur: number; label: string }[];
  browsing: BudgetId;
  onBrowse: (id: BudgetId) => void;
  rungs: readonly BudgetRung[];
  browsed: BudgetRung | null;
  visitorServed: number;
  visitorBudgetEur: number;
  lang: Lang;
  t: T;
}

/**
 * Above 100 k€ the capital budget is no longer what binds (plan.md §3, known
 * limits): the dock cap is. Docks and bikes are then not comparable between
 * the two columns, and the footnote says so rather than leaving the reader to
 * read a plateau as a price.
 */
export const PLATEAU_EUR = 100000;

/** One cell of the compare table, printed the way its row asks. */
function cell(lang: Lang, value: number | null, format: CompareRow['format']): string {
  if (value == null) return '—';
  if (format === 'share') return fmtPct(lang, value, 0);
  if (format === 'points') return `${fmtNum(lang, value, 1)} pts`;
  return fmtInt(value);
}

export default function Optimiser(props: OptimiserProps) {
  const { contribution, rows, lang, t } = props;
  const [paper, setPaper] = useState(false);
  const [chips, setChips] = useState(false);
  const answered = Boolean(props.answer);
  const browsedEur = props.budgets.find((budget) => budget.id === props.browsing)?.eur ?? 0;
  const plateau = Math.max(browsedEur, props.visitorBudgetEur) >= PLATEAU_EUR;

  const points: LadderPoint[] = props.rungs.map((rung) => ({
    id: rung.id,
    x: rung.budgetEur,
    tick: fmtEur(rung.budgetEur),
    value: rung.served,
    legacy: false,
    label: fmtInt(rung.served),
  }));
  const ymax = Math.max(...props.rungs.map((rung) => rung.served), props.visitorServed, 1) * 1.12;

  return (
    <>
      <p className="eyebrow">{t('play.optimiser.eyebrow')}</p>
      <h2>{t('play.optimiser.title')}</h2>
      <p className="lede">{t('play.optimiser.lede')}</p>

      {contribution && (
        <p className="playline playcontrib">
          {t('play.optimiser.contribution', {
            stations: fmtInt(contribution.stations),
            fewer: fmtInt(contribution.fewerStations),
            more: fmtInt(contribution.moreStations),
            docks: fmtInt(contribution.docks),
            bikes: fmtInt(contribution.bikes),
            runs: fmtInt(contribution.dispatches),
            mostRuns: fmtInt(contribution.mostDispatches),
            step: fmtEur(contribution.nextBudgetStepEur),
            trips: fmtInt(contribution.nextTrips),
          })}
        </p>
      )}

      <TrucksSwitch trucks={props.trucks} onChange={props.onTrucks} t={t} />

      <div className="tw playcompare">
        <table>
          <thead>
            <tr>
              <th>{t('play.compare.h')}</th>
              <th className="n">{t('play.compare.you')}</th>
              <th className="n">{t('play.compare.optimiser')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{t(row.labelKey)}</td>
                <td className="n">{cell(lang, row.you, row.format)}</td>
                <td className="n">{cell(lang, row.optimiser, row.format)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">{t('play.compare.note')}</p>
      {plateau && <p className="note playplateau">{t('play.compare.plateau')}</p>}
      <p className="note">
        {t('play.compare.overlap', { shared: fmtInt(props.shared), mine: fmtInt(props.mine) })}
      </p>
      <button className="ghostbtn small" aria-expanded={paper} onClick={() => setPaper(!paper)}>
        {t('play.compare.paper.open')}
      </button>
      {paper && (
        <p className="note playpaper">
          {t('play.compare.paper', {
            served: fmtInt(props.published.served),
            ratio: fmtPct(lang, props.published.ratio, 0),
          })}
        </p>
      )}

      <section className="playpoll">
        <h3 className="playq">{t(props.question.questionKey)}</h3>
        <div className="playoptions">
          {props.question.options.map((option) => (
            <button
              key={option.id}
              className="playoption"
              aria-pressed={props.answer === option.id}
              onClick={() => props.onAnswer(option.id)}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
        {props.reveal && (
          <div className="playreveal">
            <p>{t(props.reveal.key, props.reveal.vars)}</p>
            {props.reveal.noteKey && (
              <p className="note">{t(props.reveal.noteKey, props.reveal.vars)}</p>
            )}
          </div>
        )}
      </section>

      {answered && !chips && (
        <button className="cta" onClick={() => setChips(true)}>
          {t('play.optimiser.browse')}
        </button>
      )}

      {answered && chips && (
        <section className="playbrowse">
          <div className="playchips" role="group" aria-label={t('play.optimiser.browse')}>
            {props.budgets.map((budget) => (
              <button
                key={budget.id}
                className="playchip"
                aria-pressed={props.browsing === budget.id}
                onClick={() => props.onBrowse(budget.id)}
              >
                {budget.label}
              </button>
            ))}
          </div>
          {props.browsed && (
            <p className="playline">
              {t('play.optimiser.rung', {
                budget: fmtEur(props.browsed.budgetEur),
                served: fmtInt(props.browsed.served),
                ratio: fmtPct(lang, props.browsed.ratio, 0),
                stations: fmtInt(props.browsed.stations),
                pertrip: fmtEur(props.browsed.perTripEur),
              })}
            </p>
          )}
          <LadderChart
            points={points}
            ymax={ymax}
            yTick={(value) => fmtInt(value)}
            pendingLabel={t('pending.row')}
            alt={t('play.optimiser.ladder.alt')}
            mark={{
              x: props.visitorBudgetEur,
              value: props.visitorServed,
              label: t('play.mark.you'),
            }}
          />
          <p className="note">{t('play.optimiser.ladder.note')}</p>
        </section>
      )}
    </>
  );
}
