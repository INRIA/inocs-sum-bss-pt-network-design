/**
 * workerEvaluator.ts — the main-thread half of `evaluator.worker.ts`.
 *
 * `PlayApp` constructs ONE of these (plan-technical §C.4: no container, the
 * composition root builds the implementations). It honours the pair port the
 * application layer expects — `evaluateBoth(layout, budgetEur)` — structurally,
 * so nothing here imports from `hooks/` and the dependency rule of §C.2 holds.
 *
 * Everything is total: no `Worker` (SSR, an old browser, a blocked module
 * worker), a failed `init` or a solve past its time budget all end as a
 * REJECTION, which is what makes `useEvaluation` swap in the estimate engine
 * and the UI show its "estimate" tag. Nothing here ever pretends to a result.
 */
import type { Evaluation } from '../domain/evaluation/ports';
import type { EvaluatorRequest, EvaluatorResponse } from './evaluator.worker';

export interface WorkerEvaluatorOptions {
  /** Site base, from `import.meta.env.BASE_URL`: the worker fetches its data under it. */
  readonly baseUrl: string;
  /** Absolute URL of `highs.wasm`. Never guessed — see the worker's header. */
  readonly wasmUrl: string;
  /** The solver's own limit, inside the worker. */
  readonly timeLimitSeconds?: number;
  /** How long the caller waits before falling back. plan.md §C.5 says 8 s. */
  readonly timeoutMs?: number;
  /** Test seam: supply a worker instead of spawning the real one. */
  readonly worker?: Worker;
}

export const DEFAULT_TIMEOUT_MS = 8000;

interface Pending {
  resolve(value: { withTrucks: Evaluation; withoutTrucks: Evaluation | null }): void;
  reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** Spawn the module worker, or null where workers are not available. */
export function spawnEvaluatorWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./evaluator.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
}

export class WorkerEvaluator {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private readonly timeoutMs: number;
  private nextId = 1;
  private ready: Promise<void>;
  private disposed = false;

  constructor(worker: Worker, options: WorkerEvaluatorOptions) {
    this.worker = worker;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let settleReady: (() => void) | null = null;
    let failReady: ((error: Error) => void) | null = null;
    this.ready = new Promise<void>((resolve, reject) => {
      settleReady = resolve;
      failReady = reject;
    });

    this.worker.addEventListener('message', (event: MessageEvent<EvaluatorResponse>) => {
      const message = event.data;
      if (message.type === 'ready') {
        settleReady?.();
        return;
      }
      if (message.type === 'error') {
        const error = new Error(message.message);
        if (message.id == null) {
          failReady?.(error);
          // An init failure is terminal: every queued solve is lost with it.
          for (const [id, entry] of this.pending) {
            clearTimeout(entry.timer);
            entry.reject(error);
            this.pending.delete(id);
          }
          return;
        }
        this.settle(message.id, null, error);
        return;
      }
      this.settle(message.id, {
        withTrucks: message.withTrucks,
        withoutTrucks: message.withoutTrucks,
      });
    });
    this.worker.addEventListener('error', (event: ErrorEvent) => {
      failReady?.(new Error(event.message || 'evaluator worker failed'));
    });

    const init: EvaluatorRequest = {
      type: 'init',
      baseUrl: options.baseUrl,
      wasmUrl: options.wasmUrl,
      timeLimitSeconds: options.timeLimitSeconds,
    };
    this.worker.postMessage(init);
  }

  private settle(
    id: number,
    value: { withTrucks: Evaluation; withoutTrucks: Evaluation | null } | null,
    error?: Error,
  ): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    if (error || !value) entry.reject(error ?? new Error('evaluator worker: empty result'));
    else entry.resolve(value);
  }

  /** Both truck states in one round trip, as `evaluatePair` prefers. */
  evaluateBoth(
    layout: readonly number[],
    budgetEur: number,
  ): Promise<{ withTrucks: Evaluation; withoutTrucks: Evaluation | null }> {
    if (this.disposed) return Promise.reject(new Error('evaluator worker: disposed'));
    const id = this.nextId;
    this.nextId += 1;
    return this.ready.then(
      () =>
        new Promise<{ withTrucks: Evaluation; withoutTrucks: Evaluation | null }>(
          (resolve, reject) => {
            const timer = setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`evaluator worker: no answer in ${this.timeoutMs} ms`));
            }, this.timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            const request: EvaluatorRequest = {
              type: 'evaluate',
              id,
              layout: [...layout],
              budgetEur,
              trucks: [true, false],
            };
            this.worker.postMessage(request);
          },
        ),
    );
  }

  dispose(): void {
    this.disposed = true;
    for (const [, entry] of this.pending) clearTimeout(entry.timer);
    this.pending.clear();
    this.worker.terminate();
  }
}

/**
 * Build the exact evaluator, or null when this environment cannot host it.
 * The caller keeps its estimate fallback either way.
 */
export function createWorkerEvaluator(
  options: WorkerEvaluatorOptions,
): WorkerEvaluator | null {
  const worker = options.worker ?? spawnEvaluatorWorker();
  if (!worker) return null;
  return new WorkerEvaluator(worker, options);
}
