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

const t = makeT('en');

const data = { scenarios: [] } as unknown as GameData;

const render = (selected: '080k' | null = null, hasLayout = false): string =>
  renderToStaticMarkup(
    <Budget data={data} selected={selected} hasLayout={hasLayout} onChoose={() => {}} t={t} />,
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

  it('marks the chosen card, and warns only once a layout would be lost', () => {
    const chosen = render('080k');
    expect(chosen).toContain('card scard sel');
    expect(count(chosen, 'aria-pressed="true"')).toBe(1);
    expect(chosen).not.toContain(t('play.budget.warn'));
    expect(render('080k', true)).toContain(t('play.budget.warn'));
  });
});
