import type { T } from '../../../lib/i18n';

/**
 * The entry screen: a role and a stake, in three short lines, then one button
 * (UX reference §1 and §5). No score is promised anywhere — the closing line
 * says there is no right answer, because the game is a trade, not a test.
 */
export default function Entry({ t, budgets }: { t: T; budgets: number }) {
  return (
    <>
      <p className="eyebrow">{t('play.entry.eyebrow')}</p>
      <h2>{t('play.entry.title')}</h2>
      <p className="lede">{t('play.entry.role')}</p>
      <p className="playline">{t('play.entry.stake', { n: budgets })}</p>
      <p className="playline">{t('play.entry.next')}</p>
      <p className="note playnoright">{t('play.entry.noright')}</p>
    </>
  );
}
