/**
 * optimiserFacts.ts — the numbers step 5 says out loud, read off the runs.
 *
 * plan.md §2bis item 4 wants the research contribution stated with the real
 * figures of the scenario on screen ("it chose 83 stations and not 60 or 100,
 * put 1 104 docks and 827 bikes behind them, sent 9 truck runs and not 76"),
 * so every one of them is COMPUTED here from the committed runs the page
 * already ships — never written into the copy.
 *
 * No React, no DOM: a pure adapter over `lib/types`, tested with the real data.
 */
import type { OptimiserPlanFacts } from '../../domain/game/results';
import type { GameData, ScenarioData } from '../../lib/types';

/** One rung of the budget ladder: a solved run of the `budget` family. */
export interface BudgetRung {
  readonly id: string;
  readonly budgetEur: number;
  readonly served: number;
  readonly ratio: number;
  readonly stations: number;
  /** The run's own "investment per served trip", the diminishing-returns read-out. */
  readonly perTripEur: number;
}

const solved = (sc: ScenarioData): boolean => sc.hasResults && sc.paper != null;

/**
 * Every solved run of the budget ladder, cheapest first.
 *
 * The reference run of the study sits in the `baseline` family rather than in
 * `budget` — it is the same ladder seen from its middle rung — so it is taken
 * by ROLE, the way `lib/questions.ts` picks its plans, and never by id.
 */
export function budgetLadder(data: GameData): BudgetRung[] {
  return data.scenarios
    .filter((sc) => (sc.family === 'budget' || sc.family === 'baseline') && !sc.legacy && solved(sc))
    .map((sc) => ({
      id: sc.id,
      budgetEur: sc.paper!.budgetEur,
      served: sc.paper!.servedTotal,
      ratio: sc.paper!.servedRatio,
      stations: sc.paper!.stations,
      perTripEur: sc.paper!.investmentPerServedTripEur,
    }))
    .sort((a, b) => a.budgetEur - b.budgetEur);
}

/** The committed run a budget borrows its plan from. */
export function planOf(data: GameData, scenarioId: string): ScenarioData | null {
  return data.scenarios.find((sc) => sc.id === scenarioId && solved(sc)) ?? null;
}

/** `scenario.paper` in the shape `optimiserView` takes. */
export function planFacts(sc: ScenarioData): OptimiserPlanFacts | null {
  const paper = sc.paper;
  if (!paper) return null;
  return {
    servedTotal: paper.servedTotal,
    servedRatio: paper.servedRatio,
    demandByPeriod: paper.demandByPeriod,
    servedByPeriod: paper.servedByPeriod,
    bikeOnlyByPeriod: paper.bikeOnlyByPeriod,
    bikePtByPeriod: paper.bikePtByPeriod,
    stations: paper.stations,
    nTrans: paper.nTrans,
    docks: paper.docks,
    bikes: paper.bikes,
    capexUsedEur: paper.capexUsedEur,
    budgetEur: paper.budgetEur,
    dispatches: paper.dispatches,
  };
}

/** What the sentence of plan.md §2bis item 4 interpolates. Null without the run. */
export interface ContributionFacts {
  readonly stations: number;
  readonly docks: number;
  readonly bikes: number;
  readonly dispatches: number;
  /** The station counts the neighbouring budgets chose: "not 67 or 90". */
  readonly fewerStations: number;
  readonly moreStations: number;
  /** The most truck runs any run at this capital budget uses (the ε experiment). */
  readonly mostDispatches: number;
  /** The next rung of the ladder: what the following euros buy. */
  readonly nextBudgetStepEur: number;
  readonly nextTrips: number;
}

export function contributionFacts(data: GameData, budgetEur: number): ContributionFacts | null {
  const ladder = budgetLadder(data);
  const index = ladder.findIndex((rung) => rung.budgetEur === budgetEur);
  if (index < 0) return null;
  const here = ladder[index]!;
  const before = ladder[Math.max(0, index - 1)]!;
  const after = ladder[Math.min(ladder.length - 1, index + 1)]!;
  const sameBudget = data.scenarios.filter(
    (sc) => solved(sc) && sc.paper!.budgetEur === budgetEur && !sc.legacy,
  );
  const plan = data.scenarios.find((sc) => sc.id === here.id);
  const paper = plan?.paper ?? null;
  return {
    stations: here.stations,
    docks: paper?.docks ?? 0,
    bikes: paper?.bikes ?? 0,
    dispatches: paper?.dispatches ?? 0,
    fewerStations: before.stations,
    moreStations: after.stations,
    mostDispatches: Math.max(...sameBudget.map((sc) => sc.paper!.dispatches), paper?.dispatches ?? 0),
    nextBudgetStepEur: Math.max(0, after.budgetEur - here.budgetEur),
    nextTrips: Math.max(0, Math.round(after.served - here.served)),
  };
}

/** How many of the visitor's sites the optimiser also opens. */
export function overlapCount(mine: readonly number[], optimiser: readonly number[]): number {
  const theirs = new Set(optimiser);
  let shared = 0;
  for (const id of new Set(mine)) if (theirs.has(id)) shared += 1;
  return shared;
}

/**
 * The two rungs the "double the budget" poll compares.
 *
 * The question must stay literally true, so it is answered on a pair whose
 * high rung really is twice the low one. The visitor's own budget is used when
 * the ladder has its double (20 k€ → 40 k€); otherwise the richest such pair
 * at or below it is taken, which is the 60 k€ → 120 k€ step plan.md §4 quotes.
 */
export function doublePair(
  ladder: readonly BudgetRung[],
  budgetEur: number,
): { low: BudgetRung; high: BudgetRung } | null {
  const pairs = ladder
    .map((low) => {
      const high = ladder.find((rung) => rung.budgetEur === low.budgetEur * 2);
      return high ? { low, high } : null;
    })
    .filter((pair): pair is { low: BudgetRung; high: BudgetRung } => pair != null);
  if (pairs.length === 0) return null;
  const exact = pairs.find((pair) => pair.low.budgetEur === budgetEur);
  if (exact) return exact;
  const below = pairs.filter((pair) => pair.low.budgetEur <= budgetEur);
  return (below.length > 0 ? below : pairs)[Math.max(0, (below.length > 0 ? below : pairs).length - 1)]!;
}
