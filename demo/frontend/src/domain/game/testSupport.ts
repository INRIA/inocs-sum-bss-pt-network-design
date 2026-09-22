/**
 * testSupport.ts — fixtures shared by the game unit tests.
 *
 * Kept out of the `*.test.ts` files so the same fake evaluation is used by the
 * reducer, the resolvers and the view-model tests. It is pure data: no node
 * imports, so it stays harmless if a screen ever imports it by accident.
 */
import type { EvaluationSummary } from './session';

export interface FakeEvaluationOptions {
  readonly served?: number;
  readonly demandTotal?: number;
  readonly ptShare?: number;
  readonly servedByPeriod?: readonly number[];
  readonly demandByPeriod?: readonly number[];
  readonly quality?: 'exact' | 'estimate';
}

/** An evaluation summary with plausible defaults; override what a test needs. */
export function fakeEvaluation(options: FakeEvaluationOptions = {}): EvaluationSummary {
  const demandByPeriod = options.demandByPeriod ?? [588, 269, 596];
  const demandTotal =
    options.demandTotal ?? demandByPeriod.reduce((sum, value) => sum + value, 0);
  const servedByPeriod = options.servedByPeriod ?? [400, 200, 400];
  const served = options.served ?? servedByPeriod.reduce((sum, value) => sum + value, 0);
  const ptShare = options.ptShare ?? 0.3;
  return {
    quality: options.quality ?? 'exact',
    feasible: true,
    served,
    servedRatio: demandTotal > 0 ? served / demandTotal : 0,
    demandTotal,
    demandByPeriod: [...demandByPeriod],
    servedByPeriod: [...servedByPeriod],
    bikeOnlyByPeriod: servedByPeriod.map((value) => value * (1 - ptShare)),
    bikePtByPeriod: servedByPeriod.map((value) => value * ptShare),
    ptShare,
    docks: 700,
    bikes: 500,
    capexEur: 60000,
    nStations: 60,
    nTransfer: 20,
    losses: { noStation: 200, noStock: 100, unreachable: 60 },
  };
}
