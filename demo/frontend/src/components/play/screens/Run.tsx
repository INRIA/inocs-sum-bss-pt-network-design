import type { PredictionId } from '../../../domain/game/predictions';
import type { ResultsView } from '../../../domain/game/results';
import type { TicketMark } from '../../../domain/game/ticket';
import type { EvaluationStatus } from '../../../hooks/useEvaluation';
import { fmtInt, fmtPct } from '../../../lib/format';
import type { T } from '../../../lib/i18n';
import type { Lang } from '../../../lib/types';
import {
  EstimateTag,
  GuessTile,
  Hero,
  LossStrip,
  MarksLine,
  MethodNote,
  PeriodBlock,
  TrucksSwitch,
  gapLabel,
  twoRates,
} from './ResultBits';

/**
 * Step 4 — the day the visitor's network runs, then what it did.
 *
 * Observe, in the rhythm of UX reference §3: the map plays the five-second run
 * first (the shell keeps the sheet at `peek` for it), and the results rise
 * afterwards. Consequence and reminder in one screen — every tile carries the
 * guess made in step 3 next to the number it answers (UX reference §5).
 *
 * Nothing here ranks anything. The three marks are POSITIONS on one line, and
 * the visitor's own truck figure is never a truck count: the relaxed LP buys
 * fractional runs, so the honest number is "trips that depend on trucks"
 * (plan.md §3).
 */
export interface RunProps {
  status: EvaluationStatus;
  view: ResultsView | null;
  marks: readonly TicketMark[] | null;
  answers: Readonly<Partial<Record<PredictionId, string>>>;
  trucks: boolean;
  onTrucks: (value: boolean) => void;
  onReplay: () => void;
  /** Null under reduced motion, where the period is stepped by hand instead. */
  periodName: string | null;
  reduced: boolean;
  period: number;
  onPeriod: (period: number) => void;
  periods: number;
  /** True at 20 k€, where the two truck states are all but identical. */
  nothingToRebalance: boolean;
  onRetry: () => void;
  lang: Lang;
  t: T;
}

export default function Run(props: RunProps) {
  const { status, view, marks, answers, lang, t } = props;
  const guess = (id: PredictionId): string | null => {
    const chosen = answers[id];
    return chosen ? t(`play.q.${id}.${chosen}`) : null;
  };

  return (
    <>
      <p className="eyebrow">{t('play.run.eyebrow')}</p>
      <h2>{t('play.run.title')}</h2>
      <p className="lede">{t('play.run.lede')}</p>

      <div className="playrunbar">
        <button className="ghostbtn" onClick={props.onReplay} disabled={status === 'running'}>
          {t('play.run.replay')}
        </button>
        {props.reduced ? (
          <span className="seg playperiods" role="group" aria-label={t('play.run.periods')}>
            {Array.from({ length: props.periods }, (_, index) => (
              <button
                key={index}
                aria-pressed={props.period === index}
                onClick={() => props.onPeriod(index)}
              >
                {t(`s5.per.${index}`)}
              </button>
            ))}
          </span>
        ) : (
          props.periodName && <span className="playperiod">{props.periodName}</span>
        )}
        {status === 'estimate' && <EstimateTag t={t} />}
      </div>

      {status === 'running' && <p className="playstatus">{t('play.run.waiting')}</p>}
      {status === 'error' && (
        <p className="playstatus playwarn">
          {t('play.run.failed')}{' '}
          <button className="ghostbtn small" onClick={props.onRetry}>
            {t('play.run.retry')}
          </button>
        </p>
      )}

      {view && (
        <>
          <Hero hero={view.hero} lang={lang} t={t} quality={view.quality} />
          <MarksLine marks={marks ?? []} lang={lang} t={t} />

          <TrucksSwitch trucks={props.trucks} onChange={props.onTrucks} t={t} />

          <div className="facts playtiles">
            <GuessTile
              label={t('play.tile.pt')}
              value={fmtPct(lang, view.pt.share, 0)}
              sub={t('play.tile.pt.sub', { trips: fmtInt(view.pt.trips) })}
              guess={guess('pt')}
              t={t}
            />
            <GuessTile
              label={t('play.tile.rush')}
              value={twoRates(lang, view.rush.peakRate, view.rush.middayRate)}
              sub={gapLabel(lang, view.rush.gapPoints, t)}
              guess={guess('rush')}
              t={t}
            />
            <GuessTile
              label={t('play.tile.trucks')}
              value={fmtInt(view.trucks.dependOnTrucks)}
              sub={
                props.nothingToRebalance
                  ? t('play.tile.trucks.nothing')
                  : t('play.tile.trucks.sub')
              }
              guess={guess('trucks')}
              t={t}
            />
          </div>

          <PeriodBlock periods={view.periods} split={view.quality === 'exact'} lang={lang} t={t} />
          <LossStrip losses={view.losses} lang={lang} t={t} />
          <MethodNote t={t} />
        </>
      )}
    </>
  );
}
