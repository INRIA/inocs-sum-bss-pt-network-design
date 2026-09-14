import en from '../i18n/en.json';
import fr from '../i18n/fr.json';
import type { Lang } from './types';

const DICTS: Record<Lang, Record<string, string>> = { en: en as any, fr: fr as any };

export type Vars = Record<string, string | number>;

/**
 * t(key, vars) — the single copy accessor (ux-plan section 8).
 *  - looks the key up in the active language;
 *  - falls back to English when the French value is missing or empty (never an empty string);
 *  - renders the raw key if neither has it, so a missing key is visible in development.
 */
export function translate(lang: Lang, key: string, vars?: Vars): string {
  const active = DICTS[lang] ?? DICTS.en;
  let s = active[key];
  if (!s) s = DICTS.en[key];
  if (!s) return key;
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

export function makeT(lang: Lang) {
  return (key: string, vars?: Vars) => translate(lang, key, vars);
}

/** True when the key exists in either dictionary — used to fall back to scenario JSON copy. */
export function hasKey(key: string): boolean {
  return Boolean(DICTS.en[key] || DICTS.fr[key]);
}

export type T = ReturnType<typeof makeT>;
