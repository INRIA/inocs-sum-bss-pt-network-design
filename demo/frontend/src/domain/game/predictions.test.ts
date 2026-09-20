/**
 * predictions.test.ts — every resolver at its band edges, then against the
 * committed runs.
 *
 * The band edges are pinned because the bands ARE the honesty of the game: a
 * threshold that does not sit between two option values would make a true
 * answer read as wrong. The second half resolves `trucks`, `rhythm` and
 * `double` on the real artefacts (`demo/experiments/results/<id>/`), so a
 * re-run that moved the numbers fails here rather than misleading a visitor.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  PREDICTIONS,
  allAnswered,
  findQuestion,
  isOptionOf,
  questionsFor,
  resolveAll,
  resolveDouble,
  resolvePt,
  resolveRhythm,
  resolveRush,
  resolveServed,
  resolveTrucks,
  type ResolutionInputs,
} from './predictions';
import { fakeEvaluation } from './testSupport';

/** demo/experiments/results, relative to this file. TEST ONLY. */
const RESULTS = join(dirname(fileURLToPath(import.meta.url)), '../../../../experiments/results');

interface PaperBlock {
  served_total: number;
  served_ratio: number;
  pt_assisted_share: number;
  dispatches: number;
  served_by_period: number[];
  demand_by_period: number[];
  demand_total: number;
}

const paperOf = (scenario: string): PaperBlock =>
  (JSON.parse(readFileSync(join(RESULTS, scenario, 'kpis.json'), 'utf8')) as {
    paper: PaperBlock;
  }).paper;

const stationIdsOf = (scenario: string): string[] =>
  (JSON.parse(readFileSync(join(RESULTS, scenario, 'stations.json'), 'utf8')) as {
    stations: { station: string }[];
  }).stations.map((row) => row.station);

/** The committed plan, read as if it were an evaluation of that layout. */
const asEvaluation = (scenario: string) => {
  const paper = paperOf(scenario);
  return fakeEvaluation({
    served: paper.served_total,
    demandTotal: paper.demand_total,
    ptShare: paper.pt_assisted_share,
    servedByPeriod: paper.served_by_period,
    demandByPeriod: paper.demand_by_period,
  });
};

const BUDGETS = ['budget_020k', 'budget_060k', 'budget_080k', 'budget_120k'] as const;

describe('the question set', () => {
  it('asks five polls in step 3 and one in step 5', () => {
    expect(questionsFor('predict').map((q) => q.id)).toEqual([
      'served',
      'pt',
      'rush',
      'trucks',
      'rhythm',
    ]);
    expect(questionsFor('optimiser').map((q) => q.id)).toEqual(['double']);
    expect(PREDICTIONS).toHaveLength(6);
  });

  it('carries i18n keys and a conclusion card for each question', () => {
    for (const question of PREDICTIONS) {
      expect(question.questionKey).toBe(`play.q.${question.id}`);
      expect(question.options.length).toBeGreaterThanOrEqual(2);
      for (const option of question.options) {
        expect(option.labelKey).toBe(`play.q.${question.id}.${option.id}`);
      }
      expect(['q1', 'q2', 'q3', 'q4', 'new']).toContain(question.card);
    }
    // The rush question is the one the full demo has no card for (plan.md §4).
    expect(findQuestion('rush')?.card).toBe('new');
    expect(findQuestion('trucks')?.card).toBe('q3');
    expect(isOptionOf('rush', 'much')).toBe(true);
    expect(isOptionOf('rush', 'none')).toBe(false);
  });

  it('knows when a step is fully answered', () => {
    expect(allAnswered('predict', { served: 'gt90' })).toBe(false);
    expect(
      allAnswered('predict', {
        served: 'gt90',
        pt: '4in10',
        rush: 'bit',
        trucks: 'few',
        rhythm: 'same',
      }),
    ).toBe(true);
    expect(allAnswered('optimiser', { double: 'none' })).toBe(true);
  });
});

describe('served', () => {
  const at = (ratio: number): string =>
    resolveServed(null, fakeEvaluation({ served: 1000 * ratio, demandTotal: 1000 })).actual;

  it('bands at 40, 70 and 90 per cent', () => {
    expect(at(0.399)).toBe('lt40');
    expect(at(0.4)).toBe('40to70');
    expect(at(0.699)).toBe('40to70');
    expect(at(0.7)).toBe('70to90');
    expect(at(0.899)).toBe('70to90');
    expect(at(0.9)).toBe('gt90');
  });

  it('reports the numbers the reveal needs, and whether the guess matched', () => {
    const resolved = resolveServed('70to90', fakeEvaluation({ served: 886, demandTotal: 1453 }));
    expect(resolved).toMatchObject({ predictionId: 'served', actual: '40to70', matched: false });
    expect(resolved.facts).toMatchObject({ served: 886, demand: 1453 });
    expect(resolveServed(null, fakeEvaluation()).matched).toBe(false);
  });
});

describe('pt', () => {
  const at = (share: number): string => resolvePt(null, fakeEvaluation({ ptShare: share })).actual;

  it('bands between the option values: 0.15, 0.30, 0.50', () => {
    expect(at(0.149)).toBe('lt1in10');
    expect(at(0.15)).toBe('2in10');
    expect(at(0.299)).toBe('2in10');
    expect(at(0.3)).toBe('4in10');
    expect(at(0.499)).toBe('4in10');
    expect(at(0.5)).toBe('gt6in10');
  });
});

describe('rush', () => {
  /** A day whose midday rate beats the peaks by `gap` percentage points. */
  const withGap = (gap: number) =>
    fakeEvaluation({
      demandByPeriod: [1000, 1000, 1000],
      servedByPeriod: [500, 500 + gap * 10, 500],
    });

  it('bands at 3 and 10 percentage points', () => {
    expect(resolveRush(null, withGap(2.9)).actual).toBe('same');
    expect(resolveRush(null, withGap(3)).actual).toBe('bit');
    expect(resolveRush(null, withGap(10)).actual).toBe('bit');
    expect(resolveRush(null, withGap(10.1)).actual).toBe('much');
  });

  it('calls it "just as well" when the peaks do better than midday', () => {
    expect(resolveRush(null, withGap(-20)).actual).toBe('same');
  });

  it('survives a period with no demand', () => {
    const resolved = resolveRush(null, fakeEvaluation({
      demandByPeriod: [0, 0, 0],
      servedByPeriod: [0, 0, 0],
    }));
    expect(resolved.actual).toBe('same');
    expect(Number.isFinite(resolved.facts.gapPoints as number)).toBe(true);
  });
});

describe('trucks', () => {
  const at = (dispatches: number) =>
    resolveTrucks(null, {
      dispatches,
      withTrucks: fakeEvaluation({ served: 1000 }),
      withoutTrucks: fakeEvaluation({ served: 964 }),
    });

  it('bands at 0 and 20 runs', () => {
    expect(at(0).actual).toBe('none');
    expect(at(1).actual).toBe('few');
    expect(at(19).actual).toBe('few');
    expect(at(20).actual).toBe('dozens');
    expect(at(76).actual).toBe('dozens');
  });

  it('carries the visitor-side number: the trips that depend on trucks', () => {
    expect(at(9).facts.dependOnTrucks).toBe(36);
  });

  it('never reports a negative dependency', () => {
    const resolved = resolveTrucks(null, {
      dispatches: 3,
      withTrucks: fakeEvaluation({ served: 900 }),
      withoutTrucks: fakeEvaluation({ served: 940 }),
    });
    expect(resolved.facts.dependOnTrucks).toBe(0);
  });
});

describe('rhythm', () => {
  it('answers "same places" only when the sharp plan is contained in the reference', () => {
    const contained = resolveRhythm(null, {
      sharpStations: ['a', 'b', 'c'],
      referenceStations: ['a', 'b', 'c', 'd'],
    });
    expect(contained.actual).toBe('same');
    expect(contained.facts.overlap).toBe(1);

    const ninety = resolveRhythm(null, {
      sharpStations: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
      referenceStations: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
    });
    expect(ninety.facts.overlap).toBeCloseTo(0.9, 6);
    expect(ninety.actual).toBe('same');

    const moved = resolveRhythm(null, {
      sharpStations: ['a', 'b', 'c', 'd', 'e'],
      referenceStations: ['a', 'b', 'c', 'x', 'y'],
    });
    expect(moved.actual).toBe('move');
  });

  it('does not divide by zero on an empty plan', () => {
    expect(resolveRhythm(null, { sharpStations: [], referenceStations: [] }).actual).toBe('move');
  });
});

describe('double', () => {
  const at = (ratio: number) =>
    resolveDouble(null, {
      lowBudgetEur: 60000,
      highBudgetEur: 120000,
      lowServed: 1000,
      highServed: 1000 * ratio,
    }).actual;

  it('bands between the option values: 1.20 and 1.70', () => {
    expect(at(1.19)).toBe('none');
    expect(at(1.2)).toBe('third');
    expect(at(1.69)).toBe('third');
    expect(at(1.7)).toBe('twice');
    expect(at(2)).toBe('twice');
  });
});

describe('against the committed runs', () => {
  it('resolves the four budgets as the artefacts say', () => {
    const table = BUDGETS.map((scenario) => {
      const evaluation = asEvaluation(scenario);
      const paper = paperOf(scenario);
      return {
        scenario,
        served: resolveServed(null, evaluation).actual,
        pt: resolvePt(null, evaluation).actual,
        rush: resolveRush(null, evaluation).actual,
        trucks: resolveTrucks(null, {
          dispatches: paper.dispatches,
          withTrucks: evaluation,
          withoutTrucks: evaluation,
        }).actual,
      };
    });
    expect(table).toEqual([
      { scenario: 'budget_020k', served: 'lt40', pt: '2in10', rush: 'much', trucks: 'none' },
      { scenario: 'budget_060k', served: '70to90', pt: '4in10', rush: 'much', trucks: 'few' },
      { scenario: 'budget_080k', served: 'gt90', pt: '4in10', rush: 'bit', trucks: 'few' },
      { scenario: 'budget_120k', served: 'gt90', pt: '4in10', rush: 'bit', trucks: 'few' },
    ]);
  });

  it('resolves "double the budget" to "almost none" — 1 161 to 1 321 trips', () => {
    const low = paperOf('budget_060k');
    const high = paperOf('budget_120k');
    const resolved = resolveDouble('twice', {
      lowBudgetEur: 60000,
      highBudgetEur: 120000,
      lowServed: low.served_total,
      highServed: high.served_total,
    });
    expect([low.served_total, high.served_total]).toEqual([1161, 1321]);
    expect(resolved.actual).toBe('none');
    expect(resolved.matched).toBe(false);
    expect(resolved.facts.extraTrips).toBe(160);
    expect(resolved.facts.extraPercent as number).toBeCloseTo(13.78, 1);
  });

  it('resolves the rhythm question to "same places" from the two plans', () => {
    const resolved = resolveRhythm('same', {
      sharpStations: stationIdsOf('rhythm_sharp'),
      referenceStations: stationIdsOf('budget_080k'),
    });
    expect(resolved.facts.sharpTotal).toBe(75);
    expect(resolved.facts.overlap).toBe(1);
    expect(resolved).toMatchObject({ actual: 'same', matched: true });
  });
});

describe('resolveAll', () => {
  it('returns one resolution per question, in asking order', () => {
    const inputs: ResolutionInputs = {
      withTrucks: asEvaluation('budget_080k'),
      withoutTrucks: fakeEvaluation({ served: 1271, demandTotal: 1453 }),
      trucks: true,
      optimiserDispatches: paperOf('budget_080k').dispatches,
      rhythm: {
        sharpStations: stationIdsOf('rhythm_sharp'),
        referenceStations: stationIdsOf('budget_080k'),
      },
      double: {
        lowBudgetEur: 60000,
        highBudgetEur: 120000,
        lowServed: paperOf('budget_060k').served_total,
        highServed: paperOf('budget_120k').served_total,
      },
    };
    const resolved = resolveAll({ served: 'gt90', double: 'none' }, inputs);
    expect(resolved.map((entry) => entry.predictionId)).toEqual([
      'served',
      'pt',
      'rush',
      'trucks',
      'rhythm',
      'double',
    ]);
    expect(resolved[0]).toMatchObject({ chosen: 'gt90', matched: true });
    expect(resolved[5]).toMatchObject({ chosen: 'none', actual: 'none', matched: true });
    expect(resolved[3]?.facts.dependOnTrucks).toBe(37);
  });
});
