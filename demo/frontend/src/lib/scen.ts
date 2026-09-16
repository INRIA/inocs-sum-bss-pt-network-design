import { hasKey, type T } from './i18n';
import type { ScenarioData } from './types';

/**
 * Scenario copy resolution: an i18n key wins; a scenario file that has no `scen.<id>.*` keys yet
 * falls back to the EN text in its own scenarios/<id>.json. That is what makes "add a scenario
 * file, change no code" true end to end.
 */
export function scenCopy(sc: ScenarioData, t: T, field: string, fallback: string): string {
  const key = `scen.${sc.id}.${field}`;
  return hasKey(key) ? t(key) : fallback;
}

export const scenName = (sc: ScenarioData, t: T): string => scenCopy(sc, t, 'name', sc.fallback.name);

export const scenPitch = (sc: ScenarioData, t: T): string => scenCopy(sc, t, 'pitch', sc.fallback.pitch);

export const scenNarrative = (sc: ScenarioData, t: T): string => scenCopy(sc, t, 'narrative', sc.fallback.narrative);

/**
 * The tag badge of a card: the paper's own baseline says so, anything else uses its authored tag
 * and falls back to the generic label of its card slot.
 */
export function scenTag(sc: ScenarioData, t: T): string {
  if (sc.family === 'baseline') return t('s3.tag.baseline');
  return scenCopy(sc, t, 'tag', sc.card ? t(`s3.tag.${sc.card}`) : sc.axisLabel);
}
