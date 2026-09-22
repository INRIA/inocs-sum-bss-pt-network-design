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

import { resultsView, type ResultsView } from '../../domain/game/results';
import { fakeEvaluation } from '../../domain/game/testSupport';
import type { BudgetReference } from '../../domain/evaluation/types';
import { makeT } from '../../lib/i18n';
import en from '../../i18n/en.json';
import Run from './screens/Run';
import { fateSlices } from './screens/ResultBits';
import Optimiser from './screens/Optimiser';

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

/** The optimiser's plan at 80 k€: 827 bikes over 83 stations, 0 to 30 each. */
const BIKES = { min: 0, mean: 827 / 83, max: 30, stations: 83, bikes: 827 };

const runMarkup = (quality: 'exact' | 'estimate' = 'exact'): string => {
  const results = view(quality);
  return renderToStaticMarkup(
    <Run
      status={quality === 'estimate' ? 'estimate' : 'ready'}
      view={results}
      answers={{ pt: '4in10', rush: 'bit', trucks: 'few', bikes: '5to15' }}
      bikes={BIKES}
      trucks
      onReplay={() => {}}
      periodName="morning"
      reduced={false}
      period={0}
      onPeriod={() => {}}
      playing={false}
      hour={8}
      onSeekHour={() => {}}
      onTogglePlay={() => {}}
      periods={3}
      nothingToRebalance={false}
      onRetry={() => {}}
      lang="en"
      t={t}
    />,
  );
};

describe('the results screen', () => {
  it('shows five KPI cards, the trips pie and the period bars', () => {
    const html = runMarkup();
    for (const label of [
      'play.kpi.service',
      'play.tile.pt',
      'play.kpi.trucks',
      'play.kpi.stations',
      'play.kpi.bikes',
    ]) {
      expect(html, label).toContain(esc(t(label)));
    }
    expect(html).toContain(esc(t('play.pie.h')));
    for (const fate of ['bikeOnly', 'bikePt', 'noStation', 'noStock', 'unreachable']) {
      expect(html, fate).toContain(esc(t(`play.pie.${fate}`)));
    }
    expect(html).toContain(t('play.bars.h'));
    // the old strips are gone: hero, marks line, rush tile, losses list, stacked chart
    for (const gone of ['play.tile.rush', 'play.loss.h', 'play.chart.h']) {
      expect(html, gone).not.toContain(esc(t(gone)));
    }
  });

  it('puts the visitor own guess next to the cards that answer one', () => {
    const html = runMarkup();
    expect(html).toContain(esc(t('play.tile.guess', { answer: t('play.q.pt.4in10') })));
    expect(html).toContain(esc(t('play.tile.guess', { answer: t('play.q.trucks.few') })));
    expect(html).toContain(esc(t('play.tile.guess', { answer: t('play.q.bikes.5to15') })));
  });

  it('takes every pie share from the total number of trips', () => {
    const results = view();
    const slices = fateSlices(results);
    const total = results.hero.demand;
    expect(slices).toHaveLength(5);
    expect(slices[0]!.share).toBeCloseTo((results.hero.served - results.pt.trips) / total, 9);
    expect(slices[1]!.share).toBeCloseTo(results.pt.trips / total, 9);
    for (const [index, cause] of (['noStation', 'noStock', 'unreachable'] as const).entries()) {
      const flow = results.losses.find((row) => row.cause === cause)!.flow;
      expect(slices[index + 2]!.share).toBeCloseTo(flow / total, 9);
    }
    const sum = slices.reduce((acc, slice) => acc + slice.share, 0);
    expect(slices[4]!.accumulated).toBeCloseTo(sum, 9);
  });
});

const optimiserMarkup = (): string => {
  const results = view();
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
      view={results}
      bikes={BIKES}
      mine={41}
      shared={38}
      trucks
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
  it('prints the step-4 tiles and charts for the browsed budget', () => {
    const html = optimiserMarkup();
    for (const key of ['play.kpi.service', 'play.tile.pt', 'play.kpi.trucks', 'play.kpi.stations', 'play.pie.h', 'play.bars.h']) {
      expect(html).toContain(esc(t(key)));
    }
  });

  it('always offers the budget chips and no longer asks the double-budget poll', () => {
    const html = optimiserMarkup();
    expect(html).toContain('Reference · 80 000 €');
    expect(html).not.toContain(esc(t('play.q.double')));
  });

  it("shows how many of the visitor's own sites the optimiser also chose", () => {
    const html = optimiserMarkup();
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
