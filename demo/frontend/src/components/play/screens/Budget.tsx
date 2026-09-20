import { BUDGET_EUR, BUDGET_IDS, BUDGET_SCENARIO, type BudgetId } from '../../../domain/game/session';
import { cardsOf } from '../../../lib/families';
import { fmtEur } from '../../../lib/format';
import { scenName, scenPitch } from '../../../lib/scen';
import type { T } from '../../../lib/i18n';
import type { GameData } from '../../../lib/types';
import type { GameBudget } from '../../../domain/evaluation/types';

/**
 * Step 1 — the four plan cards (plan.md §2), reusing the look of the full
 * demo's step 3 (`.scards` / `.scard`).
 *
 * Two things this screen must make visible before the choice is made
 * (awareness, UX reference §5): BOTH kinds of money — the capex once and the
 * operating budget a day, read from `constants.json`'s own budget envelopes,
 * never restated here — and two trade-off tags, one `+` and one `−`.
 *
 * Choosing a card IS the decision; the primary action only moves on. Changing
 * it later clears the layout and the predictions, so the card says so.
 */
export default function Budget({
  data,
  budgets,
  selected,
  hasLayout,
  onChoose,
  t,
}: {
  data: GameData;
  budgets: readonly GameBudget[];
  selected: BudgetId | null;
  hasLayout: boolean;
  onChoose: (id: BudgetId) => void;
  t: T;
}) {
  const cards = cardsOf(data.scenarios);
  const scenarioOf = (id: BudgetId) => {
    const wanted = BUDGET_SCENARIO[id];
    return cards.find((s) => s.id === wanted) ?? data.scenarios.find((s) => s.id === wanted) ?? null;
  };
  const opsOf = (id: BudgetId) =>
    budgets.find((b) => b.scenario === BUDGET_SCENARIO[id])?.opsBudgetEur ?? 0;

  return (
    <>
      <p className="eyebrow">{t('play.budget.eyebrow')}</p>
      <h2>{t('play.budget.title')}</h2>
      <p className="lede">{t('play.budget.lede')}</p>

      <div className={`scards playcards${selected ? ' dimmed' : ''}`}>
        {BUDGET_IDS.map((id) => {
          const sc = scenarioOf(id);
          const isSel = selected === id;
          return (
            <article className={`card scard${isSel ? ' sel' : ''}`} key={id}>
              <div className="shead">
                <h3>{sc ? scenName(sc, t) : t(`play.budget.name.${id}`)}</h3>
              </div>
              <div className="price">
                {fmtEur(BUDGET_EUR[id])} <small>{t('play.budget.once')}</small>
              </div>
              <div className="playops">
                {fmtEur(opsOf(id))} <small>{t('play.budget.perday')}</small>
              </div>
              <div className="badges">
                <span className="badge playplus">+ {t(`play.budget.plus.${id}`)}</span>
                <span className="badge playminus">− {t(`play.budget.minus.${id}`)}</span>
              </div>
              <p className="pitch">{sc ? scenPitch(sc, t) : t(`play.budget.pitch.${id}`)}</p>
              <button className="pick" onClick={() => onChoose(id)} aria-pressed={isSel}>
                {isSel ? t('play.budget.picked') : t('play.budget.pick')}
              </button>
            </article>
          );
        })}
      </div>

      {hasLayout && <p className="note playwarn">{t('play.budget.warn')}</p>}
      <p className="note">{t('play.budget.note')}</p>
    </>
  );
}
