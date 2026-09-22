import { useState } from 'react';

import type { ResultsView } from '../../../domain/game/results';
import type { BudgetId } from '../../../domain/game/session';
import { LadderChart, type LadderPoint } from '../../Charts';
import { fmtEur, fmtInt, fmtPct } from '../../../lib/format';
import type { T } from '../../../lib/i18n';
import type { Lang } from '../../../lib/types';
import type { BudgetRung, ContributionFacts } from '../optimiserFacts';
import { MethodNote, ResultsBlock } from './ResultBits';

/**
 * Step 5 — the optimiser's networks, one budget at a time.
 *
 * The expert contribution arrives right after the visitor felt the difficulty
 * (UX reference §5) and is stated honestly (plan.md §2bis): placing stations
 * where people are gets most of the way, so the sentence leads with the SIZING.
 *
 * The four budget chips are always there: choosing one redraws the map AND the
 * results below, which are the very tiles and charts of step 4 (`ResultsBlock`)
 * computed by the same engine, so the budgets can be compared reading the same
 * numbers. The published figure stays one tap away rather than in place of them.
 */
export interface OptimiserProps {
  contribution: ContributionFacts | null;
  /** The optimiser's network for the browsed budget, in the shape step 4 prints. */
  view: ResultsView | null;
  published: { served: number; ratio: number };
  mine: number;
  shared: number;
  trucks: boolean;
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

export default function Optimiser(props: OptimiserProps) {
  const { contribution, view, lang, t } = props;
  const [paper, setPaper] = useState(false);
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
      </section>

      {view && (
        <>
          <ResultsBlock
            view={view}
            nothingToRebalance={view.trucks.dependOnTrucks < 1 && (view.trucks.dispatches ?? 0) < 1}
            trucksSub={
              view.trucks.dispatches != null
                ? t('play.optimiser.trucks.sub', { runs: fmtInt(view.trucks.dispatches) })
                : undefined
            }
            lang={lang}
            t={t}
          />
          <MethodNote t={t} />
        </>
      )}
      {plateau && <p className="note playplateau">{t('play.compare.plateau')}</p>}
      <p className="note">
        {t('play.compare.overlap', { shared: fmtInt(props.shared), mine: fmtInt(props.mine) })}
      </p>

      {/* <LadderChart
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
      <p className="note">{t('play.optimiser.ladder.note')}</p> */}
    </>
  );
}
