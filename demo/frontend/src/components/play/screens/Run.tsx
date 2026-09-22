import { DayTransport } from './Build';
import type { BikesFacts, PredictionId } from '../../../domain/game/predictions';
import type { ResultsView } from '../../../domain/game/results';
import type { EvaluationStatus } from '../../../hooks/useEvaluation';
import type { T } from '../../../lib/i18n';
import type { Lang } from '../../../lib/types';
import { MethodNote, ResultsBlock } from './ResultBits';

/**
 * Step 4 — the day the visitor's network runs, then what it did.
 *
 * Observe, in the rhythm of UX reference §3: the map plays the five-second run
 * first (the shell keeps the sheet at `peek` for it), and the results rise
 * afterwards: five KPI cards (each carries the step-3 guess it answers, when
 * there was one), the pie of where the day's trips went, and the service rate
 * by period as plain bars.
 *
 * The visitor's truck figure is never a truck count: the relaxed LP buys
 * fractional runs, so the honest number is "trips that depend on trucks"
 * (plan.md §3).
 */
export interface RunProps {
  status: EvaluationStatus;
  view: ResultsView | null;
  answers: Readonly<Partial<Record<PredictionId, string>>>;
  /** The optimiser's plan at this budget: the "bikes per station" tile and badge. */
  bikes: BikesFacts | null;
  trucks: boolean;
  onReplay: () => void;
  /** Null under reduced motion, where the period is stepped by hand instead. */
  periodName: string | null;
  reduced: boolean;
  period: number;
  onPeriod: (period: number) => void;
  playing: boolean;
  hour: number;
  onSeekHour: (hour: number) => void;
  onTogglePlay: () => void;
  periods: number;
  /** True at 20 k€, where the two truck states are all but identical. */
  nothingToRebalance: boolean;
  onRetry: () => void;
  lang: Lang;
  t: T;
}

export default function Run(props: RunProps) {
  const { status, view, answers, lang, t } = props;
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
        ) : null}
      </div>

      {!props.reduced && props.periodName != null && (
        <DayTransport
          label={t('play.run.dayLabel')}
          playing={props.playing}
          hour={props.hour}
          periodName={props.periodName}
          onTogglePlay={props.onTogglePlay}
          onSeekHour={props.onSeekHour}
          t={t}
        />
      )}

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
          <ResultsBlock
            view={view}
            guess={guess}
            bikes={props.bikes}
            nothingToRebalance={props.nothingToRebalance}
            lang={lang}
            t={t}
          />
          <MethodNote t={t} />
        </>
      )}
    </>
  );
}
