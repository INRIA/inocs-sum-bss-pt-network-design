/**
 * highsEvaluator.ts — the exact evaluator: HiGHS (WebAssembly) on the LP that
 * domain/evaluation/lpModel.ts builds.
 *
 * `highs` is loaded LAZILY (about 1.2 MB gzipped), so nothing is downloaded
 * until the visitor's layout is frozen. In the browser this runs inside
 * `evaluator.worker.ts`, because `model.run()` blocks its thread; in node
 * (vitest) it is used directly, which is what pins the TypeScript engine
 * against the Python golden vectors.
 *
 * The wasm URL is passed IN, never guessed: under the GitHub Pages project path
 * a relative guess resolves to the wrong place. In node, omitting it lets the
 * loader find `highs.wasm` beside its own module, which is correct there.
 */
import { buildLp, type LpProblem } from '../domain/evaluation/lpModel';
import { emptyEvaluation, readEvaluation } from '../domain/evaluation/kpis';
import type {
  EvaluateOptions,
  Evaluation,
  Evaluator,
} from '../domain/evaluation/ports';
import type { DemandRow, GameData } from '../domain/evaluation/types';

/** The slice of the `highs` module this file uses. Kept narrow on purpose. */
export interface HighsLike {
  readonly infinity: number;
  withModel<T>(source: unknown, use: (model: HighsModelLike) => T): T;
  /**
   * The package's one-shot CPLEX LP-text entry point. The engine does not use
   * it (see `toCplexLp`), but lpModel.test.ts solves a small model both ways to
   * prove the two encodings agree.
   */
  solve(problem: string, options?: Record<string, unknown>): {
    Status: string;
    ObjectiveValue: number;
  };
}

export interface HighsModelLike {
  options: { set(values: Record<string, unknown>): unknown };
  run(): unknown;
  getModelStatus(): number;
  getSolution(): { colValue: Float64Array };
}

export interface HighsEvaluatorOptions {
  /** Where `highs.wasm` is served from. Omit in node. */
  readonly wasmUrl?: string;
  /** Solve budget. A slower device should get an estimate, not a frozen tab. */
  readonly timeLimitSeconds?: number;
  /** Test seam: supply a loader instead of importing `highs`. */
  readonly load?: () => Promise<HighsLike>;
}

/** HiGHS `kOptimal`. Anything else means the LP did not solve to optimality. */
const MODEL_STATUS_OPTIMAL = 7;

/**
 * Load `highs` once and keep it. The import is dynamic so the bundle splits and
 * the 1.2 MB payload is fetched only when a solve is actually asked for.
 */
export function createHighsLoader(options: HighsEvaluatorOptions = {}): () => Promise<HighsLike> {
  let pending: Promise<HighsLike> | null = null;
  return () => {
    if (options.load) return options.load();
    if (!pending) {
      pending = import('highs').then((module) => {
        const loader = (module.default ?? module) as unknown as (
          init?: Record<string, unknown>,
        ) => Promise<HighsLike>;
        const init = options.wasmUrl
          ? { locateFile: (file: string) => (file.endsWith('.wasm') ? options.wasmUrl! : file) }
          : undefined;
        return loader(init);
      });
    }
    return pending;
  };
}

export interface SolveResult {
  readonly optimal: boolean;
  readonly colValue: Float64Array;
  readonly solveMs: number;
}

/** Hand one LP to HiGHS. `withModel` disposes the native model for us. */
export function solveWith(highs: HighsLike, problem: LpProblem, timeLimitSeconds?: number): SolveResult {
  const infinity = highs.infinity;
  const clamp = (source: Float64Array): Float64Array => {
    const out = new Float64Array(source.length);
    for (let i = 0; i < source.length; i += 1) {
      const value = source[i]!;
      out[i] = value >= 1e30 ? infinity : value <= -1e30 ? -infinity : value;
    }
    return out;
  };

  const started = Date.now();
  return highs.withModel(
    {
      numCols: problem.numCols,
      numRows: problem.numRows,
      colCost: problem.colCost,
      colLower: clamp(problem.colLower),
      colUpper: clamp(problem.colUpper),
      rowLower: clamp(problem.rowLower),
      rowUpper: clamp(problem.rowUpper),
      matrix: {
        format: 'csc',
        numCols: problem.numCols,
        numRows: problem.numRows,
        starts: problem.starts,
        indices: problem.indices,
        values: problem.values,
      },
    },
    (model) => {
      const settings: Record<string, unknown> = { output_flag: false, presolve: 'on' };
      if (timeLimitSeconds != null) settings.time_limit = timeLimitSeconds;
      model.options.set(settings);
      model.run();
      const optimal = model.getModelStatus() === MODEL_STATUS_OPTIMAL;
      return {
        optimal,
        colValue: optimal ? model.getSolution().colValue : new Float64Array(problem.numCols),
        solveMs: Date.now() - started,
      };
    },
  );
}

/**
 * The exact `Evaluator`. Never throws for a layout the budget cannot pay for:
 * that resolves to `feasible: false`, which is an answer the game shows.
 */
export class HighsEvaluator implements Evaluator {
  private readonly load: () => Promise<HighsLike>;

  constructor(
    private readonly data: GameData,
    private readonly options: HighsEvaluatorOptions = {},
    private readonly demand?: readonly DemandRow[],
  ) {
    this.load = createHighsLoader(options);
  }

  /** Pre-fetch the solver while the visitor is doing something else. */
  async warmUp(): Promise<void> {
    await this.load();
  }

  async evaluate(
    layout: readonly number[],
    budgetEur: number,
    opts: EvaluateOptions,
  ): Promise<Evaluation> {
    const budget = this.data.budgets.find((entry) => entry.capexEur === budgetEur);
    const problem = buildLp(this.data, {
      layout,
      budgetEur,
      opsBudgetEur: budget ? budget.opsBudgetEur : null,
      epsilon: budget ? budget.epsilon : this.data.constants.EPSILON,
      trucks: opts.trucks,
      demand: this.demand,
    });
    if (!problem) {
      // No station placed: a legitimate answer, not an error.
      return emptyEvaluation(this.data, { layout, demand: this.demand, feasible: true });
    }
    const highs = await this.load();
    const solved = solveWith(highs, problem, this.options.timeLimitSeconds);
    if (!solved.optimal) {
      // The capex cannot pay MIN_CAPACITY_IF_BUILT docks for the stations
      // placed. Documented in fixed_design.py's DegenerateLayoutTests.
      return emptyEvaluation(this.data, {
        layout,
        demand: this.demand,
        feasible: false,
        solveMs: solved.solveMs,
      });
    }
    return readEvaluation(this.data, problem, solved.colValue, {
      layout,
      demand: this.demand,
      quality: 'exact',
      solveMs: solved.solveMs,
    });
  }
}

/**
 * Where `highs.wasm` comes from, and why nothing sets it in the browser.
 *
 * The `highs` glue asks for its binary through `new URL('highs.wasm', …)`,
 * which the bundler rewrites at build time to its OWN emitted asset, already
 * prefixed with the site base (`/<base>/assets/highs-<hash>.wasm`) and already
 * cache-busted by that hash. So the browser passes no `wasmUrl` at all: the
 * default resolution is correct, and the site ships ONE copy of the 3.5 MB
 * binary instead of two (a bundled one nothing loaded, and a hand-copied
 * public one that `locateFile` pointed at).
 *
 * `wasmUrl` remains an option for callers with no bundler — node, and the
 * tests, which hand it the path inside `node_modules/highs/`.
 */

/**
 * The main-thread side of `evaluator.worker.ts`.
 *
 * Solves both truck states in one round trip, and REJECTS after
 * `timeoutMs` so the caller can fall back to `EstimateEvaluator` instead of
 * leaving the visitor in front of a spinner. A timed-out worker is terminated:
 * the wasm solve cannot be interrupted from outside, so the thread is dropped.
 */
export interface WorkerEvaluationPair {
  readonly withTrucks: Evaluation;
  readonly withoutTrucks: Evaluation | null;
}

export interface WorkerEvaluatorOptions {
  readonly baseUrl: string;
  readonly wasmUrl: string;
  /** Plan-technical §C.5: beyond this, show the estimate. */
  readonly timeoutMs?: number;
  /** Test seam: supply a worker instead of constructing one. */
  readonly createWorker?: () => Worker;
}

interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  addEventListener(type: 'message' | 'error', listener: (event: never) => void): void;
}

export const WORKER_TIMEOUT_MS = 8000;

export class WorkerEvaluator {
  private worker: WorkerLike | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;

  constructor(private readonly options: WorkerEvaluatorOptions) {}

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const worker = (this.options.createWorker?.() ??
      new Worker(new URL('./evaluator.worker.ts', import.meta.url), {
        type: 'module',
      })) as unknown as WorkerLike;
    this.worker = worker;
    this.ready = new Promise<void>((resolve, reject) => {
      const onMessage = (event: MessageEvent<{ type: string; message?: string }>): void => {
        if (event.data.type === 'ready') resolve();
        else if (event.data.type === 'error') reject(new Error(event.data.message ?? 'worker error'));
      };
      worker.addEventListener('message', onMessage as never);
      worker.addEventListener('error', ((event: ErrorEvent) =>
        reject(new Error(event.message || 'worker failed to start'))) as never);
      worker.postMessage({
        type: 'init',
        baseUrl: this.options.baseUrl,
        wasmUrl: this.options.wasmUrl,
        timeLimitSeconds: (this.options.timeoutMs ?? WORKER_TIMEOUT_MS) / 1000,
      });
    });
    return this.ready;
  }

  /** Solve both truck states for one layout. Rejects on timeout or worker error. */
  async evaluateBoth(
    layout: readonly number[],
    budgetEur: number,
  ): Promise<WorkerEvaluationPair> {
    await this.start();
    const worker = this.worker!;
    const id = this.nextId;
    this.nextId += 1;
    const timeoutMs = this.options.timeoutMs ?? WORKER_TIMEOUT_MS;
    return new Promise<WorkerEvaluationPair>((resolve, reject) => {
      const timer = setTimeout(() => {
        // The wasm solve cannot be cancelled; drop the thread and fall back.
        this.dispose();
        reject(new Error(`solver timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      const onMessage = (
        event: MessageEvent<{
          type: string;
          id?: number;
          message?: string;
          withTrucks?: Evaluation;
          withoutTrucks?: Evaluation | null;
        }>,
      ): void => {
        const message = event.data;
        if (message.id !== id) return;
        clearTimeout(timer);
        if (message.type === 'error') reject(new Error(message.message ?? 'solver failed'));
        else {
          resolve({
            withTrucks: message.withTrucks!,
            withoutTrucks: message.withoutTrucks ?? null,
          });
        }
      };
      worker.addEventListener('message', onMessage as never);
      worker.postMessage({ type: 'evaluate', id, layout, budgetEur });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}
