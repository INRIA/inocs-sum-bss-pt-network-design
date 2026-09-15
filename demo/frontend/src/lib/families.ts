import type { ScenarioData } from './types';

/**
 * Scenario families (demo-v3 implementation.md section 0.1). One parameter varies per family, so
 * every difference in the compare step is attributable to that parameter. The baseline scenario
 * (`family: "baseline"`) belongs to EVERY family and joins each chart at its own axis value.
 *
 * Nothing here knows a scenario id: families, roles and axis values are read from the scenario
 * JSON, which is what makes "add a run, change no code" true end to end.
 */
export type FamilyId = 'budget' | 'ops_ratio' | 'epsilon' | 'rhythm';
export type AxisKey = 'total_budget' | 'op_budget_ratio' | 'epsilon' | 'temporal_profile';

export interface FamilyConfig {
  id: FamilyId;
  axis: AxisKey;
  /** The questions of step 5 this family answers (1-4). */
  questions: number[];
}

export const FAMILIES: Record<FamilyId, FamilyConfig> = {
  budget: { id: 'budget', axis: 'total_budget', questions: [1, 2] },
  ops_ratio: { id: 'ops_ratio', axis: 'op_budget_ratio', questions: [3] },
  epsilon: { id: 'epsilon', axis: 'epsilon', questions: [3] },
  rhythm: { id: 'rhythm', axis: 'temporal_profile', questions: [4] },
};

/** Display order of the families in the all-plans table. */
export const FAMILY_ORDER = ['baseline', 'budget', 'ops_ratio', 'epsilon', 'rhythm'];

/** Card slots of step 3, in the order the cards are shown. */
export const CARD_ORDER = ['essential', 'reference', 'ambitious'];

/** The numeric position of a scenario on its family's axis (rhythm sorts on its evening share). */
export function axisValue(sc: ScenarioData, axis: AxisKey): number {
  switch (axis) {
    case 'total_budget':
      return sc.params.budget;
    case 'op_budget_ratio':
      return sc.params.opsRatio;
    case 'epsilon':
      return sc.params.epsilon;
    case 'temporal_profile':
      return sc.params.periodWeights[sc.params.periodWeights.length - 1] ?? 0;
  }
}

export const baselineOf = (scenarios: ScenarioData[]): ScenarioData | undefined =>
  scenarios.find((s) => s.family === 'baseline');

/**
 * Members of a family, in axis order: everything tagged with that family, plus the baseline (which
 * belongs to all of them). Legacy runs stay in — they carry their own marker style in the charts.
 */
export function membersOf(scenarios: ScenarioData[], family: FamilyId): ScenarioData[] {
  const axis = FAMILIES[family].axis;
  const base = baselineOf(scenarios);
  const list = scenarios.filter((s) => s.family === family);
  if (base && !list.includes(base)) list.push(base);
  return list.sort((a, b) => axisValue(a, axis) - axisValue(b, axis) || a.id.localeCompare(b.id));
}

export const solved = (list: ScenarioData[]): ScenarioData[] => list.filter((s) => s.hasResults && s.paper);
export const pending = (list: ScenarioData[]): ScenarioData[] => list.filter((s) => !s.hasResults);

/**
 * The three plans of step 3, one per card slot. A slot prefers the paper-grid run over the legacy
 * one, and a scenario with results over one still to run — so the site keeps working through the
 * transition without naming a single scenario id.
 */
export function cardsOf(scenarios: ScenarioData[]): ScenarioData[] {
  const out: ScenarioData[] = [];
  for (const slot of CARD_ORDER) {
    const pool = scenarios.filter((s) => s.role === 'card' && s.card === slot);
    const rank = (s: ScenarioData) => (s.hasResults ? 0 : 2) + (s.legacy ? 1 : 0);
    const pick = pool.sort((a, b) => rank(a) - rank(b))[0];
    if (pick) out.push(pick);
  }
  return out;
}

/** The plan the copy compares everything against: the reference card, else the baseline. */
export function referenceOf(scenarios: ScenarioData[]): ScenarioData | undefined {
  const base = baselineOf(scenarios);
  if (base?.hasResults) return base;
  return cardsOf(scenarios).find((s) => s.card === 'reference' && s.hasResults) ?? base;
}
