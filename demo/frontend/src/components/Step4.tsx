import type { ReactNode } from 'react';
import type { T } from '../lib/i18n';
import { cardsOf, referenceOf } from '../lib/families';
import { scenName } from '../lib/scen';
import { fmtEur, fmtInt, fmtNum, fmtPct, fmtShare, hlabel } from '../lib/format';
import { C_POTENTIAL, C_POTENTIAL_LINE, C_SERIES, C_SERIES2, PeriodChart } from './Charts';
import { TechTable } from './TechTable';
import NetFacts from './NetFacts';
import StressTable from './StressTable';
import type { GameData, Lang, ScenarioData } from '../lib/types';
import type { SheetKind } from './Sheet';

function Tile({
  lab,
  big,
  unit,
  sub,
  how,
  onSheet,
  t,
}: {
  lab: string;
  big: string;
  unit?: string;
  sub: ReactNode;
  how?: string;
  onSheet: (s: SheetKind) => void;
  t: T;
}) {
  return (
    <div className="tile">
      <div className="lab">{lab}</div>
      <div className="big">
        {big}
        {unit && <small>{unit}</small>}
      </div>
      <div className="sub">{sub}</div>
      {how && (
        <button className="how" onClick={() => onSheet({ kind: 'how', topic: how })}>
          {t('s4.how')}
        </button>
      )}
    </div>
  );
}

/**
 * Step 4 — the results, read from the model's own solution the way the paper evaluates it
 * (plan.md section 6). Six tiles, the period chart, and — behind the header's "Advanced view"
 * switch — the evaluator's full metric table and the demo-side stress test.
 */
export default function Step4({
  data,
  t,
  lang,
  scenario,
  chosen,
  advanced,
  howOpen,
  onHowToggle,
  onScenario,
  onSheet,
  onNext,
  onBack,
}: {
  data: GameData;
  t: T;
  lang: Lang;
  scenario: ScenarioData | undefined;
  chosen: string | null;
  advanced: boolean;
  howOpen: boolean;
  onHowToggle: () => void;
  onScenario: (id: string) => void;
  onSheet: (s: SheetKind) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const cards = cardsOf(data.scenarios).filter((s) => s.hasResults);
  const sc = scenario;
  const p = sc?.paper;
  if (!sc || !p) return <p className="note">{t('s4.unavailable')}</p>;

  const bounds = data.city.periodBounds;
  const periodLabels = p.demandByPeriod.map((_, i) =>
    bounds[i] ? t(`s2.per.${i}`, { a: hlabel(bounds[i][0]), b: hlabel(bounds[i][1]) }) : `${i + 1}`
  );
  const shares = p.demandByPeriod.map((d, i) => t('s4.chart.share', { p: fmtShare(lang, p.servedByPeriod[i] ?? 0, d) }));

  const ref = referenceOf(data.scenarios);
  const readingKey = `s4.reading.${sc.card ?? 'reference'}`;
  const reading = t(readingKey, {
    budget: fmtEur(sc.params.budget),
    morning: fmtShare(lang, p.servedByPeriod[0] ?? 0, p.demandByPeriod[0] ?? 0),
    evening: fmtShare(lang, p.servedByPeriod[p.servedByPeriod.length - 1] ?? 0, p.demandByPeriod[p.demandByPeriod.length - 1] ?? 0),
    pt: fmtPct(lang, p.ptAssistedShare, 0),
    delta: ref?.paper ? fmtInt(Math.abs(p.servedTotal - ref.paper.servedTotal)) : '—',
    refname: ref ? scenName(ref, t) : '—',
  });

  return (
    <>
      <p className="eyebrow">{t('s4.eyebrow')}</p>

      <div className="pillrow">
        {cards.map((s) => (
          <div className="spill" key={s.id} aria-pressed={s.id === sc.id}>
            <button className="spillmain" onClick={() => onScenario(s.id)} title={scenName(s, t)}>
              {scenName(s, t)}
              <b>{fmtEur(s.params.budget)}</b>
              {chosen === s.id && <span className="you">{t('s4.yourpick')}</span>}
            </button>
            <button
              className="spillinfo"
              title={t('s3.details')}
              aria-label={`${scenName(s, t)} — ${t('s3.details')}`}
              onClick={() => onSheet({ kind: 'story', id: s.id })}
            >
              ⓘ
            </button>
          </div>
        ))}
      </div>

      {/* mobile only: the net panel is hidden with the legend bars, so its four stats ride here */}
      <NetFacts sc={sc} t={t} className="dnet" />

      <h2>{t('s4.title', { name: scenName(sc, t) })}</h2>
      <p className="lede">{t('s4.lede')}</p>

      <div className="tiles">
        <Tile
          t={t}
          onSheet={onSheet}
          lab={t('s4.t1.lab')}
          big={fmtPct(lang, p.servedRatio, 0)}
          sub={t('s4.t1.sub', { s: fmtInt(p.servedTotal), d: fmtInt(p.demandTotal) })}
          how="served"
        />
        <Tile
          t={t}
          onSheet={onSheet}
          lab={t('s4.t2.lab')}
          big={fmtPct(lang, p.ptAssistedShare, 0)}
          sub={t('s4.t2.sub')}
          how="pt"
        />
        <Tile
          t={t}
          onSheet={onSheet}
          lab={t('s4.t3.lab')}
          big={fmtNum(lang, p.avgTimeGainMin, 1)}
          unit={t('s4.t3.unit')}
          sub={t('s4.t3.sub', { p: fmtPct(lang, p.timeSavingRatio, 0) })}
          how="time"
        />
        <Tile
          t={t}
          onSheet={onSheet}
          lab={t('s4.t4.lab')}
          big={fmtInt(p.stations)}
          unit={t('s4.t4.unit')}
          sub={t('s4.t4.sub', {
            reg: fmtInt(p.nReg),
            trans: fmtInt(p.nTrans),
            docks: fmtInt(p.docks),
            bikes: fmtInt(p.bikes),
            capex: fmtEur(p.capexUsedEur),
            budget: fmtEur(p.budgetEur),
          })}
        />
        <Tile
          t={t}
          onSheet={onSheet}
          lab={t('s4.t5.lab')}
          big={fmtInt(p.dispatches)}
          unit={t('s4.t5.unit')}
          sub={t('s4.t5.sub', {
            bikes: fmtInt(p.bikesRebalanced),
            cost: fmtEur(p.dispatchCostEur),
            budget: fmtEur(p.opBudgetEur),
          })}
          how="ops"
        />
        <Tile
          t={t}
          onSheet={onSheet}
          lab={t('s4.t6.lab')}
          big={fmtInt(p.investmentPerServedTripEur)}
          unit="€"
          sub={t('s4.t6.sub', { budget: fmtEur(p.budgetEur), served: fmtInt(p.servedTotal) })}
        />
      </div>

      <div className="row">
        <button className={`ghostbtn small${howOpen ? ' on' : ''}`} onClick={onHowToggle} aria-expanded={howOpen}>
          {howOpen ? '▾' : '▸'} {t('s4.howbox.btn')}
        </button>
      </div>
      {howOpen && (
        <div className="howbox">
          <ul>
            <li dangerouslySetInnerHTML={{ __html: t('s4.howbox.l1', { demand: fmtInt(p.demandTotal) }) }} />
            <li dangerouslySetInnerHTML={{ __html: t('s4.howbox.l2') }} />
            <li
              dangerouslySetInnerHTML={{
                __html: t('s4.howbox.l3', {
                  eps: String(sc.params.epsilon),
                  runs: fmtInt(p.dispatches),
                  bikes: fmtInt(p.bikesRebalanced),
                }),
              }}
            />
          </ul>
        </div>
      )}

      <div className="card chartcard">
        <h3>{t('s4.chart.h')}</h3>
        <div className="sub">{t('s4.chart.sub')}</div>
        <div className="legend">
          <span>
            <i style={{ background: C_POTENTIAL, border: `1px solid ${C_POTENTIAL_LINE}` }} />
            {t('s4.chart.l1')}
          </span>
          <span>
            <i style={{ background: C_SERIES }} />
            {t('s4.chart.l2')}
          </span>
          <span>
            <i style={{ background: C_SERIES2 }} />
            {t('s4.chart.l3')}
          </span>
        </div>
        <PeriodChart
          demand={p.demandByPeriod}
          served={p.servedByPeriod}
          bikeOnly={p.bikeOnlyByPeriod}
          bikePt={p.bikePtByPeriod}
          labels={periodLabels}
          shares={shares}
          alt={t('s4.chart.alt')}
        />
        <div className="reading">{reading}</div>
      </div>

      {advanced && (
        <div className="advbox">
          <h3>
            {t('s4.adv.h')} <span className="tag">{t('adv.tag')}</span>
          </h3>
          <p className="note">{t('s4.adv.p')}</p>
          <TechTable sc={sc} t={t} lang={lang} />
          <div className="row">
            <button className="ghostbtn small" onClick={() => onSheet({ kind: 'how', topic: 'hood' })}>
              {t('how.hood.h')}
            </button>
            <button className="ghostbtn small" onClick={() => onSheet({ kind: 'how', topic: 'stress' })}>
              {t('how.stress.h')}
            </button>
          </div>
          <StressTable sc={sc} t={t} lang={lang} />
        </div>
      )}

      <div className="dfoot">
        <button className="cta" onClick={onNext}>
          {t('s4.cta')}
        </button>
        <button className="ghostbtn" onClick={onBack}>
          {t('s4.back')}
        </button>
      </div>
    </>
  );
}
