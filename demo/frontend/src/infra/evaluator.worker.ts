/// <reference lib="webworker" />
/**
 * evaluator.worker.ts — the solver, off the main thread.
 *
 * `model.run()` blocks the thread it is on, and a solve runs 15 ms to ~400 ms
 * in node (assume 2-4x that on a phone), so it must not run on the UI thread.
 * The worker is started when the visitor leaves the Build step and solves BOTH
 * states — with trucks and without — while they answer the prediction polls, so
 * the Run step never waits.
 *
 * The wasm URL is sent IN from the main thread (`init`). The worker cannot
 * derive the GitHub Pages base path on its own, and a wrong guess fails at
 * load time with a 404 that is hard to read.
 *
 * Started with:
 *   new Worker(new URL('../infra/evaluator.worker.ts', import.meta.url),
 *              { type: 'module' })
 */
import { loadGameData, type GameFile } from './gameData';
import { HighsEvaluator } from './highsEvaluator';
import type { Evaluation } from '../domain/evaluation/ports';
import type { GameData } from '../domain/evaluation/types';

/** Main thread -> worker. */
export type EvaluatorRequest =
  | {
      readonly type: 'init';
      /** Site base URL, from `import.meta.env.BASE_URL`. */
      readonly baseUrl: string;
      /** Where `highs.wasm` is served from, resolved by the bundler. */
      readonly wasmUrl: string;
      /** Solve budget in seconds; the caller falls back to an estimate beyond it. */
      readonly timeLimitSeconds?: number;
    }
  | {
      readonly type: 'evaluate';
      readonly id: number;
      readonly layout: readonly number[];
      readonly budgetEur: number;
      /** Both states are solved and returned together. */
      readonly trucks?: readonly boolean[];
    };

/** Worker -> main thread. */
export type EvaluatorResponse =
  | { readonly type: 'ready' }
  | {
      readonly type: 'result';
      readonly id: number;
      readonly withTrucks: Evaluation;
      readonly withoutTrucks: Evaluation | null;
    }
  | { readonly type: 'error'; readonly id: number | null; readonly message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

let data: GameData | null = null;
let evaluator: HighsEvaluator | null = null;

const post = (message: EvaluatorResponse): void => {
  scope.postMessage(message);
};

async function handleInit(request: Extract<EvaluatorRequest, { type: 'init' }>): Promise<void> {
  const base = request.baseUrl.endsWith('/') ? request.baseUrl : `${request.baseUrl}/`;
  data = await loadGameData(async (name: GameFile) => {
    const response = await fetch(`${base}data/game/${name}.json`);
    if (!response.ok) throw new Error(`${name}.json responded ${response.status}`);
    return response.json();
  });
  evaluator = new HighsEvaluator(data, {
    wasmUrl: request.wasmUrl,
    timeLimitSeconds: request.timeLimitSeconds,
  });
  // Pull the solver in now, while the visitor is still reading, so the first
  // real solve is not also a 1.2 MB download.
  await evaluator.warmUp();
  post({ type: 'ready' });
}

async function handleEvaluate(
  request: Extract<EvaluatorRequest, { type: 'evaluate' }>,
): Promise<void> {
  if (!evaluator) throw new Error('evaluator.worker: evaluate before init');
  const states = request.trucks ?? [true, false];
  const withTrucks = await evaluator.evaluate(request.layout, request.budgetEur, {
    trucks: true,
  });
  const withoutTrucks = states.includes(false)
    ? await evaluator.evaluate(request.layout, request.budgetEur, { trucks: false })
    : null;
  post({ type: 'result', id: request.id, withTrucks, withoutTrucks });
}

scope.addEventListener('message', (event: MessageEvent<EvaluatorRequest>) => {
  const request = event.data;
  const id = request.type === 'evaluate' ? request.id : null;
  const work = request.type === 'init' ? handleInit(request) : handleEvaluate(request);
  work.catch((error: unknown) => {
    // Never leave the caller hanging: it has an 8 s timeout and a fallback,
    // but an explicit error lets it switch immediately.
    post({
      type: 'error',
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  });
});

export {};
