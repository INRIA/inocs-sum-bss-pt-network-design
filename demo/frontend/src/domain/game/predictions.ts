/**
 * predictions.ts — the polls, as data, plus the pure resolvers that say
 * what the model actually answered.
 *
 * Open/closed (plan-technical §C.4): a new prediction is one entry in
 * `PREDICTIONS` and one resolver here; no screen changes shape. The domain
 * never produces prose — a resolution carries the option the evidence supports
 * and the `facts` the reveal sentence interpolates, and the copy lives in
 * `play.*` i18n keys.
 *
 * `matched` is NOT a score (plan.md §2: "no score, no win or lose"). It picks
 * the tone of the reveal and nothing else.
 *
 * Pure domain: no React, no DOM, no fetch, no node imports.
 */
import type { EvaluationSummary } from './session';

export type PredictionId = 'served' | 'pt' | 'rush' | 'trucks' | 'bikes' | 'double';

/** Where a poll is asked. `optimiser` = step 5, just before the budget CTA. */
export type AskedIn = 'predict' | 'optimiser';

/** The conclusion card of the full demo a prediction is replayed against. */
export type ConclusionCard = 'q1' | 'q2' | 'q3' | 'q4' | 'new';

export interface PredictionOption {
  readonly id: string;
  /** `play.q.<question>.<option>` */
  readonly labelKey: string;
}

export interface PredictionQuestion {
  readonly id: PredictionId;
  readonly askedIn: AskedIn;
  /** `play.q.<id>` */
  readonly questionKey: string;
  readonly options: readonly PredictionOption[];
  readonly card: ConclusionCard;
}

const question = (
  id: PredictionId,
  askedIn: AskedIn,
  card: ConclusionCard,
  options: readonly string[],
): PredictionQuestion => ({
  id,
  askedIn,
  card,
  questionKey: `play.q.${id}`,
  options: options.map((option) => ({ id: option, labelKey: `play.q.${id}.${option}` })),
});

/**
 * The four polls of step 3 (all optional) and the one of step 5, in the order they are asked.
 * Wordings and the card each one links to: plan.md §4.
 */
export const PREDICTIONS: readonly PredictionQuestion[] = [
  question('served', 'predict', 'q1', ['lt40', '40to70', '70to90', 'gt90']),
  question('pt', 'predict', 'q2', ['lt1in10', '2in10', '4in10', 'gt6in10']),
  question('trucks', 'predict', 'q3', ['none', 'few', 'dozens']),
  question('bikes', 'predict', 'q3', ['lt5', '5to15', '15to25', 'gt25']),
  question('double', 'optimiser', 'q1', ['twice', 'third', 'none']),
];

export const PREDICTION_IDS: readonly PredictionId[] = PREDICTIONS.map((entry) => entry.id);

export function questionsFor(step: AskedIn): readonly PredictionQuestion[] {
  return PREDICTIONS.filter((entry) => entry.askedIn === step);
}

export function findQuestion(id: string): PredictionQuestion | null {
  return PREDICTIONS.find((entry) => entry.id === id) ?? null;
}

export function isPredictionId(value: unknown): value is PredictionId {
  return typeof value === 'string' && PREDICTION_IDS.includes(value as PredictionId);
}

/** True when `optionId` is one of the options that question offers. */
export function isOptionOf(id: PredictionId, optionId: string): boolean {
  return Boolean(findQuestion(id)?.options.some((option) => option.id === optionId));
}

export function allAnswered(
  step: AskedIn,
  answers: Readonly<Record<string, string>>,
): boolean {
  return questionsFor(step).every((entry) => Boolean(answers[entry.id]));
}

/** What a resolver returns. `facts` carries numbers only — never a sentence. */
export interface Resolution {
  readonly predictionId: PredictionId;
  /** The option the visitor chose, or null when they skipped it. */
  readonly chosen: string | null;
  /** The option the evidence supports. */
  readonly actual: string;
  readonly matched: boolean;
  readonly facts: Readonly<Record<string, number | string>>;
}

const resolution = (
  predictionId: PredictionId,
  chosen: string | null,
  actual: string,
  facts: Record<string, number | string>,
): Resolution => ({ predictionId, chosen, actual, matched: chosen === actual, facts });

const rate = (served: number, demand: number): number => (demand > 0 ? served / demand : 0);

/**
 * "How many of the city's trips will your network serve?"
 *
 * Bands on the visitor's served ratio: <0.40 · [0.40,0.70) · [0.70,0.90) ·
 * >=0.90. Resolved on the WITH-trucks solve whatever the results switch says,
 * so the answer to a question asked once does not move under the visitor.
 */
export function resolveServed(chosen: string | null, withTrucks: EvaluationSummary): Resolution {
  const ratio = withTrucks.servedRatio;
  const actual = ratio < 0.4 ? 'lt40' : ratio < 0.7 ? '40to70' : ratio < 0.9 ? '70to90' : 'gt90';
  return resolution('served', chosen, actual, {
    served: Math.round(withTrucks.served),
    demand: Math.round(withTrucks.demandTotal),
    ratio,
  });
}

/**
 * "How many of those trips will also use a tram or bus?"
 *
 * Bands on the PT-assisted share of SERVED trips: <0.15 "under 1 in 10" ·
 * [0.15,0.30) "2 in 10" · [0.30,0.50) "4 in 10" · >=0.50 "over 6 in 10". The
 * bands sit between the option values (0.10 / 0.20 / 0.40 / 0.60), so the
 * option nearest the truth wins; the grid lands at 0.186 (20 k€) and 0.372 to
 * 0.402 (60 to 120 k€), comfortably inside "2 in 10" and "4 in 10".
 */
export function resolvePt(chosen: string | null, withTrucks: EvaluationSummary): Resolution {
  const share = withTrucks.ptShare;
  const actual =
    share < 0.15 ? 'lt1in10' : share < 0.3 ? '2in10' : share < 0.5 ? '4in10' : 'gt6in10';
  return resolution('pt', chosen, actual, {
    share,
    trips: Math.round(share * withTrucks.served),
    served: Math.round(withTrucks.served),
  });
}

/**
 * "Will rush hours be served as well as the quiet midday?"
 *
 * Gap, in percentage points, between the midday served RATE and the mean of
 * the morning and evening rates: <3 "just as well" · [3,10] "a little worse" ·
 * >10 "much worse". A negative gap (peaks served better than midday) resolves
 * to "just as well". The committed plans land at 14.4 pt (20 k€), 13.7 (60 k€),
 * 8.1 (80 k€) and 7.0 (120 k€), so both worded outcomes are reachable and
 * neither band edge is a coin flip.
 */
export function resolveRush(chosen: string | null, evaluation: EvaluationSummary): Resolution {
  const served = evaluation.servedByPeriod;
  const demand = evaluation.demandByPeriod;
  const midday = rate(served[1] ?? 0, demand[1] ?? 0);
  const morning = rate(served[0] ?? 0, demand[0] ?? 0);
  const evening = rate(served[2] ?? 0, demand[2] ?? 0);
  const peak = (morning + evening) / 2;
  const gapPoints = (midday - peak) * 100;
  const actual = gapPoints < 3 ? 'same' : gapPoints <= 10 ? 'bit' : 'much';
  return resolution('rush', chosen, actual, {
    middayRate: midday,
    peakRate: peak,
    morningRate: morning,
    eveningRate: evening,
    gapPoints,
  });
}

export interface TruckFacts {
  /** The OPTIMISER's exact truck runs at this budget, from the run's paper KPIs. */
  readonly dispatches: number;
  readonly withTrucks: EvaluationSummary;
  readonly withoutTrucks: EvaluationSummary;
}

/**
 * "How many truck runs a day to keep bikes where needed?"
 *
 * Resolved on the optimiser's EXACT `dispatches` (0 "none" · 1 to 19 "a
 * handful" · >=20 "dozens"), because the relaxed browser LP buys fractional
 * runs and overstates them by 18 to 31 % (plan.md §3). The visitor's own number
 * is the honest one the reveal shows next to it: `dependOnTrucks`, the served
 * trips that disappear when the same network is operated without rebalancing.
 */
export function resolveTrucks(chosen: string | null, facts: TruckFacts): Resolution {
  const runs = facts.dispatches;
  const actual = runs <= 0 ? 'none' : runs < 20 ? 'few' : 'dozens';
  const dependOnTrucks = Math.max(
    0,
    Math.round(facts.withTrucks.served - facts.withoutTrucks.served),
  );
  return resolution('trucks', chosen, actual, {
    dispatches: runs,
    dependOnTrucks,
    servedWithTrucks: Math.round(facts.withTrucks.served),
    servedWithoutTrucks: Math.round(facts.withoutTrucks.served),
  });
}

export interface BikesFacts {
  /** Bikes the model parks at the emptiest station of its own plan. */
  readonly min: number;
  /** Bikes per station on average, over the built stations of that plan. */
  readonly mean: number;
  readonly max: number;
  readonly stations: number;
  /** The plan's whole starting fleet. */
  readonly bikes: number;
}

/** The cuts between the four options, in bikes per station. */
export const BIKES_BANDS = [5, 15, 25] as const;

/**
 * "How many bikes per station do we need?"
 *
 * Answered on the OPTIMISER's own plan at the visitor's budget, never on the
 * visitor's layout: the question is what the model decided, and the committed
 * runs decided it once. `mean` is the plan's starting fleet over its built
 * stations, read off `model_plan.json`'s per-station inventory, so a re-run
 * that resized the fleet moves the answer; nothing here is a literal.
 *
 * Bands between the option values: <5 - [5,15) - [15,25) - >=25. The four
 * shipped budgets land at 5.9 (20 k€), 9.4 (60 k€), 10.0 (80 k€) and 10.6
 * (120 k€) bikes per station, comfortably inside the second band, while the
 * individual stations of a plan run from 0 to the 30-dock cap.
 */
export function resolveBikes(chosen: string | null, facts: BikesFacts): Resolution {
  const mean = facts.mean;
  const [low, mid, high] = BIKES_BANDS;
  const actual = mean < low ? 'lt5' : mean < mid ? '5to15' : mean < high ? '15to25' : 'gt25';
  return resolution('bikes', chosen, actual, {
    mean,
    min: facts.min,
    max: facts.max,
    stations: facts.stations,
    bikes: facts.bikes,
  });
}

export interface DoubleFacts {
  readonly lowBudgetEur: number;
  readonly highBudgetEur: number;
  /** Served trips of the optimiser's plan at each budget, from the paper KPIs. */
  readonly lowServed: number;
  readonly highServed: number;
}

/**
 * "Double the budget. How many more trips?"
 *
 * Bands on served(high) / served(low). The options mean x2.0, x1.33 and x1.0,
 * so the cuts sit between them: >=1.70 "nearly twice" (midpoint of 1.33 and
 * 2.0 is 1.67) · [1.20,1.70) "about a third more" (midpoint of 1.0 and 1.33 is
 * 1.17) · <1.20 "almost none". The real ladder is 1 161 -> 1 321 trips from
 * 60 k€ to 120 k€, a ratio of 1.138, so "almost none" is the true answer — and
 * the reveal must carry the cap caveat (plan.md §5: +14 %, partly because the
 * model limits a station to 30 docks).
 */
export const DOUBLE_TWICE_THRESHOLD = 1.7;
export const DOUBLE_THIRD_THRESHOLD = 1.2;

export function resolveDouble(chosen: string | null, facts: DoubleFacts): Resolution {
  const ratio = facts.lowServed > 0 ? facts.highServed / facts.lowServed : 0;
  const actual =
    ratio >= DOUBLE_TWICE_THRESHOLD
      ? 'twice'
      : ratio >= DOUBLE_THIRD_THRESHOLD
        ? 'third'
        : 'none';
  return resolution('double', chosen, actual, {
    ratio,
    lowServed: Math.round(facts.lowServed),
    highServed: Math.round(facts.highServed),
    extraTrips: Math.round(facts.highServed - facts.lowServed),
    extraPercent: (ratio - 1) * 100,
    lowBudgetEur: facts.lowBudgetEur,
    highBudgetEur: facts.highBudgetEur,
  });
}

/** Everything the six resolvers need, gathered once by the screen. */
export interface ResolutionInputs {
  readonly withTrucks: EvaluationSummary;
  readonly withoutTrucks: EvaluationSummary;
  /** Which solve the rush tile is read on: the results switch. */
  readonly trucks: boolean;
  readonly optimiserDispatches: number;
  readonly bikes: BikesFacts;
  readonly double: DoubleFacts;
}

/** Resolve one prediction. Returns null for an id this build does not know. */
export function resolveOne(
  id: PredictionId,
  chosen: string | null,
  inputs: ResolutionInputs,
): Resolution | null {
  switch (id) {
    case 'served':
      return resolveServed(chosen, inputs.withTrucks);
    case 'pt':
      return resolvePt(chosen, inputs.withTrucks);
    case 'rush':
      return resolveRush(chosen, inputs.trucks ? inputs.withTrucks : inputs.withoutTrucks);
    case 'trucks':
      return resolveTrucks(chosen, {
        dispatches: inputs.optimiserDispatches,
        withTrucks: inputs.withTrucks,
        withoutTrucks: inputs.withoutTrucks,
      });
    case 'bikes':
      return resolveBikes(chosen, inputs.bikes);
    case 'double':
      return resolveDouble(chosen, inputs.double);
    default:
      return null;
  }
}

/** Every prediction, in asking order, resolved against the same evidence. */
export function resolveAll(
  answers: Readonly<Record<string, string>>,
  inputs: ResolutionInputs,
): Resolution[] {
  const out: Resolution[] = [];
  for (const entry of PREDICTIONS) {
    const resolved = resolveOne(entry.id, answers[entry.id] ?? null, inputs);
    if (resolved) out.push(resolved);
  }
  return out;
}
