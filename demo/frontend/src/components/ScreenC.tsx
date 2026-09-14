import type { GameData, Lang, Weekday } from '../lib/types';
import type { T } from '../lib/i18n';
import { scenCopy, scenName } from '../lib/scen';
import { fmtEur, fmtNum } from '../lib/format';
import type { SheetKind } from './Sheet';

/**
 * Step C — choose a strategy (ux-plan section 3, amended by v2 section 3). Three cards side by
 * side; there is no separate build button any more: the card's primary button IS "Build this
 * network →", so selecting a plan builds it and moves to D. The full story and the model
 * parameters live in the scenario modal behind the "▸" link.
 */
export default function ScreenC({
  data,
  t,
  lang,
  weekday,
  selected,
  onBuild,
  onSheet,
}: {
  data: GameData;
  t: T;
  lang: Lang;
  weekday: Weekday;
  selected: string | null;
  onBuild: (id: string) => void;
  onSheet: (s: SheetKind) => void;
}) {
  return (
    <>
      <p className="eyebrow">{t('c.eyebrow')}</p>
      <h2>{t('c.title')}</h2>
      {/* the bridge quotes what the player actually watched on B (ux-plan section 5.2) */}
      <p
        className="lede"
        style={{ marginTop: 5 }}
        dangerouslySetInnerHTML={{
          __html: `${t(weekday === 'mon' ? 'c.bridge.mon' : 'c.bridge.sun')} ${t('c.bridge.tail')}`,
        }}
      />

      <div className={`scards${selected ? ' dimmed' : ''}`}>
        {data.scenarios.map((sc) => {
          const isSel = selected === sc.id;
          return (
            <article className={`card scard${isSel ? ' sel' : ''}`} key={sc.id}>
              <div className="shead">
                <h3>{scenName(sc, t)}</h3>
                <span className="mono sid">{sc.short}</span>
              </div>
              <div className="price">
                {fmtEur(sc.params.budget)} <small>{t('c.capex')}</small>
              </div>
              <div className="badges">
                <span className="badge">
                  {fmtNum(lang, sc.params.opsRatio * 100, 2)} % {t('c.ops')}
                </span>
                <span className={`badge${sc.highlight ? ' hl' : ''}`}>{scenCopy(sc, t, 'tag', sc.id)}</span>
              </div>
              <p className="pitch">{scenCopy(sc, t, 'pitch', sc.fallback.pitch)}</p>
              <button className="det" onClick={() => onSheet({ kind: 'scen', id: sc.id })}>
                ▸ {t('c.details')}
              </button>
              {/* picking a plan builds it immediately — no extra confirmation step (v2 section 3) */}
              <button className="pick" onClick={() => onBuild(sc.id)}>
                {isSel ? t('c.selected') : t('c.cta')}
              </button>
            </article>
          );
        })}
      </div>

      <p className="note" dangerouslySetInnerHTML={{ __html: t('c.note') }} />
    </>
  );
}
