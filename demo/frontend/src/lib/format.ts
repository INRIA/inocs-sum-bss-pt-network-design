import type { Lang } from './types';

const loc = (lang: Lang) => (lang === 'fr' ? 'fr-FR' : 'en-US');

/** Space thousands separator, symbol after — the Swiss/Geneva convention used in the copy. */
export const fmtEur = (n: number): string => `${Math.round(n).toLocaleString('en-US').replace(/,/g, ' ')} €`;

export const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');

export const fmtNum = (lang: Lang, n: number, digits = 1): string =>
  n.toLocaleString(loc(lang), { maximumFractionDigits: digits });

export const fmtPct = (lang: Lang, ratio: number, digits = 1): string =>
  `${(ratio * 100).toLocaleString(loc(lang), { maximumFractionDigits: digits })} %`;

/** Percentage of a ratio already expressed as parts of a whole, e.g. 234 served of 246 potential. */
export const fmtShare = (lang: Lang, a: number, b: number, digits = 0): string =>
  b ? fmtPct(lang, a / b, digits) : '—';

export const hh = (h: number): string => `${String(h).padStart(2, '0')}:00`;

/** Hour label used by the map period control and the period chart: "06h". */
export const hlabel = (h: number): string => `${String(h).padStart(2, '0')}h`;
