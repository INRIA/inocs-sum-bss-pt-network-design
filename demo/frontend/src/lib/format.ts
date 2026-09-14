import type { Lang } from './types';

/** Space thousands separator, symbol after — the Swiss/Geneva convention used in the copy. */
export const fmtEur = (n: number): string => `${Math.round(n).toLocaleString('en-US').replace(/,/g, ' ')} €`;

/** Negative money, rendered with a real minus sign: "−559 €". */
export const fmtEurSigned = (n: number): string => (n < 0 ? `−${fmtEur(-n)}` : fmtEur(n));

export const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');

export const fmtNum = (lang: Lang, n: number, digits = 1): string =>
  n.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: digits });

export const fmtPct = (lang: Lang, ratio: number, digits = 1): string =>
  `${(ratio * 100).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: digits })}%`;

export const hh = (h: number): string => `${String(h).padStart(2, '0')}:00`;
