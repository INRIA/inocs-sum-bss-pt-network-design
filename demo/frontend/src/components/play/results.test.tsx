/**
 * The three screens of steps 4 to 6, rendered to static markup.
 *
 * They are pure functions of their props (the hooks they use are `useState`
 * only), so `renderToStaticMarkup` exercises them for real without a browser.
 * The assertions are short and about CONTENT — a tile, a guess, a row order —
 * never about markup, and nothing is printed.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { compare, optimiserView, resultsView, type ResultsView } from '../../domain/game/results';
import { marksFor } from '../../domain/game/ticket';
import { fakeEvaluation } from '../../domain/game/testSupport';
import { findQuestion, resolveAll } from '../../domain/game/predictions';
import type { BudgetReference } from '../../domain/evaluation/types';
import { makeT } from '../../lib/i18n';
import en from '../../i18n/en.json';
import Run from './screens/Run';
import Optimiser from './screens/Optimiser';
import { revealOf } from './reveal';

const t = makeT('en');
const dict = en as Record<string, string>;

/** React escapes quotes in static markup; assertions compare the escaped form. */
const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');

const withTrucks = fakeEvaluation({ served: 1000 });
const withoutTrucks = fakeEvaluation({ served: 940 });

const view = (quality: 'exact' | 'estimate' = 'exact'): ResultsView =>
  resultsView({
    evaluation: { ...withTrucks, quality },
    withTrucks,
    withoutTrucks,
    budgetEur: 80000,
  });

const reference: BudgetReference = {
  scenario: 'budget_080k',
  budgetEur: 80000,
  nStations: 83,
  optimiserStations: [1, 2, 3, 4],
  optimiserServed: 1316,
  optimiserServedNoTrucks: 1271,
  optimiserPtShare: 0.4,
  optimiserPtShareNoTrucks: 0.39,
  publishedServedTotal: 1308,
  randomServedMedian: 870,
  demandRuleStations: [1, 2],
  demandRuleServed: 1317,
  reachCalibration: 0.94,
  opsBudgetEur: 4000,
  epsilon: 0.04,
  publishedServedRatio: 0.9,
  randomServedRatioMedian: 0.6,
  randomServedMin: 662,
  randomServedMax: 1017,
  randomLayouts: 30,
  demandRuleServedRatio: 0.9,
  demandRulePtShare: 0.4,
  reachCalibrationReach: 1392,
  reachCalibrationServed: 1316,
  optimiserWithTrucks: {} as never,
  optimiserWithoutTrucks: {} as never,
};

const runMarkup = (quality: 'exact' | 'estimate' = 'exact'): string => {
  const results = view(quality);
  return renderToStaticMarkup(
    <Run
      status={quality === 'estimate' ? 'estimate' : 'ready'}
      view={results}
      marks={marksFor(reference, results.hero.served, results.hero.demand, true)}
      answers={{ pt: '4in10', rush: 'bit', trucks: 'few' }}
      trucks
      onTrucks={() => {}}
      onReplay={() => {}}
      periodName="morning"
      reduced={false}
      period={0}
      onPeriod={() => {}}
      periods={3}
      nothingToRebalance={false}
      onRetry={() => {}}
      lang="en"
      t={t}
    />,
  );
};

describe('the results screen', () => {
  it('shows the hero, the three marks, the three tiles, the losses and the trucks switch', () => {
    const html = runMarkup();
    expect(html).toContain(t('play.hero.line', { served: '1 000', total: '1 453' }));
    for (const label of ['play.tile.pt', 'play.tile.rush', 'play.tile.trucks']) {
      expect(html, label).toContain(esc(t(label)));
    }
    expect(html).toContain(t('play.loss.h'));
    expect(html).toContain(esc(t('play.loss.noStation')));
    expect(html).toContain(t('play.trucks.with'));
    expect(html).toContain(t('play.trucks.without'));
    // the three marks of the served line, in one line and with no ranking word
    expect(html).toContain(t('play.mark.random'));
    expect(html).toContain(t('play.mark.optimiser'));
  });

  it('puts the visitor own guess next to every tile', () => {
    const html = runMarkup();
    expect(html).toContain(t('play.tile.guess', { answer: t('play.q.pt.4in10') }));
    expect(html).toContain(t('play.tile.guess', { answer: t('play.q.rush.bit') }));
    expect(html).toContain(t('play.tile.guess', { answer: t('play.q.trucks.few') }));
  });

  it('flags the estimate engine and drops the bike / bike + PT split', () => {
    const html = runMarkup('estimate');
    expect(html).toContain(t('play.estimate.tag'));
    expect(html).toContain(esc(t('play.chart.nosplit')));
    expect(html).not.toContain(esc(t('play.chart.note')));
  });
});

const optimiserMarkup = (answer: string | undefined): string => {
  const results = view();
  const optimiser = optimiserView({ reference, trucks: true, demandTotal: results.hero.demand });
  const question = findQuestion('double')!;
  const resolution = resolveAll(answer ? { double: answer } : {}, {
    withTrucks,
    withoutTrucks,
    trucks: true,
    optimiserDispatches: 9,
    rhythm: { sharpStations: ['a'], referenceStations: ['a'] },
    double: { lowBudgetEur: 60000, highBudgetEur: 120000, lowServed: 1161, highServed: 1321 },
  }).find((entry) => entry.predictionId === 'double')!;
  return renderToStaticMarkup(
    <Optimiser
      contribution={{
        stations: 83,
        docks: 1104,
        bikes: 827,
        dispatches: 9,
        fewerStations: 67,
        moreStations: 90,
        mostDispatches: 76,
        nextBudgetStepEur: 20000,
        nextTrips: 13,
      }}
      rows={compare(results, optimiser)}
      published={optimiser.published}
      mine={41}
      shared={38}
      trucks
      onTrucks={() => {}}
      question={question}
      answer={answer}
      onAnswer={() => {}}
      reveal={answer ? revealOf(resolution, 'en') : null}
      budgets={[{ id: '080k', eur: 80000, label: 'Reference · 80 000 €' }]}
      browsing="080k"
      onBrowse={() => {}}
      rungs={[{ id: 'budget_080k', budgetEur: 80000, served: 1308, ratio: 0.9, stations: 83, perTripEur: 61 }]}
      browsed={null}
      visitorServed={results.hero.served}
      visitorBudgetEur={80000}
      lang="en"
      t={t}
    />,
  );
};

describe('the optimiser screen', () => {
  it('leads the comparison with the sizing, in the order plan.md 2bis asks for', () => {
    const html = optimiserMarkup(undefined);
    const order = ['stations', 'docks', 'bikes', 'truckRuns', 'served'].map((key) =>
      html.indexOf(esc(t(`play.compare.${key}`))),
    );
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('hides the budget chips until the double-the-budget poll is answered', () => {
    expect(optimiserMarkup(undefined)).not.toContain(esc(t('play.optimiser.browse')));
    const answered = optimiserMarkup('none');
    expect(answered).toContain(t('play.optimiser.browse'));
    // the reveal carries the 30-dock caveat the plan asks for
    expect(answered).toContain('30 docks');
  });

  it('keeps the published figure one tap away, never in place of the engine', () => {
    const html = optimiserMarkup(undefined);
    expect(html).toContain(esc(t('play.compare.paper.open')));
    expect(html).toContain(esc(t('play.compare.overlap', { shared: '38', mine: '41' })));
  });
});

describe('the copy of the replay', () => {
  it('never scores the visitor', () => {
    const forbidden = /\b(score|scored|correct|incorrect|wrong|points?\s+for|you\s+win|you\s+lose)\b/i;
    const keys = Object.keys(dict).filter(
      (key) => key.startsWith('play.reveal.') || key.startsWith('play.tone.') || key.startsWith('play.ticket.'),
    );
    expect(keys.length).toBeGreaterThan(10);
    const offenders = keys.filter((key) => forbidden.test(dict[key]!));
    expect(offenders).toEqual([]);
  });
});
