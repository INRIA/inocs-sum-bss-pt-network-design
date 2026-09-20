import { fmtInt, fmtPct } from '../../../lib/format';
import type { T } from '../../../lib/i18n';
import type { Lang } from '../../../lib/types';
import type { EvaluationStatus } from '../../../hooks/useEvaluation';
import type { EvaluationSummary } from '../../../domain/game/session';
import type { BudgetReference } from '../../../domain/evaluation/types';

/**
 * Run, Optimiser and Conclusions, until their own screens land.
 *
 * A placeholder that LOOKS like a placeholder (UX reference §9: dashed,
 * labelled), so nobody mistakes it for content. It shows the evaluation's
 * status and, once there is one, the hero number — enough to walk the whole
 * loop end to end and to see that the background solve really happened.
 */
export default function Placeholder({
  step,
  status,
  evaluation,
  reference,
  t,
  lang,
}: {
  step: 'run' | 'optimiser' | 'conclusions';
  status: EvaluationStatus;
  evaluation: EvaluationSummary | null;
  /** The optimiser's own row at this budget, by the same engine. */
  reference: BudgetReference | null;
  t: T;
  lang: Lang;
}) {
  return (
    <>
      <p className="eyebrow">{t(`play.${step}.eyebrow`)}</p>
      <h2>{t(`play.${step}.title`)}</h2>
      <p className="lede">{t(`play.${step}.lede`)}</p>

      <div className="playsoon">
        <span className="playsoonlab">{t('play.soon')}</span>
        <p className="note">{t(`play.${step}.soon`)}</p>
      </div>

      <p className="playstatus">
        {t('play.status.label')} <b>{t(`play.status.${status}`)}</b>
      </p>
      {reference && (
        <p className="note">
          {t('play.reference.optimiser', {
            served: fmtInt(reference.optimiserWithTrucks.served),
            stations: fmtInt(reference.nStations),
            docks: fmtInt(reference.optimiserWithTrucks.docks),
            bikes: fmtInt(reference.optimiserWithTrucks.bikes),
          })}
        </p>
      )}
      {evaluation && (
        <div className="facts facts-row">
          <div className="fact">
            <b className="mono">{fmtInt(evaluation.served)}</b>
            <span>{t('play.hero.served', { total: fmtInt(evaluation.demandTotal) })}</span>
          </div>
          <div className="fact">
            <b className="mono">{fmtPct(lang, evaluation.servedRatio, 0)}</b>
            <span>{t('play.hero.share')}</span>
          </div>
          <div className="fact">
            <b className="mono">{fmtInt(evaluation.docks)}</b>
            <span>{t('play.hero.docks', { bikes: fmtInt(evaluation.bikes) })}</span>
          </div>
        </div>
      )}
    </>
  );
}
