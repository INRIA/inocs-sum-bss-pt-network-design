import { hasKey, type T } from './i18n';
import type { ScenarioData } from './types';

/**
 * Scenario copy resolution: an i18n key wins; a scenario folder that has no `scen.<id>.*` keys yet
 * falls back to the EN text in its own scenarios/<id>.json. That is what makes "add a fourth
 * scenario folder, change no code" true end to end.
 */
export function scenCopy(sc: ScenarioData, t: T, field: string, fallback: string): string {
  const key = `scen.${sc.id}.${field}`;
  return hasKey(key) ? t(key) : fallback;
}

export const scenName = (sc: ScenarioData, t: T): string => scenCopy(sc, t, 'name', sc.fallback.name);

/** A day is a labelled hypothesis when the pipeline says so — never because of its name. */
export const isHypDay = (sc: ScenarioData, day: string): boolean =>
  sc.days[day]?.kpi?.method?.volume_is_hypothesis === true || sc.days[day]?.method?.volume_is_hypothesis === true;

/**
 * The average day — the optimiser's own planning day, i.e. the solved instance's demand replayed
 * through the same simulator. Recognised by the pipeline's `method.mode`, never by the day id.
 */
export const isModelDay = (sc: ScenarioData, day: string): boolean =>
  (sc.days[day]?.kpi?.method?.mode ?? sc.days[day]?.method?.mode) === 'instance';

/** How the day's trip count should be described in copy: observed, modelled or simulated. */
export const dayKind = (sc: ScenarioData, day: string): 'obs' | 'mod' | 'sim' =>
  isHypDay(sc, day) ? 'sim' : isModelDay(sc, day) ? 'mod' : 'obs';
