import { dash, fmtInt, fmtNum, fmtPct } from './format';
import type { Lang, ScenarioData } from './types';

/**
 * The technical-metrics catalogue of the advanced view (plan.md section 6b).
 *
 * Every row is a field the FROZEN package computes itself
 * (`src/output_handler/metrics_evaluator.py` -> `BSSMetrics`, flattened by `experiment.py` into
 * the `ExperimentRow`), plus the solver statistics the runner records. Nothing is recomputed in the
 * front end: the key is looked up in `kpis.json -> technical` and rendered, and a key the run did
 * not produce renders as "—" (legacy runs lack several).
 */
export type TechFormat = 'int' | 'f2' | 'f3' | 'pct1' | 'pct2' | 'raw';

export interface TechRow {
  /** key in kpis.json -> technical */
  key: string;
  /** older rows carry a different name for the same quantity */
  alias?: string;
  fmt: TechFormat;
}

export interface TechGroup {
  /** i18n suffix: `tech.g.<id>` = title, `tech.ref.<id>` = the paper section that discusses it */
  id: string;
  rows: TechRow[];
}

export const TECH: TechGroup[] = [
  {
    id: 'size',
    rows: [
      { key: 'network_nodes', fmt: 'int' },
      { key: 'network_edges', fmt: 'int' },
      { key: 'n_candidates', fmt: 'int' },
      { key: 'od_num', fmt: 'int' },
      { key: 'total_demand', fmt: 'int' },
      { key: 'period', fmt: 'int' },
      { key: 'n_variables', fmt: 'int' },
      { key: 'n_constraints', fmt: 'int' },
    ],
  },
  {
    id: 'solver',
    rows: [
      { key: 'status', alias: 'gurobi_status', fmt: 'raw' },
      { key: 'obj_val', fmt: 'f3' },
      { key: 'obj_bound', fmt: 'f3' },
      { key: 'mip_gap', fmt: 'pct2' },
      { key: 'runtime', fmt: 'f2' },
      { key: 'wall_clock_s', fmt: 'f2' },
      { key: 'epsilon', fmt: 'raw' },
      { key: 'ran_at', fmt: 'raw' },
    ],
  },
  {
    id: 'flow',
    rows: [
      { key: 'flow_total', fmt: 'int' },
      { key: 'flow_bike_only', fmt: 'int' },
      { key: 'flow_bike_pt', fmt: 'int' },
      { key: 'covered_od_ratio', fmt: 'pct1' },
      { key: 'supported_flow_per_investment', fmt: 'f3' },
    ],
  },
  {
    id: 'time',
    rows: [
      { key: 'avg_travel_time', fmt: 'f2' },
      { key: 'total_time_gain', fmt: 'int' },
      { key: 'average_time_gain', fmt: 'f2' },
    ],
  },
  {
    id: 'layout',
    rows: [
      { key: 'n_reg_station', fmt: 'int' },
      { key: 'n_trans_station', fmt: 'int' },
      { key: 'nearest_neighbor_distance', fmt: 'int' },
      { key: 'mean_pairwise_distance', fmt: 'int' },
    ],
  },
  {
    id: 'capacity',
    rows: [
      { key: 'avg_capacity_reg', fmt: 'f2' },
      { key: 'avg_capacity_trans', fmt: 'f2' },
      { key: 'fill_ratio_reg', fmt: 'pct1' },
      { key: 'fill_ratio_trans', fmt: 'pct1' },
      { key: 'brw_reg', fmt: 'pct1' },
      { key: 'ret_reg', fmt: 'pct1' },
      { key: 'brw_trans', fmt: 'pct1' },
      { key: 'ret_trans', fmt: 'pct1' },
    ],
  },
  {
    id: 'reb',
    rows: [
      { key: 'reb_budget', fmt: 'int' },
      { key: 'dispatch_count', fmt: 'int' },
      { key: 'reb_volume', fmt: 'int' },
      { key: 'dispatch_cost', fmt: 'f2' },
      { key: 'avg_bikes_per_dispatch', fmt: 'f2' },
      { key: 'avg_dispatch_distance', fmt: 'f3' },
    ],
  },
];

const rawValue = (sc: ScenarioData, row: TechRow): number | string | null => {
  const direct = sc.technical[row.key];
  if (direct != null) return direct;
  return row.alias ? sc.technical[row.alias] ?? null : null;
};

/** One table cell: the value as the model wrote it, formatted — or "—" when the run lacks the key. */
export function techCell(sc: ScenarioData, row: TechRow, lang: Lang): string {
  const v = rawValue(sc, row);
  if (v == null || v === '') return dash;
  if (row.fmt === 'raw') return String(v);
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  switch (row.fmt) {
    case 'int':
      return fmtInt(n);
    case 'f2':
      return fmtNum(lang, n, 2);
    case 'f3':
      return fmtNum(lang, n, 3);
    case 'pct1':
      return fmtPct(lang, n, 1);
    case 'pct2':
      return fmtPct(lang, n, 2);
  }
}
