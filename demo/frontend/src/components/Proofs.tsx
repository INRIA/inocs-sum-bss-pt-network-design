import type { T } from '../lib/i18n';
import { cardsOf, membersOf } from '../lib/families';
import { axisTick, niceMax, periodRates, truckLabel, truckVersions } from '../lib/questions';
import { fmtEur, fmtInt, fmtPct, hlabel } from '../lib/format';
import { BarsChart, LadderChart, RhythmPanels, type BarRow, type LadderPoint, type RhythmPanelData } from './Charts';
import { scenName } from '../lib/scen';
import type { GameData, Lang, ScenarioData } from '../lib/types';

/**
 * The proof of each question in step 5: one chart family per question, solid marks for the runs
 * that exist, hollow marks for the runs the notebook still has to make. Every series is built from
 * the scenario families, so a new run appears in the chart the moment its results land on disk.
 */
function ladderPoints(
  data: GameData,
  t: T,
  value: (sc: ScenarioData) => number | null,
  label: (v: number) => string
): LadderPoint[] {
  return membersOf(data.scenarios, 'budget').map((sc) => {
    const v = sc.hasResults && sc.paper ? value(sc) : null;
    return {
      id: sc.id,
      x: sc.params.budget,
      tick: t('unit.keur', { n: fmtInt(sc.params.budget / 1000) }),
      value: v,
      legacy: sc.legacy,
      label: v == null ? '' : label(v),
    };
  });
}

export default function Proof({ n, data, t, lang }: { n: number; data: GameData; t: T; lang: Lang }) {
  const pendingLabel = t('pending.short');
  const cards = cardsOf(data.scenarios).filter((s) => s.hasResults && s.paper);

  if (n === 1) {
    const points = ladderPoints(data, t, (sc) => (sc.paper!.servedRatio ?? 0) * 100, (v) => fmtPct(lang, v / 100, 0));
    const rows: BarRow[] = cards.map((sc) => ({
      id: sc.id,
      label: scenName(sc, t),
      sub: fmtEur(sc.params.budget),
      value: sc.paper!.investmentPerServedTripEur,
      text: fmtEur(sc.paper!.investmentPerServedTripEur),
    }));
    return (
      <>
        <LadderChart points={points} ymax={100} yTick={(v) => fmtInt(v)} pendingLabel={pendingLabel} alt={t('s5.q1.alt')} />
        <div className="legend">
          <span>{t('s5.q1.axis')}</span>
        </div>
        <div className="two">
          <div>
            <div className="legend">
              <span>{t('s5.q1.bars')}</span>
            </div>
            <BarsChart
              rows={rows}
              ymax={niceMax(rows.map((r) => r.value), 100)}
              yTick={(v) => fmtEur(v)}
              pendingLabel={pendingLabel}
              alt={t('s5.q1.bars')}
            />
          </div>
          <p className="note">{t('s5.q1.note')}</p>
        </div>
      </>
    );
  }

  if (n === 2) {
    const points = ladderPoints(data, t, (sc) => (sc.paper!.ptAssistedShare ?? 0) * 100, (v) => fmtPct(lang, v / 100, 0));
    return (
      <>
        <LadderChart
          points={points}
          ymax={niceMax(points.map((p) => p.value), 60)}
          yTick={(v) => fmtInt(v)}
          pendingLabel={pendingLabel}
          alt={t('s5.q2.alt')}
        />
        <div className="legend">
          <span>{t('s5.q2.axis')}</span>
        </div>
        <p className="note">{t('s5.q2.note')}</p>
      </>
    );
  }

  if (n === 3) {
    // the same network from no trucks to trucks spending the whole daily budget (questions.ts)
    const { versions, pending, budget } = truckVersions(data);
    const base = versions[0];
    // x axis, three lines: the version's capital budget, its trucks, and what limits the trucks
    const keur = (sc: ScenarioData) => t('unit.keur', { n: fmtInt(sc.params.budget / 1000) });
    const limit = (sc: ScenarioData) => (sc.params.opsRatio === 0 ? t('s5.q3.x.nobudget') : `ε = ${sc.params.epsilon}`);
    const cost: BarRow[] = versions.map((v) => ({
      id: v.sc.id,
      label: keur(v.sc),
      sub: truckLabel(v, t),
      sub2: limit(v.sc),
      value: v.cost,
      text: fmtEur(v.cost),
    }));
    const extra: BarRow[] = versions.map((v) => ({
      id: v.sc.id,
      label: keur(v.sc),
      sub: truckLabel(v, t),
      sub2: limit(v.sc),
      value: base ? v.served - base.served : null,
      text: base ? `+${fmtInt(v.served - base.served)} · ${fmtPct(lang, v.servedRatio, 1)}` : undefined,
    }));
    for (const sc of pending) {
      const row = { id: sc.id, label: keur(sc), sub: sc.axisLabel || sc.id, sub2: limit(sc), value: null };
      cost.push(row);
      extra.push(row);
    }
    const twins = versions.find((v) => v.same.length);
    const twinBudgets = twins ? twins.same.map((sc) => sc.paper?.opBudgetEur ?? 0).concat(twins.sc.paper?.opBudgetEur ?? 0) : [];
    return (
      <>
        <p className="note">{t('s5.q3.read', { budget: fmtEur(budget) })}</p>
        <div className="legend">
          <span>{t('s5.q3.cost')}</span>
        </div>
        <BarsChart
          rows={cost}
          ymax={niceMax(cost.map((r) => r.value), 200)}
          yTick={(v) => fmtEur(v)}
          pendingLabel={pendingLabel}
          alt={t('s5.q3.cost')}
          width={520}
          left={46}
        />
        <div className="legend">
          <span>{t('s5.q3.extra', { base: base ? truckLabel(base, t) : '—' })}</span>
        </div>
        <BarsChart
          rows={extra}
          ymax={niceMax(extra.map((r) => r.value), 20)}
          yTick={(v) => fmtInt(v)}
          pendingLabel={pendingLabel}
          alt={t('s5.q3.extra', { base: base ? truckLabel(base, t) : '—' })}
          width={520}
          left={40}
        />
        {twins && (
          <p className="note">
            {t('s5.q3.same', {
              n: fmtInt(twins.same.length + 1),
              min: fmtEur(Math.min(...twinBudgets)),
              max: fmtEur(Math.max(...twinBudgets)),
              runs: fmtInt(twins.runs),
              cost: fmtEur(twins.cost),
            })}
          </p>
        )}
        <p className="note">{t('s5.q3.note')}</p>
      </>
    );
  }

  // question 4: the same budget under four rhythms, the model's periods on the x axis
  const rhythm = membersOf(data.scenarios, 'rhythm');
  const bounds = data.city.periodBounds;
  const periods: [string, string][] = (rhythm[0]?.params.periodWeights ?? []).map((_, i) => [
    t(`s5.per.${i}`),
    bounds[i] ? `${hlabel(bounds[i][0])}–${hlabel(bounds[i][1])}` : `P${i + 1}`,
  ]);
  const panels: RhythmPanelData[] = rhythm.map((sc) => {
    const w = sc.params.periodWeights;
    const p = sc.paper;
    const share = p && p.demandTotal ? p.demandByPeriod.map((d) => d / p.demandTotal) : w;
    return {
      id: sc.id,
      title: axisTick(sc, 'rhythm', lang, t),
      sub: p
        ? t('s5.q4.sub', { served: fmtPct(lang, p.servedRatio, 0), w: w.map((x) => fmtInt(x * 100)).join('/') })
        : `${pendingLabel} · ${w.map((x) => fmtInt(x * 100)).join('/')}`,
      share,
      served: periodRates(sc),
    };
  });
  const ymax = niceMax(panels.flatMap((p) => p.share.map((x) => x * 100)), 50) / 100;
  const solvedR = rhythm.filter((sc) => sc.paper);
  const nns = solvedR.map((sc) => sc.paper!.nearestNeighborM).filter((v): v is number => v != null);
  const counts = solvedR.map((sc) => sc.paper!.stations);

  return (
    <>
      <p className="note">{t('s5.q4.read')}</p>
      <div className="legend">
        <span>
          <i style={{ background: '#dfebe5', border: '1px solid #c6d9cd' }} />
          {t('s5.q4.share')}
        </span>
        <span>
          <i style={{ background: '#004494' }} />
          {t('s5.q4.served')}
        </span>
      </div>
      <RhythmPanels
        panels={panels}
        periods={periods}
        ymax={ymax}
        pendingLabel={pendingLabel}
        servedLabel={(r) => fmtPct(lang, r, 0)}
        alt={t('s5.q4.alt')}
      />
      {nns.length > 1 && (
        <p className="note">
          {t('s5.q4.nn.note', {
            nmin: fmtInt(Math.min(...nns)),
            nmax: fmtInt(Math.max(...nns)),
            smin: fmtInt(Math.min(...counts)),
            smax: fmtInt(Math.max(...counts)),
          })}
        </p>
      )}
      <p className="note">{t('s5.q4.note')}</p>
    </>
  );
}
