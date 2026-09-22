import { useState } from 'react';

import { findQuestion, type PredictionId } from '../../../domain/game/predictions';
import type { PeriodRow } from '../../../domain/game/results';
import type { Ticket as TicketModel } from '../../../domain/game/ticket';
import Proof from '../../Proofs';
import { answers as questionAnswers } from '../../../lib/questions';
import { fmtPct } from '../../../lib/format';
import type { T } from '../../../lib/i18n';
import type { GameData, Lang } from '../../../lib/types';
import { revealOf } from '../reveal';
import { FullTicket, PredictionRow } from '../Ticket';

/**
 * Step 6 — reflect.
 *
 * The ticket is replayed: every prediction next to the model's own evidence,
 * and under each one the proof the full demo already draws for that question
 * (`Proofs.tsx` + `lib/questions.ts`), so the game never argues a point the
 * site cannot show. The rhythm question keeps its caveat, and the rush
 * question — which has no card in the full demo — gets its own small proof.
 *
 * The ONE primary action — "Explore the full demo", deep-linked to the plan
 * that was played — is the shell's own primary bar, so this screen carries
 * only the secondary "play again", the collapsed "go deeper" layer (UX
 * reference §8: the closure layer never sits on the main path) and the closing
 * frame sentence, which sits last, directly above that action.
 */
export interface ConclusionsProps {
  ticket: TicketModel;
  data: GameData;
  /** The visitor's own per-period rows, for the rush proof. */
  periods: readonly PeriodRow[];
  /** The optimiser's, when the run's paper KPIs are on the page. */
  optimiserPeriods: readonly PeriodRow[] | null;
  /** The morning served rate of the sharp-peak run, the rush proof's third figure. */
  sharpMorning: number | null;
  onRestart: () => void;
  lang: Lang;
  t: T;
}

export default function Conclusions(props: ConclusionsProps) {
  const { ticket, data, lang, t } = props;
  const [open, setOpen] = useState<PredictionId[]>([]);
  const [deeper, setDeeper] = useState(false);
  const qa = questionAnswers(data, t, lang);
  const toggle = (id: PredictionId): void =>
    setOpen((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const answered = ticket.predictions.filter((resolution) => resolution.chosen != null);

  return (
    <>
      <p className="eyebrow">{t('play.conclusions.eyebrow')}</p>
      <h2>{t('play.conclusions.title')}</h2>
      <p className="lede">{t('play.conclusions.lede')}</p>

      <FullTicket ticket={ticket} lang={lang} t={t} />

      {answered.map((resolution) => {
        const question = findQuestion(resolution.predictionId);
        const card = question?.card ?? 'new';
        const n = card === 'new' ? null : Number(card.slice(1));
        const isOpen = open.includes(resolution.predictionId);
        return (
          <PredictionRow
            key={resolution.predictionId}
            resolution={resolution}
            reveal={revealOf(resolution, lang)}
            t={t}
          >
            <button
              className="proof"
              aria-expanded={isOpen}
              onClick={() => toggle(resolution.predictionId)}
            >
              {isOpen ? t('s5.hide') : t('s5.show')}
            </button>
            {isOpen && (
              <div className="qblock proofblock">
                {n != null ? (
                  <>
                    <div className="paper">{t('s5.paperref', { ref: t(`q${n}.paper`) })}</div>
                    <Proof n={n} data={data} t={t} lang={lang} />
                    <div className="answer">
                      {qa.find((entry) => entry.n === n)?.conclusion ?? t('s5.q.nodata')}
                    </div>
                  </>
                ) : (
                  <RushProof {...props} />
                )}
              </div>
            )}
          </PredictionRow>
        );
      })}

      <button className="ghostbtn playagain" onClick={props.onRestart}>
        {t('play.conclusions.again')}
      </button>

      <div className="playdeeper">
        <button className="ghostbtn small" aria-expanded={deeper} onClick={() => setDeeper(!deeper)}>
          {t('play.deeper.open')}
        </button>
        {deeper && (
          <div className="playdeeperbody">
            <p className="note">{t('play.method.engine')}</p>
            <p className="note">{t('play.method.tolerance')}</p>
            <p className="note">{t('play.method.upper')}</p>
            <p className="note">{t('play.deeper.cap')}</p>
            <p className="note">{t('play.deeper.weekend')}</p>
          </div>
        )}
      </div>

      {/* The frame closes right above the one action that carries it on: the
          shell's primary bar, which opens the full demo at this plan. */}
      <p className="playclosing">{t('play.conclusions.closing')}</p>
    </>
  );
}

/**
 * The rush question has no card in the full demo, so it gets its own proof:
 * the visitor's served rate per period, the optimiser's beside it, and the
 * morning of the sharp-peak run — the one scenario where the peak really bites
 * (72.7 % of a sharp morning, plan.md §4).
 */
function RushProof({
  periods,
  optimiserPeriods,
  sharpMorning,
  lang,
  t,
}: Pick<ConclusionsProps, 'periods' | 'optimiserPeriods' | 'sharpMorning' | 'lang' | 't'>) {
  const rate = (row: PeriodRow): string =>
    fmtPct(lang, row.demand > 0 ? row.served / row.demand : 0, 0);
  return (
    <div className="playrushproof">
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>{t('play.rushproof.period')}</th>
              <th className="n">{t('play.compare.you')}</th>
              <th className="n">{t('play.compare.optimiser')}</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((row) => (
              <tr key={row.period}>
                <td>{t(`s5.per.${row.period}`)}</td>
                <td className="n">{rate(row)}</td>
                <td className="n">
                  {optimiserPeriods?.[row.period] ? rate(optimiserPeriods[row.period]!) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        {sharpMorning == null
          ? t('s5.q.nodata')
          : t('play.rushproof.sharp', { pct: fmtPct(lang, sharpMorning, 1) })}
      </p>
    </div>
  );
}
