import { cardsOf, FAMILY_ORDER, membersOf, pending, referenceOf, type FamilyId } from './families';
import { fmtEur, fmtInt, fmtNum, fmtPct } from './format';
import { hasKey, type T } from './i18n';
import { scenName } from './scen';
import type { GameData, Lang, ScenarioData } from './types';

/**
 * How a scenario is named on ITS FAMILY'S axis. The baseline belongs to every family, so it has to
 * be labelled with its value on the axis being drawn ("5 %" in the operations family, "ε = 0.04" in
 * the penalty family) rather than with its own budget label.
 */
export function axisTick(sc: ScenarioData, family: FamilyId, lang: Lang, t: T): string {
  switch (family) {
    case 'ops_ratio':
      return `${fmtNum(lang, sc.params.opsRatio * 100, 2)} %`;
    case 'epsilon':
      return `ε = ${sc.params.epsilon}`;
    case 'rhythm': {
      const key = `profile.${sc.temporalProfile}`;
      return hasKey(key) ? t(key) : sc.axisLabel || sc.id;
    }
    default:
      return sc.axisLabel || fmtEur(sc.params.budget);
  }
}

/**
 * The four questions of step 5 (plan.md section 3), answered from the runs that exist.
 *
 * Every conclusion is computed from the data: the plans are picked by ROLE and CARD SLOT
 * (essential / reference / ambitious) and the families by their `family` field — no scenario id
 * appears anywhere. When the runs a question needs are missing, the conclusion degrades to the
 * "not enough runs yet" sentence instead of inventing a number.
 */
export interface QuestionAnswer {
  n: number;
  /** the data-driven one-liner shown on the card and again under its proof */
  conclusion: string;
  /** axis labels of the runs this question still needs, "" when the family is complete */
  pending: string;
  /** families whose pending runs this question is waiting for */
  families: FamilyId[];
}

const solvedCards = (data: GameData) => cardsOf(data.scenarios).filter((s) => s.hasResults && s.paper);

const pendingOf = (data: GameData, families: FamilyId[], lang: Lang, t: T): string =>
  families
    .flatMap((f) => pending(membersOf(data.scenarios, f)).map((sc) => axisTick(sc, f, lang, t)))
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(' · ');

const bySlot = (cards: ScenarioData[], slot: string) => cards.find((s) => s.card === slot);

export function answers(data: GameData, t: T, lang: Lang): QuestionAnswer[] {
  const cards = solvedCards(data);
  const first = bySlot(cards, 'essential') ?? cards[0];
  const mid = bySlot(cards, 'reference') ?? cards[1];
  const last = bySlot(cards, 'ambitious') ?? cards[cards.length - 1];
  const ref = referenceOf(data.scenarios);
  const none = t('s5.q.nodata');

  const q1 =
    first?.paper && mid?.paper && last?.paper && first !== mid
      ? t('s5.q1.concl', {
          b1: fmtEur(first.params.budget),
          p1: fmtPct(lang, first.paper.servedRatio, 0),
          b2: fmtEur(mid.params.budget),
          p2: fmtPct(lang, mid.paper.servedRatio, 0),
          b3: fmtEur(last.params.budget - mid.params.budget),
          pts: fmtNum(lang, (last.paper.servedRatio - mid.paper.servedRatio) * 100, 1),
          c1: fmtEur(first.paper.investmentPerServedTripEur),
          c2: fmtEur(mid.paper.investmentPerServedTripEur),
          c3: fmtEur(last.paper.investmentPerServedTripEur),
        })
      : none;

  const q2 =
    first?.paper && mid?.paper && first !== mid
      ? t('s5.q2.concl', {
          b1: fmtEur(first.params.budget),
          s1: fmtPct(lang, first.paper.ptAssistedShare, 0),
          b2: fmtEur(mid.params.budget),
          s2: fmtPct(lang, mid.paper.ptAssistedShare, 0),
        })
      : none;

  const q3 = ref?.paper
    ? t('s5.q3.concl', {
        name: scenName(ref, t),
        budget: fmtEur(ref.paper.opBudgetEur),
        cost: fmtEur(ref.paper.dispatchCostEur),
        runs: fmtInt(ref.paper.dispatches),
        bikes: fmtInt(ref.paper.bikesRebalanced),
      })
    : none;

  const q4 = ref?.paper
    ? t(ref.paper.nearestNeighborM != null ? 's5.q4.concl' : 's5.q4.concl.nonn', {
        nn: ref.paper.nearestNeighborM != null ? fmtInt(ref.paper.nearestNeighborM) : '—',
        trans: fmtInt(ref.paper.nTrans),
        stations: fmtInt(ref.paper.stations),
      })
    : none;

  const fam: FamilyId[][] = [['budget'], ['budget'], ['ops_ratio', 'epsilon'], ['rhythm']];
  return [q1, q2, q3, q4].map((conclusion, i) => ({
    n: i + 1,
    conclusion,
    pending: pendingOf(data, fam[i], lang, t),
    families: fam[i],
  }));
}

/** Rows of the all-plans table, ordered by family then axis value (pending runs included). */
export function allPlans(data: GameData): ScenarioData[] {
  const rank = (s: ScenarioData) => {
    const i = FAMILY_ORDER.indexOf(s.family);
    return i < 0 ? FAMILY_ORDER.length : i;
  };
  return [...data.scenarios].sort(
    (a, b) => rank(a) - rank(b) || a.params.budget - b.params.budget || a.id.localeCompare(b.id)
  );
}

/** A chart ceiling with headroom, computed from the data (never a typed-in axis maximum). */
export function niceMax(values: (number | null)[], fallback: number): number {
  const vals = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!vals.length) return fallback;
  const raw = Math.max(...vals) * 1.25;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  return Math.max(mag, Math.ceil(raw / mag) * mag);
}
