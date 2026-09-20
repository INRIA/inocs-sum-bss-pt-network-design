import type { ReactNode } from 'react';

import type { PredictionQuestion, Resolution } from '../../domain/game/predictions';
import type { Ticket as TicketModel } from '../../domain/game/ticket';
import { fmtEur, fmtInt, fmtPct } from '../../lib/format';
import type { T } from '../../lib/i18n';
import type { Lang } from '../../lib/types';
import type { Reveal } from './reveal';
import { MarksLine } from './screens/ResultBits';

/**
 * The ticket — the reward loop of UX reference §8.
 *
 * Step 3 stamps the answers as they are given (`Ticket`, the default export),
 * and step 6 replays the whole thing (`FullTicket` + `PredictionRow`): what
 * the visitor said, then what the model found, in the SAME order the questions
 * were asked.
 *
 * There is no score anywhere in here. `Resolution.matched` picks a tone key
 * and nothing else: no count of right answers, no ranking, no "correct" or
 * "wrong" — the game has no win or lose (plan.md §2).
 */
export default function Ticket({
  questions,
  answers,
  t,
}: {
  questions: readonly PredictionQuestion[];
  answers: Readonly<Record<string, string | undefined>>;
  t: T;
}) {
  const stamped = questions.filter((question) => answers[question.id]);
  return (
    <section className="playticket" aria-label={t('play.ticket.aria')}>
      <p className="decklab">{t('play.ticket.title')}</p>
      {stamped.length === 0 ? (
        <p className="note">{t('play.ticket.empty')}</p>
      ) : (
        <ul className="playstamps">
          {stamped.map((question) => (
            <li key={question.id}>
              <span className="playstampq">{t(`play.short.${question.id}`)}</span>
              <span className="playstampa">{t(`${question.questionKey}.${answers[question.id]}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The head of the replayed ticket: the budget, who placed what, the three marks. */
export function FullTicket({
  ticket,
  lang,
  t,
}: {
  ticket: TicketModel;
  lang: Lang;
  t: T;
}) {
  const stations = ticket.stations;
  return (
    <section className="playticket playfullticket" aria-label={t('play.ticket.aria')}>
      <p className="decklab">{t('play.ticket.title')}</p>
      <ul className="playstamps">
        <li>
          <span className="playstampq">{t('play.ticket.budget')}</span>
          <span className="playstampa">{fmtEur(ticket.budgetEur)}</span>
        </li>
        <li>
          <span className="playstampq">{t('play.ticket.stations')}</span>
          <span className="playstampa">
            {t('play.ticket.stations.value', {
              total: fmtInt(stations.total),
              me: fmtInt(stations.byMe),
              assistant: fmtInt(stations.byAssistant),
            })}
          </span>
        </li>
        {stations.atPtStops != null && (
          <li>
            <span className="playstampq">{t('leg.atpt')}</span>
            <span className="playstampa">{fmtInt(stations.atPtStops)}</span>
          </li>
        )}
      </ul>
      <p className="note">{t('play.marks.note')}</p>
      <p className="note">{t('play.marks.trucks')}</p>
      <MarksLine marks={ticket.marks} lang={lang} t={t} />
    </section>
  );
}

/**
 * One replayed prediction: the question, "you said …", "the model says …".
 *
 * `children` is where the caller hangs the proof accordion, so this component
 * stays about the sentence and the proof stays about the full demo's charts.
 */
export function PredictionRow({
  resolution,
  reveal,
  t,
  children,
}: {
  resolution: Resolution;
  reveal: Reveal;
  t: T;
  children?: ReactNode;
}) {
  const chosen = resolution.chosen;
  return (
    <article className={`playrecap tone-${resolution.matched ? 'close' : 'other'}`}>
      <h3>{t(`play.q.${resolution.predictionId}`)}</h3>
      <p className="playsaid">
        <b>{t('play.ticket.yousaid')}</b>{' '}
        {chosen ? t(`play.q.${resolution.predictionId}.${chosen}`) : t('play.ticket.unanswered')}
      </p>
      <p className="playmodel">
        <b>{t('play.ticket.modelsays')}</b> {t(reveal.key, reveal.vars)}
      </p>
      <p className="note playtone">{t(reveal.toneKey)}</p>
      {reveal.noteKey && <p className="note">{t(reveal.noteKey, reveal.vars)}</p>}
      {children}
    </article>
  );
}

/** The share of the day's demand a mark stands for, for the marks' aria label. */
export const markShare = (lang: Lang, ratio: number): string => fmtPct(lang, ratio, 0);
