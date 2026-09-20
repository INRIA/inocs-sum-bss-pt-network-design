import type { PredictionQuestion } from '../../domain/game/predictions';
import type { T } from '../../lib/i18n';

/**
 * The ticket — for now, the stamps only.
 *
 * The reward loop of UX reference §8: what the visitor answered is recorded
 * where they can see it, so step 6 can replay it against the model's evidence.
 * The full ticket (resolutions, the three marks of the served line) arrives
 * with the Conclusions screen; this stub deliberately shows no verdict, since
 * nothing has been run yet.
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
