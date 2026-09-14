import type { GameData } from '../lib/types';
import type { T } from '../lib/i18n';
import { fmtEur, fmtInt } from '../lib/format';

/**
 * Step A — meet the problem (ux-plan section 1, amended by v2 section 3). The panel body only: the
 * map lives permanently in the right column, and its "1.5 km around the Rhône · N zones · N PT
 * stops" caption sits inside the PT legend bar.
 */
export default function ScreenA({ data, t, onNext }: { data: GameData; t: T; onNext: () => void }) {
  // Dilemma 4 quotes the reference plan's budget — bound to the data, never typed in (ux-plan section 1).
  const reference = data.scenarios.find((s) => s.highlight) ?? data.scenarios[0];

  return (
    <>
      <p className="eyebrow">{t('a.eyebrow')}</p>
      <h1>{t('a.title')}</h1>
      <p className="lede">{t('a.lede')}</p>

      <div className="qgrid">
        {[1, 2, 3].map((n) => (
          <div className="card q" key={n}>
            <span className="no">{t(`a.d${n}.no`)}</span>
            <h3>{t(`a.d${n}.h`)}</h3>
            <p>{t(`a.d${n}.p`)}</p>
          </div>
        ))}
        <div className="card q">
          <span className="no">{t('a.d4.no')}</span>
          <h3>{t('a.d4.h', { budget: reference ? fmtEur(reference.params.budget) : '—' })}</h3>
          <p>{t('a.d4.p')}</p>
        </div>
      </div>

      <p className="note">{t('a.note', { trips: fmtInt(data.city.bikeTrips) })}</p>

      <button className="cta" onClick={onNext}>
        {t('a.cta')}
      </button>
    </>
  );
}
