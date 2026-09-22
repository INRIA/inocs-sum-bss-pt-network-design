import { BUDGET_DOCKS, BUDGET_EUR, BUDGET_IDS, BUDGET_SCENARIO, type BudgetId } from '../../../domain/game/session';
import { cardsOf } from '../../../lib/families';
import { fmtEur, fmtInt } from '../../../lib/format';
import { scenName } from '../../../lib/scen';
import { requestSnap } from '../sheetBus';
import type { T } from '../../../lib/i18n';
import type { GameData } from '../../../lib/types';

/**
 * The first half of step 1 — the four plan cards, reusing the look of the full
 * demo's step 3 (`.scards` / `.scard`). The placement controls sit under it in
 * the same panel (`steps/buildStep.tsx`).
 *
 * A card shows three things and nothing else: the plan's name, its budget and
 * the number of docks it allows. The whole card is the control: tapping it IS
 * the choice, there is no separate button. Changing the choice clears the
 * layout and the predictions, so the cards say so once a layout exists.
 */
export default function Budget({
  data,
  selected,
  hasLayout,
  onChoose,
  t,
}: {
  data: GameData;
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
  const choose = (id: BudgetId) => {
    onChoose(id);
    requestSnap('peek');
  };

  return (
    <>
      <h3 className="playh3">{t('play.budget.title')}</h3>

      <div className={`scards playcards${selected ? ' dimmed' : ''}`}>
        {BUDGET_IDS.map((id) => {
          const sc = scenarioOf(id);
          const isSel = selected === id;
          return (
            <article
              className={`card scard${isSel ? ' sel' : ''}`}
              key={id}
              role="button"
              tabIndex={0}
              aria-pressed={isSel}
              onClick={() => choose(id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  choose(id);
                }
              }}
            >
              <div className="shead">
                <h3>{sc ? scenName(sc, t) : t(`play.budget.name.${id}`)}</h3>
              </div>
              <div className="price">{fmtEur(BUDGET_EUR[id])}</div>
              <p className="playdocks">{t('play.budget.docks', { n: fmtInt(BUDGET_DOCKS[id]) })}</p>
            </article>
          );
        })}
      </div>

      {hasLayout && <p className="note playwarn">{t('play.budget.warn')}</p>}
    </>
  );
}
