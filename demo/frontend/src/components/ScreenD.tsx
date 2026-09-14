import { useState } from 'react';
import { EmptyFullChart, TripsChart } from './Charts';
import NetFacts from './NetFacts';
import type { GameData, Lang, ScenarioData } from '../lib/types';
import type { T } from '../lib/i18n';
import { dayKind, isHypDay, isModelDay, scenName } from '../lib/scen';
import { fmtEur, fmtEurSigned, fmtInt, fmtNum, fmtPct } from '../lib/format';
import type { SheetKind } from './Sheet';

/** chart subtitle per day kind — the existing .o/.x keys, plus .a for the optimiser's own day. */
const CH1_SUB: Record<string, string> = { obs: 'd.ch1.sub.o', mod: 'd.ch1.sub.a', sim: 'd.ch1.sub.x' };

const DAY_KEY: Record<string, string> = {
  monday: 'day.mon',
  sunday: 'day.sun',
  instance: 'day.avg',
  monday_x25: 'day.x25',
};

/**
 * Step D — the consequences (ux-plan section 4, amended by v2 section 3). Everything is visible at
 * once: plan pills (each with its own ⓘ into the scenario modal) and the simulated-day control on
 * top, then a 50/50 split — KPIs on the left, the two hourly charts stacked on the right, which is
 * what gives them their size. "What you built" stays under the map, not here.
 */
export default function ScreenD({
  data,
  t,
  lang,
  scenario,
  chosen,
  simDay,
  onScenario,
  onSimDay,
  onSheet,
  onBack,
}: {
  data: GameData;
  t: T;
  lang: Lang;
  scenario: string | null;
  chosen: string | null;
  simDay: string;
  onScenario: (id: string) => void;
  onSimDay: (d: string) => void;
  onSheet: (s: SheetKind) => void;
  onBack: () => void;
}) {
  const [ro1, setRo1] = useState<string | null>(null);
  const [ro2, setRo2] = useState<string | null>(null);

  const sc = data.scenarios.find((s) => s.id === scenario) ?? data.scenarios[0];
  if (!sc) return <p className="note">{t('d.unavailable')}</p>;

  const day = sc.days[simDay] ? simDay : sc.dayIds[0];
  const dd = sc.days[day];
  const k = dd.kpi;
  const isX = isHypDay(sc, day);
  const isAvg = isModelDay(sc, day);
  const svc = k.service ?? {};
  const mob = k.mobility ?? {};
  const env = k.environment ?? {};
  const eco = k.economics ?? {};
  const cov = eco.opex_eur_per_day ? eco.revenue_eur_per_day / eco.opex_eur_per_day : 0;
  const anyEF = Math.max(...dd.hourly.empty, ...dd.hourly.full) > 0;

  const hypDay = sc.dayIds.find((d) => isHypDay(sc, d));
  const hypMethod = hypDay ? sc.days[hypDay].kpi?.method ?? sc.days[hypDay].method : null;
  const avgMethod = dd.kpi?.method ?? dd.method;

  const chip = <span className="chip">{t('chip.hyp')}</span>;
  const howLink = (
    <button className="inlink" onClick={() => onSheet({ kind: 'method' })}>
      {t('d.howcomputed')}
    </button>
  );

  return (
    <>
      <div className="drow1">
        {/* Pills switch everything below IN PLACE — no navigation, no remount (ux-plan section 5.4).
            The right edge of each pill is a separate ⓘ into that plan's full story (v2 section 3). */}
        <div className="pillrow">
          {data.scenarios.map((s) => (
            <div className="spill" key={s.id} aria-pressed={s.id === sc.id}>
              <button className="spillmain" onClick={() => onScenario(s.id)} title={scenName(s, t)}>
                {scenName(s, t).split(' ')[0]}
                <b>{fmtEur(s.params.budget)}</b>
                {chosen === s.id && <span className="you">{t('d.yourpick')}</span>}
              </button>
              <button
                className="spillinfo"
                title={t('c.details')}
                aria-label={`${scenName(s, t)} — ${t('c.details')}`}
                onClick={() => onSheet({ kind: 'scen', id: s.id })}
              >
                ⓘ
              </button>
            </div>
          ))}
        </div>
        {/* four days in a 2x2 block: Monday / Sunday on top, the optimiser's average day and the
            growth hypothesis below (the two-button switch on step B keeps the plain .seg row). */}
        <div className="seg daygrid" role="group" aria-label={t('d.day.aria')}>
          {sc.dayIds.map((d) => (
            <button key={d} aria-pressed={d === day} onClick={() => onSimDay(d)} title={t(`d.day.hint.${dayKind(sc, d)}`)}>
              <span>{DAY_KEY[d] ? t(DAY_KEY[d]) : d}</span>
              {isHypDay(sc, d) && chip}
            </button>
          ))}
        </div>
      </div>

      {isX && (
        <div className="hyp">
          <span
            dangerouslySetInnerHTML={{
              __html: t('d.hyp', {
                base: fmtNum(lang, hypMethod?.volume_base_measured_per_day ?? 0, 2),
                sim: fmtInt(hypMethod?.volume_simulated ?? 0),
              }),
            }}
          />{' '}
          <button className="lnk" onClick={() => onSheet({ kind: 'method' })}>
            {t('d.hyp.link')}
          </button>
        </div>
      )}

      {isAvg && (
        <div className="daynote">
          <span
            dangerouslySetInnerHTML={{
              __html: t('d.avg', { trips: fmtInt(avgMethod?.demand_volume_trips ?? k.service?.demand_trips ?? 0) }),
            }}
          />{' '}
          <button className="lnk" onClick={() => onSheet({ kind: 'method' })}>
            {t('d.hyp.link')}
          </button>
        </div>
      )}

      {/* mobile only: the net panel is hidden with the legend bars, so its four stats ride here */}
      <NetFacts sc={sc} day={day} t={t} className="dnet" />

      <div className="dsplit">
        <div className="dleft">
          <div className="dualhero">
            <div className="card hero served">
              <div className="lab">{t('d.hero.served.lab')}</div>
              <div className="big">{fmtPct(lang, svc.served_ratio ?? 0)}</div>
              <div className="sub">
                {t('d.hero.served.sub', {
                  s: fmtNum(lang, svc.served_trips ?? 0),
                  d: fmtNum(lang, svc.demand_trips ?? 0),
                  k: t(`d.kind.${dayKind(sc, day)}`),
                })}{' '}
                {isX && chip} · {howLink}
              </div>
            </div>
            <div className="card hero money">
              <div className="lab">{t('d.hero.money.lab')}</div>
              <div className="big">{fmtEurSigned(eco.operating_result_eur_per_day ?? 0)}</div>
              <div className="cov">
                <span style={{ width: `${Math.min(100, cov * 100).toFixed(1)}%` }} />
              </div>
              <div className="sub">
                {t('d.hero.money.sub', {
                  r: fmtEur(eco.revenue_eur_per_day ?? 0),
                  p: `${(cov * 100).toFixed(0)}%`,
                  c: fmtEur(eco.opex_eur_per_day ?? 0),
                })}{' '}
                {isX && chip}
              </div>
            </div>
          </div>

          <div className="kgrid">
            <div className="card kpi">
              <h3>{t('d.k.service')}</h3>
              <Kv label={t('d.k.wanted')} value={fmtNum(lang, svc.demand_trips ?? 0)} />
              <Kv label={t('d.k.served')} value={fmtNum(lang, svc.served_trips ?? 0)} cls="pos" />
              <Kv label={t('d.k.pe')} value={String(svc.peak_empty_stations ?? 0)} cls={svc.peak_empty_stations > 0 ? 'neg' : ''} />
              <Kv label={t('d.k.pf')} value={String(svc.peak_full_stations ?? 0)} cls={svc.peak_full_stations > 0 ? 'warn2' : ''} />
            </div>
            <div className="card kpi">
              <h3>{t('d.k.mobility')}</h3>
              <Kv label={t('d.k.car')} value={fmtNum(lang, mob.trips_shifted_from_car ?? 0)} />
              <Kv label={t('d.k.pt')} value={fmtNum(lang, mob.trips_shifted_from_pt ?? 0)} />
              <Kv label={t('d.k.walk')} value={fmtNum(lang, mob.trips_shifted_from_walk ?? 0)} />
              <Kv label={t('d.k.ckm')} value={fmtNum(lang, mob.car_km_avoided ?? 0)} cls="pos" />
              <Kv label={t('d.k.bpt')} value={fmtPct(lang, mob.share_bike_plus_pt ?? 0, 0)} />
            </div>
            <div className="card kpi">
              <h3>{t('d.k.env')}</h3>
              <Kv label={t('d.k.co2d')} value={fmtNum(lang, env.co2_avoided_kg_per_day ?? 0, 2)} cls="pos" />
              <Kv label={t('d.k.co2y')} value={fmtInt(env.co2_avoided_kg_per_year_extrapolated ?? 0)} />
              <Kv label={t('d.k.trees')} value={fmtInt(env.equivalent_trees_for_a_year ?? 0)} />
            </div>
            <div className="card kpi">
              <h3>{t('d.k.eco')}</h3>
              <Kv label={t('d.k.capex')} value={fmtEur(eco.capex_eur ?? 0)} />
              <Kv label={t('d.k.opex')} value={fmtEur(eco.opex_eur_per_day ?? 0)} />
              <Kv label={t('d.k.rev')} value={fmtEur(eco.revenue_eur_per_day ?? 0)} />
              <Kv label={t('d.k.opr')} value={fmtEurSigned(eco.operating_result_eur_per_day ?? 0)} cls="neg" />
              <Kv label={t('d.k.cpt')} value={fmtNum(lang, eco.cost_per_served_trip_eur ?? 0, 2)} />
            </div>
          </div>
        </div>

        {/* stacked, never side by side — this is what keeps the charts big (v2 section 3) */}
        <div className="dright">
          <div className="card chartcard">
            <h3>{t('d.ch1.h')}</h3>
            <div className="sub">{t(CH1_SUB[dayKind(sc, day)])}</div>
            <div className="legend">
              <span>
                <i style={{ background: '#004494' }} />
                {t('d.ch1.l1')}
              </span>
              <span>
                <i style={{ background: '#ff3514' }} />
                {t('d.ch1.l2')}
              </span>
            </div>
            <TripsChart hourly={dd.hourly} t={t} lang={lang} onPick={setRo1} alt={t('d.ch1.alt')} />
            <div className="readout">{ro1 ?? t('d.tap')}</div>
          </div>

          <div className="card chartcard">
            <h3>{t('d.ch2.h')}</h3>
            <div className="sub">{t(anyEF ? 'd.ch2.sub.y' : 'd.ch2.sub.n')}</div>
            <div className="legend">
              <span>
                <i style={{ background: '#ff3514' }} />
                {t('d.ch2.l1')}
              </span>
              <span>
                <i style={{ background: '#004494' }} />
                {t('d.ch2.l2')}
              </span>
            </div>
            <EmptyFullChart hourly={dd.hourly} t={t} onPick={setRo2} alt={t('d.ch2.alt')} />
            <div className="readout">{ro2 ?? t('d.tap')}</div>
          </div>
        </div>
      </div>

      {/* computed live from every scenario x every day — never hardcoded (ux-plan section 4) */}
      <p
        className="rangenote"
        dangerouslySetInnerHTML={{
          // The claim follows the numbers: with the optimiser's own day in the mix the best day is
          // profitable, so the categorical "never pays for itself" line may not be told.
          __html: t(data.opRange.max > 0 ? 'd.range.mixed' : 'd.range', {
            min: fmtEurSigned(data.opRange.min),
            max: fmtEurSigned(data.opRange.max),
          }),
        }}
      />

      <div className="dfoot">
        <button className="ghostbtn" onClick={() => onSheet({ kind: 'cmp' })}>
          {t('d.compare.btn')}
        </button>
        <button className="ghostbtn" onClick={() => onSheet({ kind: 'tech' })}>
          {t('d.tech.btn')}
        </button>
        <button className="cta go" onClick={onBack}>
          {t('d.cta')}
        </button>
      </div>
    </>
  );
}

function Kv({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <b className={cls}>{value}</b>
    </div>
  );
}
