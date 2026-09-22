import type { T } from '../../../lib/i18n';
import AboutModel from './AboutModel';

/**
 * The instructions that open step 1, above the budget cards: what the visitor
 * is about to do, in the order they will do it. Always shown, with the
 * budget cards right under it.
 */
export default function PlanIntro({ t }: { t: T }) {
  return (
    <>
      <div className="playintrohead">
        <p className="eyebrow">{t('play.plan.eyebrow')}</p>
        <AboutModel t={t} />
      </div>
      <h2>{t('play.plan.title')}</h2>
      <p className="lede">{t('play.plan.lede')}</p>
      {/* <ol className="playhow">
        <li>{t('play.plan.how.budget')}</li>
        <li>{t('play.plan.how.place')}</li>
        <li>{t('play.plan.how.meter')}</li>
      </ol> */}
    </>
  );
}
