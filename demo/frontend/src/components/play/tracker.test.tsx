/**
 * The tracker is the game's navigation (UX reference §2), so what it renders
 * is a contract: which steps are reachable, which are visibly locked, and the
 * compact form a phone gets. Assertions stay short — never a markup dump.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import Tracker from './Tracker';
import { EMPTY_SESSION, reduce, type Session } from '../../domain/game/session';
import { TRACKER } from '../../domain/game/steps';
import { makeT } from '../../lib/i18n';
import { fakeEvaluation } from '../../domain/game/testSupport';

const t = makeT('en');

const render = (session: Session, compact = false): string =>
  renderToStaticMarkup(
    <Tracker session={session} onGo={() => {}} onBack={null} demoUrl="/base/" compact={compact} t={t} />,
  );

const withBudget = reduce(EMPTY_SESSION, { type: 'chooseBudget', budgetId: '080k' });
const building = reduce(reduce(withBudget, { type: 'go', step: 'build' }), {
  type: 'toggleStation',
  id: 7,
});

const count = (html: string, needle: string): number => html.split(needle).length - 1;

describe('Tracker', () => {
  it('shows the six worded steps, and the entry step is not one of them', () => {
    const html = render(EMPTY_SESSION);
    for (const step of TRACKER) expect(html).toContain(t(step.labelKey));
    expect(html).not.toContain(t('play.step.entry'));
    expect(count(html, 'class="trackitem')).toBe(6);
  });

  it('marks done, current and upcoming steps, and moves the bike with the progress', () => {
    const html = render(building);
    expect(html).toContain('trackitem done');
    expect(html).toContain('trackitem current');
    expect(html).toContain('trackbike');
    // build is step 2 of 6, so the bike has left the start and is not at the end
    const match = html.match(/trackbike" style="left:(\d+)%/);
    expect(match).not.toBeNull();
    const left = Number(match![1]);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(100);
  });

  it('makes enterable steps buttons and locked ones non-interactive, with the guard reason', () => {
    const html = render(EMPTY_SESSION);
    // only Budget is enterable from an empty session
    expect(count(html, '<button')).toBe(1);
    expect(count(html, 'trackitem upcoming locked')).toBe(5);
    expect(html).toContain(t('play.guard.budget'));
    expect(html).toContain('aria-description');
  });

  it('unlocks a step as soon as the decision behind it is taken', () => {
    const html = render(withBudget);
    // budget and build are now both enterable
    expect(count(html, '<button')).toBe(2);
    expect(html).toContain(t('play.guard.station'));
  });

  it('collapses to "n of 6 · label" over a thin bar on a phone, with the route hidden', () => {
    const html = render(building, true);
    expect(html).toContain('tracker compact');
    expect(html).toContain(
      t('play.tracker.position', { n: 2, total: 6, label: t('play.step.build') }),
    );
    expect(html).toContain('trackbar');
    expect(html).toContain('aria-expanded="false"');
    // the full route is a list, and it only opens on a tap
    expect(html).not.toContain('trackroute');
  });

  it('always offers the off-ramps', () => {
    const html = renderToStaticMarkup(
      <Tracker
        session={reduce(building, {
          type: 'setEvaluation',
          hash: 'x',
          withTrucks: fakeEvaluation(),
          withoutTrucks: fakeEvaluation(),
        })}
        onGo={() => {}}
        onBack={() => {}}
        demoUrl="/base/"
        compact={false}
        t={t}
      />,
    );
    expect(html).toContain(t('play.nav.back'));
    expect(html).toContain(t('play.nav.demo'));
    expect(html).toContain('href="/base/"');
  });
});
