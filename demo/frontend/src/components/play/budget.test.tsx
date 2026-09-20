/**
 * The budget cards must make BOTH kinds of money visible before the choice is
 * made, and carry one `+` and one `−` trade-off tag each (plan.md §2,
 * UX reference §5 "awareness"). Nothing here depends on a scenario file: the
 * screen falls back to its own copy when a run is missing.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import Budget from './screens/Budget';
import { BUDGET_IDS, BUDGET_SCENARIO } from '../../domain/game/session';
import { makeT } from '../../lib/i18n';
import { fmtEur } from '../../lib/format';
import type { GameBudget } from '../../domain/evaluation/types';
import type { GameData } from '../../lib/types';

const t = makeT('en');

const budgets: GameBudget[] = BUDGET_IDS.map((id, index) => ({
  scenario: BUDGET_SCENARIO[id],
  capexEur: [20000, 60000, 80000, 120000][index]!,
  opsBudgetEur: [1000, 3000, 4000, 6000][index]!,
  epsilon: 0.04,
  maxStations: 100,
}));

const data = { scenarios: [] } as unknown as GameData;

const render = (selected: '080k' | null = null, hasLayout = false): string =>
  renderToStaticMarkup(
    <Budget
      data={data}
      budgets={budgets}
      selected={selected}
      hasLayout={hasLayout}
      onChoose={() => {}}
      t={t}
    />,
  );

const count = (html: string, needle: string): number => html.split(needle).length - 1;

describe('Budget', () => {
  it('offers exactly the four plan cards', () => {
    const html = render();
    expect(count(html, 'class="card scard')).toBe(4);
    for (const id of BUDGET_IDS) expect(html).toContain(t(`play.budget.name.${id}`));
  });

  it('shows both kinds of money on every card', () => {
    const html = render();
    for (const budget of budgets) {
      expect(html).toContain(fmtEur(budget.capexEur));
      expect(html).toContain(fmtEur(budget.opsBudgetEur));
    }
    expect(count(html, t('play.budget.once'))).toBe(4);
    expect(count(html, t('play.budget.perday'))).toBe(4);
  });

  it('carries one plus and one minus trade-off tag per card', () => {
    const html = render();
    expect(count(html, 'badge playplus')).toBe(4);
    expect(count(html, 'badge playminus')).toBe(4);
    for (const id of BUDGET_IDS) {
      expect(html).toContain(t(`play.budget.plus.${id}`));
      expect(html).toContain(t(`play.budget.minus.${id}`));
    }
  });

  it('marks the chosen card, and warns only once a layout would be lost', () => {
    const chosen = render('080k');
    expect(chosen).toContain('card scard sel');
    expect(chosen).toContain(t('play.budget.picked'));
    expect(chosen).not.toContain(t('play.budget.warn'));
    expect(render('080k', true)).toContain(t('play.budget.warn'));
  });
});
