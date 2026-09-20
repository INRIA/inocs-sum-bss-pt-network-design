/**
 * results.ts — the view-model of steps 4 and 5.
 *
 * One evaluation in, the numbers of plan.md §5 out: the hero, the three tiles
 * (each answering one prediction), the three-period chart, the "trips lost, and
 * why" strip and the procurement recap. No formatting, no copy, no percentages
 * as strings: screens format, the domain computes.
 *
 * The optimiser column is built by the SAME engine (decision 4 of
 * plan-technical §A): `optimiserView` reads `references.json`, and carries the
 * published paper figure alongside for the proof popup — never in place of it.
 *
 * Pure domain: no React, no DOM, no fetch, no node imports.
 */
import type { BudgetReference } from '../evaluation/types';
import type { EvaluationSummary } from './session';

export interface HeroView {
  readonly served: number;
  readonly demand: number;
  readonly ratio: number;
}

export interface PtTile {
  readonly share: number;
  /** Served trips that combine a bike with a tram or bus. */
  readonly trips: number;
}

export interface RushTile {
  readonly middayRate: number;
  readonly peakRate: number;
  readonly morningRate: number;
  readonly eveningRate: number;
  /** Midday minus peaks, in percentage points. Positive = peaks are worse. */
  readonly gapPoints: number;
}

export interface TrucksTile {
  /**
   * Served trips that disappear when the same network is operated without
   * rebalancing. The only truck figure the visitor is ever shown: the relaxed
   * LP's own run count is unreliable (plan.md §3).
   */
  readonly dependOnTrucks: number;
  /** Exact truck runs. Non-null for the optimiser's plans only. */
  readonly dispatches: number | null;
}

export interface PeriodRow {
  readonly period: number;
  readonly demand: number;
  readonly served: number;
  readonly bikeOnly: number;
  readonly bikePt: number;
}

export type LossCause = 'noStation' | 'noStock' | 'unreachable';

export interface LossRow {
  readonly cause: LossCause;
  readonly flow: number;
  /** Share of the day's total demand. */
  readonly share: number;
}

export interface BuiltFacts {
  readonly stations: number;
  readonly atPtStops: number;
  readonly docks: number;
  readonly bikes: number;
  readonly capexEur: number;
  readonly budgetEur: number;
}

export interface ResultsView {
  readonly quality: 'exact' | 'estimate';
  readonly feasible: boolean;
  readonly hero: HeroView;
  readonly pt: PtTile;
  readonly rush: RushTile;
  readonly trucks: TrucksTile;
  readonly periods: readonly PeriodRow[];
  readonly losses: readonly LossRow[];
  readonly built: BuiltFacts;
}

export interface ResultsInput {
  /** The solve the switch selects: what the screen shows. */
  readonly evaluation: EvaluationSummary;
  /** Both solves, for the "trips that depend on trucks" tile. */
  readonly withTrucks: EvaluationSummary;
  readonly withoutTrucks: EvaluationSummary;
  readonly budgetEur: number;
}

const rate = (served: number, demand: number): number => (demand > 0 ? served / demand : 0);

/** The minimum a rush tile needs: two per-period series. */
export interface PeriodSeries {
  readonly servedByPeriod: readonly number[];
  readonly demandByPeriod: readonly number[];
}

export function rushOf(evaluation: PeriodSeries): RushTile {
  const served = evaluation.servedByPeriod;
  const demand = evaluation.demandByPeriod;
  const morning = rate(served[0] ?? 0, demand[0] ?? 0);
  const midday = rate(served[1] ?? 0, demand[1] ?? 0);
  const evening = rate(served[2] ?? 0, demand[2] ?? 0);
  const peak = (morning + evening) / 2;
  return {
    middayRate: midday,
    peakRate: peak,
    morningRate: morning,
    eveningRate: evening,
    gapPoints: (midday - peak) * 100,
  };
}

export function periodsOf(evaluation: EvaluationSummary): PeriodRow[] {
  const count = evaluation.demandByPeriod.length;
  const rows: PeriodRow[] = [];
  for (let period = 0; period < count; period += 1) {
    rows.push({
      period,
      demand: evaluation.demandByPeriod[period] ?? 0,
      served: evaluation.servedByPeriod[period] ?? 0,
      bikeOnly: evaluation.bikeOnlyByPeriod[period] ?? 0,
      bikePt: evaluation.bikePtByPeriod[period] ?? 0,
    });
  }
  return rows;
}

/** The strip under the map, biggest cause first. */
export function lossesOf(evaluation: EvaluationSummary): LossRow[] {
  const total = evaluation.demandTotal;
  const causes: LossCause[] = ['noStation', 'noStock', 'unreachable'];
  return causes
    .map((cause) => ({
      cause,
      flow: evaluation.losses[cause],
      share: total > 0 ? evaluation.losses[cause] / total : 0,
    }))
    .sort((a, b) => b.flow - a.flow);
}

/** The visitor's results screen. */
export function resultsView(input: ResultsInput): ResultsView {
  const evaluation = input.evaluation;
  return {
    quality: evaluation.quality,
    feasible: evaluation.feasible,
    hero: {
      served: evaluation.served,
      demand: evaluation.demandTotal,
      ratio: evaluation.servedRatio,
    },
    pt: { share: evaluation.ptShare, trips: Math.round(evaluation.ptShare * evaluation.served) },
    rush: rushOf(evaluation),
    trucks: {
      dependOnTrucks: Math.max(
        0,
        Math.round(input.withTrucks.served - input.withoutTrucks.served),
      ),
      dispatches: null,
    },
    periods: periodsOf(evaluation),
    losses: lossesOf(evaluation),
    built: {
      stations: evaluation.nStations,
      atPtStops: evaluation.nTransfer,
      docks: evaluation.docks,
      bikes: evaluation.bikes,
      capexEur: evaluation.capexEur,
      budgetEur: input.budgetEur,
    },
  };
}

/**
 * The committed plan's own figures, as the screens already hold them.
 *
 * Structurally a subset of `lib/types.ts::PaperKpis`, redeclared here so the
 * domain keeps importing nothing from the project outside `domain/` — a screen
 * passes `scenario.paper` straight in. It carries what `references.json` does
 * not: docks, bikes, the exact truck runs and the per-period split.
 */
export interface OptimiserPlanFacts {
  readonly servedTotal: number;
  readonly servedRatio: number;
  readonly demandByPeriod: readonly number[];
  readonly servedByPeriod: readonly number[];
  readonly bikeOnlyByPeriod: readonly number[];
  readonly bikePtByPeriod: readonly number[];
  readonly stations: number;
  readonly nTrans: number;
  readonly docks: number;
  readonly bikes: number;
  readonly capexUsedEur: number;
  readonly budgetEur: number;
  readonly dispatches: number;
}

export interface OptimiserView {
  /** Always the same engine as the visitor's column. */
  readonly engine: 'same-engine';
  readonly hero: HeroView;
  readonly pt: PtTile;
  /** Null until the run's paper KPIs are passed in: `references.json` has no split. */
  readonly rush: RushTile | null;
  readonly trucks: TrucksTile;
  readonly periods: readonly PeriodRow[] | null;
  readonly built: BuiltFacts | null;
  /** The published paper figure, for the proof popup only. */
  readonly published: { readonly served: number; readonly ratio: number };
  readonly nStations: number;
}

export interface OptimiserInput {
  readonly reference: BudgetReference;
  /** The results switch: the optimiser's network operated with or without trucks. */
  readonly trucks: boolean;
  /** The day's demand, to turn served trips into a ratio. */
  readonly demandTotal: number;
  /** `scenario.paper` of the same run, when the screen has it. */
  readonly plan?: OptimiserPlanFacts | null;
}

/**
 * The optimiser column of step 5.
 *
 * Served and PT share come from `references.json`, i.e. from the browser's own
 * engine run on the optimiser's layout, so the two columns are comparable and a
 * rounding artefact can never make the visitor "beat" the optimiser. The
 * published figure travels alongside, one tap away in the proof popup.
 */
export function optimiserView(input: OptimiserInput): OptimiserView {
  const reference = input.reference;
  const served = input.trucks ? reference.optimiserServed : reference.optimiserServedNoTrucks;
  const share = input.trucks ? reference.optimiserPtShare : reference.optimiserPtShareNoTrucks;
  const plan = input.plan ?? null;
  const planRush: RushTile | null = plan
    ? rushOf({
        servedByPeriod: plan.servedByPeriod,
        demandByPeriod: plan.demandByPeriod,
      })
    : null;
  const periods: PeriodRow[] | null = plan
    ? plan.demandByPeriod.map((demand, period) => ({
        period,
        demand,
        served: plan.servedByPeriod[period] ?? 0,
        bikeOnly: plan.bikeOnlyByPeriod[period] ?? 0,
        bikePt: plan.bikePtByPeriod[period] ?? 0,
      }))
    : null;
  return {
    engine: 'same-engine',
    hero: { served, demand: input.demandTotal, ratio: rate(served, input.demandTotal) },
    pt: { share, trips: Math.round(share * served) },
    rush: planRush,
    trucks: {
      dependOnTrucks: Math.max(
        0,
        Math.round(reference.optimiserServed - reference.optimiserServedNoTrucks),
      ),
      dispatches: plan ? plan.dispatches : null,
    },
    periods,
    built: plan
      ? {
          stations: plan.stations,
          atPtStops: plan.nTrans,
          docks: plan.docks,
          bikes: plan.bikes,
          capexEur: plan.capexUsedEur,
          budgetEur: plan.budgetEur,
        }
      : null,
    published: {
      served: reference.publishedServedTotal,
      ratio: rate(reference.publishedServedTotal, input.demandTotal),
    },
    nStations: reference.nStations,
  };
}

export type CompareKey =
  | 'stations'
  | 'docks'
  | 'bikes'
  | 'truckRuns'
  | 'served'
  | 'ptShare'
  | 'rushGap';

export interface CompareRow {
  readonly key: CompareKey;
  /** `play.compare.<key>` */
  readonly labelKey: string;
  readonly you: number | null;
  readonly optimiser: number | null;
  /** True for the row only the optimiser can honestly fill (truck runs). */
  readonly optimiserOnly: boolean;
  /** How the screen prints the two cells: a count, trips, a share, or points. */
  readonly format: 'count' | 'trips' | 'share' | 'points';
}

/**
 * The "You · Optimiser" table.
 *
 * Leads with station count, docks, bikes and truck runs, and only then served
 * trips — plan.md §2bis item 4: what the research adds is the sizing, not the
 * placement. `truckRuns` is the optimiser's exact figure with an empty visitor
 * cell, by design: the relaxed LP cannot produce a trustworthy one.
 */
export function compare(visitor: ResultsView, optimiser: OptimiserView): CompareRow[] {
  const row = (
    key: CompareKey,
    you: number | null,
    opt: number | null,
    format: CompareRow['format'] = 'count',
    optimiserOnly = false,
  ): CompareRow => ({ key, labelKey: `play.compare.${key}`, you, optimiser: opt, optimiserOnly, format });
  const built = optimiser.built;
  return [
    row('stations', visitor.built.stations, built ? built.stations : optimiser.nStations),
    row('docks', visitor.built.docks, built ? built.docks : null),
    row('bikes', visitor.built.bikes, built ? built.bikes : null),
    row('truckRuns', null, optimiser.trucks.dispatches, 'count', true),
    row('served', visitor.hero.served, optimiser.hero.served, 'trips'),
    row('ptShare', visitor.pt.share, optimiser.pt.share, 'share'),
    row(
      'rushGap',
      visitor.rush.gapPoints,
      optimiser.rush ? optimiser.rush.gapPoints : null,
      'points',
    ),
  ];
}
