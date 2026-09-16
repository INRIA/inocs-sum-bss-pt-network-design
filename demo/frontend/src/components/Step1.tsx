import type { T } from '../lib/i18n';
import { referenceOf } from '../lib/families';
import { fmtInt } from '../lib/format';
import type { GameData } from '../lib/types';

export const QUESTIONS = [1, 2, 3, 4] as const;

/**
 * Step 1 — the four questions the research answers (plan.md section 3). Copy lives in the
 * dictionary; the three data facts are read from the runs, never typed in.
 */
export default function Step1({ data, t, onNext }: { data: GameData; t: T; onNext: () => void }) {
  const ref = referenceOf(data.scenarios);
  const facts: [string, string][] = [
    [ref?.paper ? fmtInt(ref.paper.demandTotal) : '—', t('s1.f1')],
    [ref?.technical.n_candidates != null ? fmtInt(Number(ref.technical.n_candidates)) : '—', t('s1.f2')],
    [String(ref?.periods || data.city.periodBounds.length || '—'), t('s1.f3')],
  ];

  return (
    <>
      <p className="eyebrow">{t('s1.eyebrow')}</p>
      <h1>{t('s1.title')}</h1>
      <p className="lede" dangerouslySetInnerHTML={{ __html: t('s1.lede') }} />

      <div className="qgrid">
        {QUESTIONS.map((n) => (
          <div className="q" key={n}>
            <span className="no">{t('s1.qno', { n })}</span>
            <h3>{t(`q${n}.h`)}</h3>
            <p>{t(`q${n}.p`)}</p>
            <span className="ans">{t('s1.answered')}</span>
          </div>
        ))}
      </div>

      <div className="facts">
        {facts.map(([v, label]) => (
          <div className="fact" key={label}>
            <b className="mono">{v}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <p className="note" dangerouslySetInnerHTML={{ __html: t('s1.paper') }} />

      <button className="cta" onClick={onNext}>
        {t('s1.cta')}
      </button>
    </>
  );
}
