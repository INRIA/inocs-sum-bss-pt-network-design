/**
 * reveal.ts — what the model answers, in words, for one prediction.
 *
 * The domain resolves a prediction into `{ chosen, actual, matched, facts }`
 * and deliberately returns NO prose (domain/game/README). This is where the
 * facts become a sentence: one i18n key per prediction, the numbers formatted
 * once, and nothing invented — every placeholder of every template is filled
 * from `facts`, which `reveal.test.ts` pins against the committed data.
 *
 * `matched` picks the TONE and never a score: there is no count, no "correct",
 * no points anywhere in this file or in the copy it names (plan.md §2, UX
 * reference §5 — the game has no win or lose).
 */
import type { Resolution } from '../../domain/game/predictions';
import { fmtEur, fmtInt, fmtNum, fmtPct } from '../../lib/format';
import type { Vars } from '../../lib/i18n';
import type { Lang } from '../../lib/types';

export interface Reveal {
  /** `play.reveal.<id>` (or a variant of it when the numbers call for one). */
  readonly key: string;
  readonly vars: Vars;
  /** `play.tone.close` or `play.tone.other` — a nudge, never a verdict. */
  readonly toneKey: string;
  /** A second line that must travel with the sentence, e.g. a caveat. */
  readonly noteKey: string | null;
}

const pct = (lang: Lang, value: number, digits = 0): string => fmtPct(lang, value, digits);

/**
 * Build the reveal of one resolution.
 *
 * Every branch here is a branch of the NUMBERS, never of the visitor's answer:
 * the trucks reveal changes when the optimiser sends none, not when the visitor
 * guessed "none".
 */
export function revealOf(resolution: Resolution, lang: Lang): Reveal {
  const facts = resolution.facts;
  const number = (key: string): number => {
    const value = facts[key];
    return typeof value === 'number' ? value : 0;
  };
  const tone = (matched: boolean): string => (matched ? 'play.tone.close' : 'play.tone.other');
  const toneKey = tone(resolution.matched);

  switch (resolution.predictionId) {
    case 'served':
      return {
        key: 'play.reveal.served',
        vars: {
          served: fmtInt(number('served')),
          demand: fmtInt(number('demand')),
          ratio: pct(lang, number('ratio')),
        },
        toneKey,
        noteKey: 'play.reveal.served.note',
      };

    case 'pt':
      return {
        key: 'play.reveal.pt',
        vars: {
          trips: fmtInt(number('trips')),
          served: fmtInt(number('served')),
          share: pct(lang, number('share')),
        },
        toneKey,
        noteKey: null,
      };

    case 'rush': {
      const gap = number('gapPoints');
      return {
        key: gap < 3 ? 'play.reveal.rush.flat' : 'play.reveal.rush',
        vars: {
          midday: pct(lang, number('middayRate')),
          peak: pct(lang, number('peakRate')),
          morning: pct(lang, number('morningRate')),
          evening: pct(lang, number('eveningRate')),
          gap: fmtNum(lang, Math.abs(gap), 1),
        },
        toneKey,
        noteKey: null,
      };
    }

    case 'trucks': {
      const runs = number('dispatches');
      return {
        key: runs <= 0 ? 'play.reveal.trucks.none' : 'play.reveal.trucks',
        vars: {
          runs: fmtInt(runs),
          depend: fmtInt(number('dependOnTrucks')),
          withTrucks: fmtInt(number('servedWithTrucks')),
          withoutTrucks: fmtInt(number('servedWithoutTrucks')),
        },
        toneKey,
        noteKey: 'play.reveal.trucks.note',
      };
    }

    case 'rhythm':
      return {
        key: resolution.actual === 'same' ? 'play.reveal.rhythm.same' : 'play.reveal.rhythm.move',
        vars: {
          shared: fmtInt(number('shared')),
          sharpTotal: fmtInt(number('sharpTotal')),
          referenceTotal: fmtInt(number('referenceTotal')),
          overlap: pct(lang, number('overlap')),
        },
        toneKey,
        noteKey: 'play.reveal.rhythm.note',
      };

    case 'double':
    default:
      return {
        key: 'play.reveal.double',
        vars: {
          low: fmtEur(number('lowBudgetEur')),
          high: fmtEur(number('highBudgetEur')),
          lowServed: fmtInt(number('lowServed')),
          highServed: fmtInt(number('highServed')),
          extraTrips: fmtInt(number('extraTrips')),
          extraPercent: fmtNum(lang, number('extraPercent'), 0),
        },
        toneKey,
        noteKey: 'play.reveal.double.note',
      };
  }
}
