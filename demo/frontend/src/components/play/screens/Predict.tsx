import type { PredictionId, PredictionQuestion } from '../../../domain/game/predictions';
import type { T } from '../../../lib/i18n';

/**
 * Step 3 — the polls, all on screen: one card per question, two columns by
 * two rows on a desktop, one after another on a phone.
 *
 * Every poll is optional. Pressing the chosen option again takes the answer
 * back, and the primary action never waits for them. Answers stay editable
 * until the run. The screen promises nothing — "no right answer yet" — because
 * the reveal comes after the difficulty was felt (UX reference §5).
 *
 * The evaluation starts in the background the moment this step is entered
 * (`useEvaluation`, plan-technical §C.5). This screen says nothing about it:
 * the shell shows one discreet line near the primary action if the solve is
 * still running.
 */
export default function Predict({
  questions,
  answers,
  onAnswer,
  onClear,
  t,
}: {
  questions: readonly PredictionQuestion[];
  answers: Readonly<Partial<Record<PredictionId, string>>>;
  onAnswer: (id: PredictionId, option: string) => void;
  onClear: (id: PredictionId) => void;
  t: T;
}) {
  return (
    <>
      <p className="eyebrow">{t('play.predict.eyebrow')}</p>
      <p className="note playnoright">{t('play.predict.optional')}</p>

      <div className="playpolls">
        {questions.map((question, i) => {
          const chosen = answers[question.id];
          return (
            <section key={question.id} className="playpoll" aria-label={t(question.questionKey)}>
              <p className="playdotlab">{t('play.predict.progress', { n: i + 1, total: questions.length })}</p>
              <h2 className="playq">{t(question.questionKey)}</h2>
              <div className="playoptions">
                {question.options.map((option) => (
                  <button
                    key={option.id}
                    className="playoption"
                    aria-pressed={chosen === option.id}
                    onClick={() =>
                      chosen === option.id ? onClear(question.id) : onAnswer(question.id, option.id)
                    }
                  >
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <p className="note playnoright">{t('play.predict.noright')}</p>
    </>
  );
}
