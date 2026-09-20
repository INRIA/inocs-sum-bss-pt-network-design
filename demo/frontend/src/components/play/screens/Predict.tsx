import { useState } from 'react';
import type { PredictionId, PredictionQuestion } from '../../../domain/game/predictions';
import type { T } from '../../../lib/i18n';
import Ticket from '../Ticket';

/**
 * Step 3 — the five polls, ONE per screen (plan-technical §B.2).
 *
 * Options are full-width 56 px buttons, the dots say "3 of 5", and every
 * answer stays editable until the run: Back walks the polls, and re-opening a
 * question shows the stamped answer pressed. The screen promises nothing —
 * "no right answer yet" — because the reveal comes after the difficulty was
 * felt (UX reference §5).
 *
 * The evaluation starts in the background the moment this step is entered
 * (`useEvaluation`, plan-technical §C.5). This screen says nothing about it:
 * the shell shows one discreet line near the primary action if the solve is
 * still running when the last poll has been answered.
 */
export default function Predict({
  questions,
  answers,
  onAnswer,
  t,
}: {
  questions: readonly PredictionQuestion[];
  answers: Readonly<Partial<Record<PredictionId, string>>>;
  onAnswer: (id: PredictionId, option: string) => void;
  t: T;
}) {
  const [index, setIndex] = useState(0);
  const at = Math.min(index, Math.max(0, questions.length - 1));
  const question = questions[at];
  if (!question) return null;
  const chosen = answers[question.id];

  const choose = (option: string): void => {
    onAnswer(question.id, option);
    if (at < questions.length - 1) setIndex(at + 1);
  };

  return (
    <>
      <p className="eyebrow">{t('play.predict.eyebrow')}</p>
      <div className="playdots" role="group" aria-label={t('play.predict.progress', { n: at + 1, total: questions.length })}>
        {questions.map((entry, i) => (
          <span
            key={entry.id}
            className={`playdot${i === at ? ' cur' : ''}${answers[entry.id] ? ' done' : ''}`}
            aria-hidden="true"
          />
        ))}
        <span className="playdotlab">{t('play.predict.progress', { n: at + 1, total: questions.length })}</span>
      </div>

      <h2 className="playq">{t(question.questionKey)}</h2>

      <div className="playoptions">
        {question.options.map((option) => (
          <button
            key={option.id}
            className="playoption"
            aria-pressed={chosen === option.id}
            onClick={() => choose(option.id)}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>

      <p className="note playnoright">{t('play.predict.noright')}</p>

      <div className="playrow">
        <button className="ghostbtn" onClick={() => setIndex(Math.max(0, at - 1))} disabled={at === 0}>
          ← {t('play.predict.prev')}
        </button>
        <button
          className="ghostbtn"
          onClick={() => setIndex(Math.min(questions.length - 1, at + 1))}
          disabled={at >= questions.length - 1}
        >
          {t('play.predict.skip')} →
        </button>
      </div>

      <Ticket questions={questions} answers={answers} t={t} />
    </>
  );
}
