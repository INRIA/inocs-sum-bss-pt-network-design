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
    <Tracker
      session={session}
      onGo={() => {}}
      onBack={null}
      onRestart={() => {}}
      compact={compact}
      t={t}
    />,
  );

const withBudget = reduce(EMPTY_SESSION, { type: 'chooseBudget', budgetId: '080k' });
const building = reduce(reduce(withBudget, { type: 'go', step: 'build' }), {
  type: 'toggleStation',
  id: 7,
});

const count = (html: string, needle: string): number => html.split(needle).length - 1;

describe('Tracker', () => {
  it('shows the five worded steps', () => {
    const html = render(EMPTY_SESSION);
    for (const step of TRACKER) expect(html).toContain(t(step.labelKey));
    expect(count(html, 'class="trackitem')).toBe(5);
  });

  it('marks done, current and upcoming steps', () => {
    const html = render(reduce(building, { type: 'go', step: 'predict' }));
    expect(html).toContain('trackitem done');
    expect(html).toContain('trackitem current');
    expect(html).toContain('trackbike');
  });

  it('parks the bike on the current step\'s marker, whatever the progress inside the step', () => {
    // the rail spans first marker -> last marker, so step i of 5 sits at i/4 of it
    const bikeLeft = (session: Session): number =>
      Number(render(session).match(/trackbike" style="left:(\d+)%/)![1]);
    const fillWidth = (session: Session): number =>
      Number(render(session).match(/trackrailfill" style="width:(\d+)%/)![1]);

    expect(bikeLeft(EMPTY_SESSION)).toBe(0);
    // placing stations moves the fill ahead, never the bike off its step
    expect(bikeLeft(building)).toBe(0);
    expect(fillWidth(building)).toBeGreaterThan(0);
    expect(fillWidth(building)).toBeLessThan(25);

    const predicting = reduce(building, { type: 'go', step: 'predict' });
    expect(bikeLeft(predicting)).toBe(25);
    expect(fillWidth(predicting)).toBeGreaterThanOrEqual(25);

    TRACKER.forEach((step, index) => {
      expect(bikeLeft({ ...building, step: step.id })).toBe(Math.round((index / 4) * 100));
    });
    // the last step is the end of the rail: the fill cannot overshoot it
    expect(fillWidth({ ...building, step: 'conclusions' })).toBe(100);
  });

  it('makes enterable steps buttons and locked ones non-interactive, with the guard reason', () => {
    const html = render(EMPTY_SESSION);
    // only Plan is enterable from an empty session
    expect(count(html, '<button')).toBe(1);
    expect(count(html, 'trackitem upcoming locked')).toBe(4);
    expect(html).toContain(t('play.guard.budget'));
    expect(html).toContain('aria-description');
  });

  it('unlocks a step as soon as the decision behind it is taken', () => {
    const html = render(withBudget);
    // a budget alone opens nothing new: a station is still missing
    expect(html).toContain(t('play.guard.station'));
  });

  it('collapses to "n of 5 · label" over a thin bar on a phone, with the route hidden', () => {
    const html = render(building, true);
    expect(html).toContain('tracker compact');
    expect(html).toContain(
      t('play.tracker.position', { n: 1, total: 5, label: t('play.step.build') }),
    );
    expect(html).toContain('trackbar');
    expect(html).toContain('aria-expanded="false"');
    // the full route is a list, and it only opens on a tap
    expect(html).not.toContain('trackroute');
  });

  it('offers Back as its only off-ramp: the full demo lives in the header', () => {
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
        onRestart={() => {}}
        compact={false}
        t={t}
      />,
    );
    expect(html).toContain(t('play.nav.back'));
    // the duplicate exit is gone: no second "Full demo" under the header's own
    expect(html).not.toContain(t('play.nav.demo'));
    expect(html).not.toContain('<a ');
  });

  it('offers Start over, before Back, once a decision has been taken', () => {
    // nothing to undo yet: no Start over on an empty session
    expect(render(EMPTY_SESSION)).not.toContain(t('play.nav.restart'));
    // a budget is a decision, even on the first step where there is no Back
    const first = render(withBudget);
    expect(first).toContain(t('play.nav.restart'));
    expect(first).not.toContain(t('play.nav.back'));
    // both, in that order, on a later step (desktop and phone)
    for (const compact of [false, true]) {
      const html = renderToStaticMarkup(
        <Tracker
          session={reduce(building, { type: 'go', step: 'predict' })}
          onGo={() => {}}
          onBack={() => {}}
          onRestart={() => {}}
          compact={compact}
          t={t}
        />,
      );
      expect(html.indexOf(t('play.nav.restart'))).toBeGreaterThan(0);
      expect(html.indexOf(t('play.nav.restart'))).toBeLessThan(html.indexOf(t('play.nav.back')));
    }
  });
});
