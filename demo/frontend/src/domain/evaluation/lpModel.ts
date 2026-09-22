/**
 * lpModel.ts — build the paper's operational LP for one layout.
 *
 * A line-for-line transcription of `evaluate()` in
 * demo/experiments/fixed_design.py, which is the normative reference. Column
 * order, row order and coefficients are identical, so the two solve the same
 * program and the golden vectors under
 * demo/experiments/results/shared/game/golden/ pin them together.
 *
 * With the station set fixed, a path is usable iff every station on its bike
 * legs is open (network-design-bss/src/model/constraints.py:129-152), and what
 * is left is: size the docks, size the fleet, optionally move bikes by truck,
 * and assign the demand.
 *
 * Pure domain: no React, no DOM, no fetch, no node imports.
 */
import type { DemandRow, GameData, GamePath, RideArc } from './types';

/** `[originCell, destCell, period, pathIndex]` — one LP column. */
export type FlowColumn = readonly [number, number, number, number];

/**
 * A solver-agnostic LP: minimise `colCost . x` subject to
 * `rowLower <= A x <= rowUpper` and `colLower <= x <= colUpper`.
 * `A` is column-compressed (CSC), which is what `highs.createModel()` takes.
 */
export interface LpProblem {
  readonly numCols: number;
  readonly numRows: number;
  readonly colCost: Float64Array;
  readonly colLower: Float64Array;
  readonly colUpper: Float64Array;
  readonly rowLower: Float64Array;
  readonly rowUpper: Float64Array;
  /** CSC: `starts[j]..starts[j+1]` indexes into `indices`/`values` for column j. */
  readonly starts: Int32Array;
  readonly indices: Int32Array;
  readonly values: Float64Array;
  /** What each block of columns means, so kpis.ts can read the solution back. */
  readonly layout: LpLayout;
}

export interface LpLayout {
  /** The open stations, sorted. A column's station index is a position in here. */
  readonly stations: readonly number[];
  /** One entry per path-flow column, in column order. */
  readonly columns: readonly FlowColumn[];
  readonly nX: number;
  readonly nR: number;
  /** First dock column. */
  readonly wAt: number;
  /** First initial-fleet column. */
  readonly vAt: number;
  /** Per rebalancing column, the euro cost of one bike moved on it. */
  readonly rebalancingUnitCost: Float64Array;
  readonly periods: number;
  readonly demandTotal: number;
}

export interface BuildOptions {
  readonly layout: readonly number[];
  readonly budgetEur: number | null;
  readonly opsBudgetEur: number | null;
  readonly epsilon: number;
  readonly trucks: boolean;
  /** Defaults to `data.demand`; a golden vector may pass another profile. */
  readonly demand?: readonly DemandRow[];
}

const INF = 1e30;

/** Sparse triplet accumulator; rows are added one at a time, like the Python. */
class Triplets {
  readonly rowIndex: number[] = [];
  readonly colIndex: number[] = [];
  readonly value: number[] = [];
  readonly upper: number[] = [];

  /** Add the row `sum(entries) <= bound`. Zero coefficients are dropped. */
  add(entries: Map<number, number>, bound: number): void {
    const row = this.upper.length;
    for (const [column, coefficient] of entries) {
      if (coefficient === 0) continue;
      this.rowIndex.push(row);
      this.colIndex.push(column);
      this.value.push(coefficient);
    }
    this.upper.push(bound);
  }
}

const bump = (map: Map<number, number>, key: number, by: number): void => {
  map.set(key, (map.get(key) ?? 0) + by);
};

/**
 * Build the LP for one layout.
 *
 * Mirrors fixed_design.py `evaluate()` lines "columns" through "bounds".
 * Returns null when the layout is empty: there is nothing to solve, and
 * kpis.ts produces the documented all-zero evaluation instead.
 */
export function buildLp(data: GameData, options: BuildOptions): LpProblem | null {
  const c = data.constants;
  const demand = options.demand ?? data.demand;
  const periods = data.periods;
  const trucks = options.trucks;
  // trucks off means BOTH: no rebalancing column, and no operating budget.
  const opsBudget = trucks ? options.opsBudgetEur : 0;

  const stations = [...new Set(options.layout)].sort((a, b) => a - b);
  const nStations = stations.length;
  if (nStations === 0) return null;
  const position = new Map<number, number>();
  stations.forEach((station, index) => position.set(station, index));

  // --- columns: one per (OD, period, usable path) ---------------------------
  const columns: FlowColumn[] = [];
  const demandByKey = new Map<string, number>();
  for (const [o, d, t, flow] of demand) {
    if (flow <= 0) continue;
    const key = `${o}:${d}:${t}`;
    demandByKey.set(key, (demandByKey.get(key) ?? 0) + flow);
  }
  const pathsByOd = new Map<string, number[]>();
  for (let index = 0; index < data.paths.length; index += 1) {
    const path = data.paths[index]!;
    const key = `${path.o}:${path.d}`;
    const bucket = pathsByOd.get(key);
    if (bucket) bucket.push(index);
    else pathsByOd.set(key, [index]);
  }
  const usable = (path: GamePath): boolean => {
    for (const leg of path.legs) {
      if (!position.has(leg[0]) || !position.has(leg[1])) return false;
    }
    return true;
  };
  for (const key of demandByKey.keys()) {
    const [o, d, t] = key.split(':').map(Number) as [number, number, number];
    for (const index of pathsByOd.get(`${o}:${d}`) ?? []) {
      if (usable(data.paths[index]!)) columns.push([o, d, t, index]);
    }
  }
  const nX = columns.length;

  // --- rebalancing columns: one per (open arc, period) ----------------------
  const openArcs: RideArc[] = trucks
    ? data.arcs.filter((arc) => position.has(arc.from) && position.has(arc.to))
    : [];
  const nR = openArcs.length * periods;
  const rebalancingUnitCost = new Float64Array(nR);
  // mirrors fixed_design.py: n is substituted as r / CAPACITY_REBALANCING_VEHICLE,
  // so one bike moved costs (dispatch_fixed + unit * km) / vehicle capacity.
  for (let t = 0; t < periods; t += 1) {
    for (let k = 0; k < openArcs.length; k += 1) {
      rebalancingUnitCost[t * openArcs.length + k] =
        (c.dispatch_fixed_cost + c.rebalancing_unit_cost * openArcs[k]!.km) /
        c.CAPACITY_REBALANCING_VEHICLE;
    }
  }

  const wAt = nX + nR;
  const vAt = wAt + nStations;
  const numCols = vAt + nStations;

  // --- per (station, period) incidence -------------------------------------
  const outOf: number[][] = Array.from({ length: nStations * periods }, () => []);
  const into: number[][] = Array.from({ length: nStations * periods }, () => []);
  const slot = (station: number, period: number): number => station * periods + period;
  for (let column = 0; column < nX; column += 1) {
    const [, , t, pathIndex] = columns[column]!;
    for (const [start, end] of data.paths[pathIndex]!.legs) {
      outOf[slot(position.get(start)!, t)]!.push(column);
      into[slot(position.get(end)!, t)]!.push(column);
    }
  }
  for (let t = 0; t < periods; t += 1) {
    for (let k = 0; k < openArcs.length; k += 1) {
      const column = nX + t * openArcs.length + k;
      outOf[slot(position.get(openArcs[k]!.from)!, t)]!.push(column);
      into[slot(position.get(openArcs[k]!.to)!, t)]!.push(column);
    }
  }

  const triplets = new Triplets();

  // (2) demand cap — constraints.py:9-18
  const grouped = new Map<string, number[]>();
  for (let column = 0; column < nX; column += 1) {
    const [o, d, t] = columns[column]!;
    const key = `${o}:${d}:${t}`;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(column);
    else grouped.set(key, [column]);
  }
  for (const [key, group] of grouped) {
    const entries = new Map<number, number>();
    for (const column of group) entries.set(column, 1);
    triplets.add(entries, demandByKey.get(key)!);
  }

  // (6) + (8) + (10): everything about stocks
  for (let i = 0; i < nStations; i += 1) {
    for (let t = 0; t < periods; t += 1) {
      // (10) outflow in t <= v[i,t] — constraints.py:276-281. Bikes that ARRIVE
      // during period t are not borrowable until t+1.
      const stock = new Map<number, number>();
      for (const column of outOf[slot(i, t)]!) bump(stock, column, 1);
      for (let s = 0; s < t; s += 1) {
        for (const column of into[slot(i, s)]!) bump(stock, column, -1);
        for (const column of outOf[slot(i, s)]!) bump(stock, column, 1);
      }
      if (stock.size > 0) {
        bump(stock, vAt + i, -1);
        triplets.add(stock, 0);
      }

      // (8) 0 <= v[i,t+1] <= w[i] — constraints.py:237-244, 270-273
      const net = new Map<number, number>();
      for (let s = 0; s <= t; s += 1) {
        for (const column of into[slot(i, s)]!) bump(net, column, 1);
        for (const column of outOf[slot(i, s)]!) bump(net, column, -1);
      }
      const upper = new Map(net);
      bump(upper, vAt + i, 1);
      bump(upper, wAt + i, -1);
      triplets.add(upper, 0);
      const lower = new Map<number, number>();
      for (const [column, coefficient] of net) lower.set(column, -coefficient);
      bump(lower, vAt + i, -1);
      triplets.add(lower, 0);
    }
    // v[i,0] <= w[i]
    triplets.add(new Map([[vAt + i, 1], [wAt + i, -1]]), 0);
  }

  // (11) capex budget — constraints.py:296-301
  if (options.budgetEur != null) {
    const entries = new Map<number, number>();
    for (let i = 0; i < nStations; i += 1) {
      entries.set(wAt + i, c.dock_cost);
      entries.set(vAt + i, c.unit_bike_cost);
    }
    triplets.add(entries, options.budgetEur - c.station_setup_cost * nStations);
  }

  // operating budget — constraints.py:177-188 and :191-195
  if (nR > 0 && opsBudget != null) {
    const entries = new Map<number, number>();
    for (let k = 0; k < nR; k += 1) entries.set(nX + k, rebalancingUnitCost[k]!);
    triplets.add(entries, opsBudget);
  }

  // --- objective and bounds -------------------------------------------------
  // objective.py:145-178, negated because the solver minimises.
  const colCost = new Float64Array(numCols);
  for (let column = 0; column < nX; column += 1) {
    const path = data.paths[columns[column]![3]]!;
    colCost[column] = -(1 - c.PENALTY_COEFFICIENT * path.rank);
  }
  for (let k = 0; k < nR; k += 1) {
    colCost[nX + k] = options.epsilon * rebalancingUnitCost[k]!;
  }

  const colLower = new Float64Array(numCols);
  const colUpper = new Float64Array(numCols).fill(INF);
  for (let i = 0; i < nStations; i += 1) {
    colLower[wAt + i] = c.MIN_CAPACITY_IF_BUILT;   // constraints.py:285-293
    colUpper[wAt + i] = c.CAPACITY_UB;
    colUpper[vAt + i] = c.CAPACITY_UB;
  }

  const numRows = triplets.upper.length;
  const rowLower = new Float64Array(numRows).fill(-INF);
  const rowUpper = Float64Array.from(triplets.upper);

  return {
    numCols,
    numRows,
    colCost,
    colLower,
    colUpper,
    rowLower,
    rowUpper,
    ...toCsc(triplets, numCols),
    layout: {
      stations,
      columns,
      nX,
      nR,
      wAt,
      vAt,
      rebalancingUnitCost,
      periods,
      demandTotal: demand.reduce((sum, row) => sum + row[3], 0),
    },
  };
}

/** Triplets -> column-compressed storage, with the rows of each column in order. */
function toCsc(
  triplets: Triplets,
  numCols: number,
): { starts: Int32Array; indices: Int32Array; values: Float64Array } {
  const count = triplets.value.length;
  const perColumn = new Int32Array(numCols);
  for (let k = 0; k < count; k += 1) perColumn[triplets.colIndex[k]!] += 1;
  const starts = new Int32Array(numCols + 1);
  for (let j = 0; j < numCols; j += 1) starts[j + 1] = starts[j]! + perColumn[j]!;
  const cursor = Int32Array.from(starts.subarray(0, numCols));
  const indices = new Int32Array(count);
  const values = new Float64Array(count);
  for (let k = 0; k < count; k += 1) {
    const at = cursor[triplets.colIndex[k]!]!;
    indices[at] = triplets.rowIndex[k]!;
    values[at] = triplets.value[k]!;
    cursor[triplets.colIndex[k]!] = at + 1;
  }
  return { starts, indices, values };
}

/**
 * The same program as CPLEX LP text, which `highs.solve(text)` accepts.
 *
 * Kept because it is the documented one-shot entry point of the `highs`
 * package and because it is readable when a discrepancy has to be chased down.
 * `infra/highsEvaluator.ts` does NOT use it: the model has ~10^4 columns and
 * ~10^5 non-zeros, so the text runs to megabytes and the solver spends more
 * time parsing it than solving. It passes the same numbers to
 * `highs.createModel()` as CSC arrays instead. The two are checked against each
 * other in lpModel.test.ts.
 *
 * Column names are `x0..`, so a solution keyed by name maps straight back onto
 * the column indices in `LpLayout`.
 */
export function toCplexLp(problem: LpProblem): string {
  const { numCols, numRows, colCost, colLower, colUpper, rowUpper } = problem;
  const rowsOf: { column: number; value: number }[][] = Array.from(
    { length: numRows },
    () => [],
  );
  for (let column = 0; column < numCols; column += 1) {
    for (let k = problem.starts[column]!; k < problem.starts[column + 1]!; k += 1) {
      rowsOf[problem.indices[k]!]!.push({ column, value: problem.values[k]! });
    }
  }
  const term = (value: number, column: number): string =>
    `${value < 0 ? '-' : '+'} ${Math.abs(value)} x${column}`;

  const out: string[] = ['Minimize', ' obj:'];
  const objective: string[] = [];
  for (let column = 0; column < numCols; column += 1) {
    if (colCost[column] !== 0) objective.push(term(colCost[column]!, column));
  }
  out.push(objective.length ? `  ${objective.join(' ')}` : '  0 x0');
  out.push('Subject To');
  for (let row = 0; row < numRows; row += 1) {
    const entries = rowsOf[row]!;
    if (entries.length === 0) continue;
    out.push(
      ` r${row}: ${entries.map((e) => term(e.value, e.column)).join(' ')} <= ${rowUpper[row]}`,
    );
  }
  out.push('Bounds');
  for (let column = 0; column < numCols; column += 1) {
    const low = colLower[column]!;
    const high = colUpper[column]!;
    if (high >= INF) out.push(` ${low} <= x${column} <= +infinity`);
    else out.push(` ${low} <= x${column} <= ${high}`);
  }
  out.push('End');
  return out.join('\n');
}
