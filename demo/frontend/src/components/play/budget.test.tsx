/**
 * The budget cards show three things and nothing else: the plan's name, its
 * budget and the number of docks it allows. The card itself is the control.
 * Nothing here depends on a scenario file: the screen falls back to its own
 * copy when a run is missing.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import Budget from './screens/Budget';
import { BUDGET_DOCKS, BUDGET_EUR, BUDGET_IDS } from '../../domain/game/session';
import { makeT } from '../../lib/i18n';
import { fmtEur } from '../../lib/format';
import type { GameData } from '../../lib/types';
import type { GameBudget, ModelConstants } from '../../domain/evaluation/types';

const t = makeT('en');

const data = { scenarios: [] } as unknown as GameData;

/** The unit costs the export carries; the screen never writes one of its own. */
const constants = {
  station_setup_cost: 100,
  dock_cost: 20,
  unit_bike_cost: 60,
  dispatch_fixed_cost: 40,
  rebalancing_unit_cost: 20,
} as ModelConstants;

const budgets: GameBudget[] = [
  { scenario: 'budget_080k', capexEur: 80000, opsBudgetEur: 4000, epsilon: 0.04, maxStations: 400 },
];

const render = (
  selected: '080k' | null = null,
  hasLayout = false,
  costs: ModelConstants | null = constants,
): string =>
  renderToStaticMarkup(
    <Budget
      data={data}
      selected={selected}
      hasLayout={hasLayout}
      constants={costs}
      budgets={budgets}
      onChoose={() => {}}
      lang="en"
      t={t}
    />,
  );

const count = (html: string, needle: string): number => html.split(needle).length - 1;

describe('Budget', () => {
  it('offers exactly the four plan cards, each one a control', () => {
    const html = render();
    expect(count(html, 'class="card scard')).toBe(4);
    expect(count(html, 'role="button"')).toBe(4);
    // No separate button inside a card: tapping the card is the choice.
    expect(count(html, '<button')).toBe(0);
    for (const id of BUDGET_IDS) expect(html).toContain(t(`play.budget.name.${id}`));
  });

  it('shows the budget and the docks it allows on every card, and nothing more', () => {
    const html = render();
    for (const id of BUDGET_IDS) {
      expect(html).toContain(fmtEur(BUDGET_EUR[id]));
      expect(html).toContain(t('play.budget.docks', { n: BUDGET_DOCKS[id] }));
    }
    expect(BUDGET_IDS.map((id) => BUDGET_DOCKS[id])).toEqual([30, 60, 80, 90]);
    expect(html).not.toContain('badge');
    expect(html).not.toContain('class="pitch"');
    expect(html).not.toContain('playops');
  });

  it('prices what the money buys, from the export and never from a literal', () => {
    const html = render();
    expect(html).toContain(t('play.costs.h'));
    for (const eur of [fmtEur(100), fmtEur(20), fmtEur(60), fmtEur(40)]) {
      expect(html).toContain(eur);
    }
    // 100 + 10 docks x 20 + 8 bikes x 60
    expect(html).toContain(fmtEur(780));
    expect(html).toContain(t('play.costs.ops', { pct: '5 %' }));
    // and nothing at all when the payload did not ship the constants
    expect(render(null, false, null)).not.toContain(t('play.costs.h'));
  });

  it('marks the chosen card, and warns only once a layout would be lost', () => {
    const chosen = render('080k');
    expect(chosen).toContain('card scard sel');
    expect(count(chosen, 'aria-pressed="true"')).toBe(1);
    expect(chosen).not.toContain(t('play.budget.warn'));
    expect(render('080k', true)).toContain(t('play.budget.warn'));
  });
});
