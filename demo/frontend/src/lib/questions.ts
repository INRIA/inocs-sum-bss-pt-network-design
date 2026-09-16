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

/** One bar of the question-3 charts: a solved run at the reference capital budget. */
export interface TruckVersion {
  sc: ScenarioData;
  runs: number;
  cost: number;
  served: number;
  servedRatio: number;
  docks: number;
  /** other runs (bigger truck budgets) that produced exactly this solution */
  same: ScenarioData[];
}

/**
 * Question 3 compares the SAME network (the reference capital budget) from no trucks at all to
 * trucks spending the whole daily budget: the operating-ratio and penalty families merged, sorted
 * by what the trucks cost. Runs that produced an identical solution (a bigger truck budget the
 * model never uses) collapse into one bar and are listed in `same`, so the chart never repeats a
 * bar five times.
 */
export function truckVersions(data: GameData): { versions: TruckVersion[]; pending: ScenarioData[]; budget: number } {
  const ref = referenceOf(data.scenarios);
  const budget = ref?.params.budget ?? 0;
  const seen = new Set<string>();
  const members = [...membersOf(data.scenarios, 'ops_ratio'), ...membersOf(data.scenarios, 'epsilon')]
    .filter((sc) => !seen.has(sc.id) && seen.add(sc.id))
    .filter((sc) => !sc.legacy && sc.params.budget === budget);
  const solved = members
    .filter((sc) => sc.hasResults && sc.paper)
    // the baseline first, so it is the representative when others reproduce its solution
    .sort((a, b) => Number(b.family === 'baseline') - Number(a.family === 'baseline'));
  const versions: TruckVersion[] = [];
  for (const sc of solved) {
    const p = sc.paper!;
    const twin = versions.find((v) => v.cost === p.dispatchCostEur && v.served === p.servedTotal && v.docks === p.docks);
    if (twin) {
      twin.same.push(sc);
      continue;
    }
    versions.push({
      sc,
      runs: p.dispatches,
      cost: p.dispatchCostEur,
      served: p.servedTotal,
      servedRatio: p.servedRatio,
      docks: p.docks,
      same: [],
    });
  }
  versions.sort((a, b) => a.cost - b.cost || a.served - b.served);
  return { versions, pending: members.filter((sc) => !sc.hasResults), budget };
}

/** How a truck version is named on the x axis: "no trucks" or "9 runs/day". */
export const truckLabel = (v: TruckVersion, t: T): string =>
  v.runs === 0 ? t('s5.q3.x.none') : v.runs === 1 ? t('s5.q3.x.run') : t('s5.q3.x.runs', { n: fmtInt(v.runs) });

/** Question 4's per-period service rates of one run (served / potential per period). */
export const periodRates = (sc: ScenarioData): number[] | null =>
  sc.hasResults && sc.paper && sc.paper.demandByPeriod.length
    ? sc.paper.demandByPeriod.map((d, i) => (d ? (sc.paper!.servedByPeriod[i] ?? 0) / d : 0))
    : null;

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

  const tv = truckVersions(data);
  const base = tv.versions[0];
  const paid = tv.versions.find((v) => v.sc.family === 'baseline') ?? tv.versions[1];
  const top = tv.versions[tv.versions.length - 1];
  const q3 =
    base && paid && top && base !== paid
      ? t('s5.q3.concl', {
          budget: fmtEur(tv.budget),
          base: truckLabel(base, t),
          p0: fmtPct(lang, base.servedRatio, 1),
          runs: fmtInt(paid.runs),
          cost: fmtEur(paid.cost),
          p1: fmtPct(lang, paid.servedRatio, 1),
          extra: fmtInt(paid.served - base.served),
          topcost: fmtEur(top.cost),
          topruns: fmtInt(top.runs),
          extra2: fmtInt(top.served - paid.served),
          dmin: fmtInt(Math.min(...tv.versions.map((v) => v.docks))),
          dmax: fmtInt(Math.max(...tv.versions.map((v) => v.docks))),
        })
      : none;

  const rhythms = membersOf(data.scenarios, 'rhythm').filter((s) => s.hasResults && s.paper);
  const best = rhythms.length ? rhythms.reduce((a, b) => (b.paper!.servedRatio > a.paper!.servedRatio ? b : a)) : undefined;
  const worst = rhythms.length ? rhythms.reduce((a, b) => (b.paper!.servedRatio < a.paper!.servedRatio ? b : a)) : undefined;
  const rates = worst ? periodRates(worst) : null;
  const peak = worst ? worst.paper!.demandByPeriod.indexOf(Math.max(...worst.paper!.demandByPeriod)) : -1;
  const q4 =
    best && worst && best !== worst && rates && peak >= 0
      ? t('s5.q4.concl', {
          budget: fmtEur(worst.params.budget),
          best: axisTick(best, 'rhythm', lang, t),
          pb: fmtPct(lang, best.paper!.servedRatio, 0),
          worst: axisTick(worst, 'rhythm', lang, t),
          pw: fmtPct(lang, worst.paper!.servedRatio, 0),
          period: t(`s5.per.${peak}`),
          share: fmtPct(lang, worst.paper!.demandByPeriod[peak] / worst.paper!.demandTotal, 0),
          ps: fmtPct(lang, rates[peak], 0),
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
