/**
 * ticket.ts — the recap replayed in step 6.
 *
 * The predictions were stamped when they were made (plan.md §2, "permanence"),
 * so the ticket is the whole session in one object: the budget, who placed
 * which stations, every prediction next to what the model answered, and the
 * three marks of the served line.
 *
 * The three marks are the only comparison the game makes, and it is not a
 * score: "a planner placing at random · you · the optimiser", all three
 * measured by the SAME engine at the same budget (plan.md §2bis item 3).
 *
 * Pure domain: no React, no DOM, no fetch, no node imports.
 */
import type { BudgetReference } from '../evaluation/types';
import { resolveAll, type Resolution, type ResolutionInputs } from './predictions';
import {
  BUDGET_EUR,
  BUDGET_SCENARIO,
  currentEvaluation,
  placedBy,
  type BudgetId,
  type Session,
} from './session';

export type MarkKey = 'random' | 'you' | 'optimiser';

export interface TicketMark {
  readonly key: MarkKey;
  /** `play.mark.<key>` */
  readonly labelKey: string;
  readonly served: number;
  readonly ratio: number;
}

export interface TicketStations {
  readonly total: number;
  readonly byMe: number;
  readonly byAssistant: number;
  readonly atPtStops: number | null;
}

export interface Ticket {
  readonly budgetId: BudgetId;
  readonly budgetEur: number;
  /** The committed run this budget borrows its envelopes from. */
  readonly scenario: string;
  /** Which solve the marks are read on: the results switch. */
  readonly trucks: boolean;
  readonly stations: TicketStations;
  readonly predictions: readonly Resolution[];
  readonly marks: readonly TicketMark[];
}

export interface TicketInputs {
  readonly reference: BudgetReference;
  /** Everything the six resolvers need; the same object step 4 and 5 use. */
  readonly resolution: ResolutionInputs;
}

/**
 * The three marks of the served line, trucks-aware.
 *
 * The random planner's median is the with-trucks figure at every switch
 * position: `references.json` records one median per budget, drawn at the
 * optimiser's own station count. It is a reference mark, not a second design
 * the visitor can operate differently, so it does not move with the switch.
 */
export function marksFor(
  reference: BudgetReference,
  visitorServed: number,
  demandTotal: number,
  trucks: boolean,
): TicketMark[] {
  const ratio = (served: number): number => (demandTotal > 0 ? served / demandTotal : 0);
  const mark = (key: MarkKey, served: number): TicketMark => ({
    key,
    labelKey: `play.mark.${key}`,
    served,
    ratio: ratio(served),
  });
  const optimiser = trucks ? reference.optimiserServed : reference.optimiserServedNoTrucks;
  return [
    mark('random', reference.randomServedMedian),
    mark('you', visitorServed),
    mark('optimiser', optimiser),
  ];
}

/**
 * Build the ticket. Returns null before there is anything to replay: no budget,
 * or no evaluation yet — step 6 is guarded on both (steps.ts), so this is a
 * belt-and-braces null, not a state the screens are expected to render.
 */
export function buildTicket(session: Session, inputs: TicketInputs): Ticket | null {
  if (!session.budgetId) return null;
  const evaluation = currentEvaluation(session);
  if (!evaluation) return null;
  return {
    budgetId: session.budgetId,
    budgetEur: BUDGET_EUR[session.budgetId],
    scenario: BUDGET_SCENARIO[session.budgetId],
    trucks: session.trucks,
    stations: {
      total: session.placed.length,
      byMe: placedBy(session, 'me'),
      byAssistant: placedBy(session, 'assistant'),
      atPtStops: evaluation.nTransfer,
    },
    predictions: resolveAll(session.predictions, inputs.resolution),
    marks: marksFor(
      inputs.reference,
      evaluation.served,
      evaluation.demandTotal,
      session.trucks,
    ),
  };
}
