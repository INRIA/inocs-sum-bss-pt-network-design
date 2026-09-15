import type { T } from '../lib/i18n';
import { cardsOf } from '../lib/families';
import { scenName, scenPitch, scenTag } from '../lib/scen';
import { fmtEur, fmtNum } from '../lib/format';
import type { GameData, Lang } from '../lib/types';
import type { SheetKind } from './Sheet';

/**
 * Step 3 — choose a plan. The cards are the scenarios whose `role` is "card", one per card slot
 * (essential / reference / ambitious). The compare-only runs of the other families are never
 * offered here: they exist to answer the four questions in step 5.
 */
export default function Step3({
  data,
  t,
  lang,
  selected,
  onBuild,
  onSheet,
}: {
  data: GameData;
  t: T;
  lang: Lang;
  selected: string | null;
  onBuild: (id: string) => void;
  onSheet: (s: SheetKind) => void;
}) {
  const cards = cardsOf(data.scenarios);
  const compareCount = data.scenarios.filter((s) => s.role === 'compare').length;

  return (
    <>
      <p className="eyebrow">{t('s3.eyebrow')}</p>
      <h2>{t('s3.title')}</h2>
      <p className="lede" dangerouslySetInnerHTML={{ __html: t('s3.lede') }} />

      <div className={`scards${selected ? ' dimmed' : ''}`}>
        {cards.map((sc) => {
          const isSel = selected === sc.id;
          return (
            <article className={`card scard${isSel ? ' sel' : ''}`} key={sc.id}>
              <div className="shead">
                <h3>{scenName(sc, t)}</h3>
                {sc.legacy && <span className="legacychip">{t('s3.legacy')}</span>}
              </div>
              <div className="price">
                {fmtEur(sc.params.budget)} <small>{t('s3.capex')}</small>
              </div>
              <div className="badges">
                <span className="badge">
                  {fmtNum(lang, sc.params.opsRatio * 100, 2)} % {t('s3.ops')}
                </span>
                <span className={`badge${sc.family === 'baseline' ? ' hl' : ''}`}>{scenTag(sc, t)}</span>
              </div>
              <p className="pitch">{scenPitch(sc, t)}</p>
              <button className="det" onClick={() => onSheet({ kind: 'story', id: sc.id })}>
                ▸ {t('s3.details')}
              </button>
              {sc.hasResults ? (
                <button className="pick" onClick={() => onBuild(sc.id)}>
                  {isSel ? t('s3.selected') : t('s3.cta')}
                </button>
              ) : (
                <span className="pickpending">{t('s3.pending')}</span>
              )}
            </article>
          );
        })}
      </div>

      <p className="note">{t('s3.note', { n: compareCount })}</p>
    </>
  );
}
