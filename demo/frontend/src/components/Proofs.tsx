import type { T } from '../lib/i18n';
import { cardsOf, membersOf, type FamilyId } from '../lib/families';
import { axisTick, niceMax } from '../lib/questions';
import { fmtEur, fmtInt, fmtNum, fmtPct } from '../lib/format';
import { BarsChart, C_SERIES2, LadderChart, type BarRow, type LadderPoint } from './Charts';
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

const barRows = (
  list: ScenarioData[],
  family: FamilyId,
  t: T,
  lang: Lang,
  value: (sc: ScenarioData) => number | null,
  text: (v: number) => string
): BarRow[] =>
  list.map((sc) => {
    const v = sc.hasResults && sc.paper ? value(sc) : null;
    return { id: sc.id, label: axisTick(sc, family, lang, t), value: v, text: v == null ? undefined : text(v) };
  });

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
    const blocks = (['ops_ratio', 'epsilon'] as const).map((family) => {
      const list = membersOf(data.scenarios, family);
      const cost = barRows(list, family, t, lang, (sc) => sc.paper!.dispatchCostEur, (v) => fmtEur(v));
      const served = barRows(list, family, t, lang, (sc) => sc.paper!.servedRatio * 100, (v) => fmtPct(lang, v / 100, 0));
      return { family, cost, served };
    });
    return (
      <>
        {blocks.map((b) => (
          <div className="two" key={b.family}>
            <div>
              <div className="legend">
                <span>{t(`s5.q3.cost.${b.family}`)}</span>
              </div>
              <BarsChart
                rows={b.cost}
                ymax={niceMax(b.cost.map((r) => r.value), 200)}
                yTick={(v) => fmtEur(v)}
                pendingLabel={pendingLabel}
                alt={t(`s5.q3.cost.${b.family}`)}
              />
            </div>
            <div>
              <div className="legend">
                <span>{t('s5.q3.served')}</span>
              </div>
              <BarsChart
                rows={b.served}
                ymax={100}
                yTick={(v) => fmtInt(v)}
                pendingLabel={pendingLabel}
                alt={t('s5.q3.served')}
              />
            </div>
          </div>
        ))}
        <p className="note">{t('s5.q3.note')}</p>
      </>
    );
  }

  const rhythm = membersOf(data.scenarios, 'rhythm');
  const evening: BarRow[] = rhythm.map((sc) => {
    const w = sc.params.periodWeights;
    const v = w.length ? (w[w.length - 1] ?? 0) * 100 : null;
    return {
      id: sc.id,
      label: axisTick(sc, 'rhythm', lang, t),
      sub: w.map((x) => fmtInt(x * 100)).join('/'),
      value: v,
      text: v == null ? undefined : fmtPct(lang, v / 100, 0),
    };
  });
  const served = barRows(rhythm, 'rhythm', t, lang, (sc) => sc.paper!.servedRatio * 100, (v) => fmtPct(lang, v / 100, 0));
  const nn = barRows(rhythm, 'rhythm', t, lang, (sc) => sc.paper!.nearestNeighborM, (v) => fmtNum(lang, v, 0));
  const hasNn = nn.some((r) => r.value != null);

  return (
    <>
      <div className="two">
        <div>
          <div className="legend">
            <span>{t('s5.q4.evening')}</span>
          </div>
          <BarsChart
            rows={evening}
            ymax={niceMax(evening.map((r) => r.value), 70)}
            yTick={(v) => fmtInt(v)}
            color={C_SERIES2}
            pendingLabel={pendingLabel}
            alt={t('s5.q4.evening')}
          />
        </div>
        <div>
          <div className="legend">
            <span>{t('s5.q3.served')}</span>
          </div>
          <BarsChart rows={served} ymax={100} yTick={(v) => fmtInt(v)} pendingLabel={pendingLabel} alt={t('s5.q3.served')} />
        </div>
      </div>
      {hasNn && (
        <>
          <div className="legend">
            <span>{t('s5.q4.nn')}</span>
          </div>
          <BarsChart
            rows={nn}
            ymax={niceMax(nn.map((r) => r.value), 300)}
            yTick={(v) => fmtInt(v)}
            pendingLabel={pendingLabel}
            alt={t('s5.q4.nn')}
          />
        </>
      )}
      <p className="note">{t('s5.q4.note')}</p>
    </>
  );
}
