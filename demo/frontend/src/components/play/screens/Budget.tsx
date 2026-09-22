import type { GameBudget, ModelConstants } from '../../../domain/evaluation/types';
import { BUDGET_DOCKS, BUDGET_EUR, BUDGET_IDS, BUDGET_SCENARIO, type BudgetId } from '../../../domain/game/session';
import { cardsOf } from '../../../lib/families';
import { fmtEur, fmtInt, fmtPct } from '../../../lib/format';
import { scenName } from '../../../lib/scen';
import { requestSnap } from '../sheetBus';
import type { T } from '../../../lib/i18n';
import type { GameData, Lang } from '../../../lib/types';

/**
 * The first half of step 1 — the four plan cards, reusing the look of the full
 * demo's step 3 (`.scards` / `.scard`). The placement controls sit under it in
 * the same panel (`steps/buildStep.tsx`).
 *
 * A card shows three things and nothing else: the plan's name, its budget and
 * the number of docks it allows. The whole card is the control: tapping it IS
 * the choice, there is no separate button. Changing the choice clears the
 * layout and the predictions, so the cards say so once a layout exists.
 *
 * Under the cards, what the money actually buys: the model's own unit costs,
 * read from `constants.json` at build time (`network-design-bss/src/util/cost.py`
 * -> the export -> here, AGENTS.md rule 2 — never a literal), and the share the
 * scenarios put aside for running the service. It is a price list, not a KPI:
 * it is here to make "80 000 €" mean something before a single station is placed.
 */

/** The example the note prices: a mid-sized station with a day's stock behind it. */
export const EXAMPLE_DOCKS = 10;
export const EXAMPLE_BIKES = 8;

/** What one station of `docks` docks and `bikes` bikes costs the capital budget. */
export function stationCost(
  constants: ModelConstants,
  docks = EXAMPLE_DOCKS,
  bikes = EXAMPLE_BIKES,
): number {
  return (
    constants.station_setup_cost + docks * constants.dock_cost + bikes * constants.unit_bike_cost
  );
}

/** The operating share the shipped scenarios use (`op_budget_ratio`), or null. */
export function opsRatio(budgets: readonly GameBudget[]): number | null {
  const first = budgets.find((budget) => budget.capexEur > 0);
  return first ? first.opsBudgetEur / first.capexEur : null;
}

export default function Budget({
  data,
  selected,
  hasLayout,
  constants,
  budgets,
  onChoose,
  lang,
  t,
}: {
  data: GameData;
  selected: BudgetId | null;
  hasLayout: boolean;
  /** The model's unit costs, or null when the game payload is missing. */
  constants: ModelConstants | null;
  budgets: readonly GameBudget[];
  onChoose: (id: BudgetId) => void;
  lang: Lang;
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

      {constants && (
        <section className="playcosts" aria-label={t('play.costs.h')}>
          <p className="decklab">{t('play.costs.h')}</p>
          <ul>
            <li>
              <span>{t('play.costs.station')}</span>
              <b className="mono">{fmtEur(constants.station_setup_cost)}</b>
            </li>
            <li>
              <span>{t('play.costs.dock')}</span>
              <b className="mono">{fmtEur(constants.dock_cost)}</b>
            </li>
            <li>
              <span>{t('play.costs.bike')}</span>
              <b className="mono">{fmtEur(constants.unit_bike_cost)}</b>
            </li>
            <li>
              <span>
                {t('play.costs.truck', { perkm: fmtEur(constants.rebalancing_unit_cost) })}
              </span>
              <b className="mono">{fmtEur(constants.dispatch_fixed_cost)}</b>
            </li>
          </ul>
          <p className="note">
            {t('play.costs.example', {
              docks: fmtInt(EXAMPLE_DOCKS),
              bikes: fmtInt(EXAMPLE_BIKES),
              eur: fmtEur(stationCost(constants)),
            })}
          </p>
          {opsRatio(budgets) != null && (
            <p className="note">
              {t('play.costs.ops', { pct: fmtPct(lang, opsRatio(budgets)!, 0) })}
            </p>
          )}
        </section>
      )}

      {hasLayout && <p className="note playwarn">{t('play.budget.warn')}</p>}
    </>
  );
}
