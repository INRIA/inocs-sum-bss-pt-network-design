import { useEffect } from 'react';
import type { GameData, Lang, ScenarioData } from '../lib/types';
import type { T } from '../lib/i18n';
import { isHypDay, scenCopy, scenName } from '../lib/scen';
import { fmtEur, fmtEurSigned, fmtNum, fmtPct } from '../lib/format';

/** The five modal contents (ux-plan-v2 section 5) — same data and i18n as v1, centred layout. */
export type SheetKind = { kind: 'prov' | 'method' | 'cmp' | 'tech' | 'scen'; id?: string } | null;

const basename = (p: unknown) => String(p ?? '').split('/').pop() || '';

/**
 * Centred modal: dark scrim, click-outside and Esc close. This is the one place machine-generated
 * provenance and method text is quoted VERBATIM (ux-plan section 10); it stays reachable in a
 * single tap from either headline, the preliminary badge, and every plan's ⓘ.
 */
export default function Sheet({
  sheet,
  onClose,
  data,
  scenarioId,
  day,
  t,
  lang,
}: {
  sheet: SheetKind;
  onClose: () => void;
  data: GameData;
  scenarioId: string | null;
  day: string;
  t: T;
  lang: Lang;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!sheet) return null;
  const current = data.scenarios.find((s) => s.id === scenarioId) ?? data.scenarios[0];
  const subject = sheet.kind === 'scen' ? data.scenarios.find((s) => s.id === sheet.id) ?? current : current;
  if (!subject) return null;

  return (
    <div className="sheetbg open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t('sheet.aria')}>
        <button className="close" onClick={onClose} aria-label={t('sheet.close')}>
          ×
        </button>
        {sheet.kind === 'prov' && <Prov sc={subject} t={t} />}
        {sheet.kind === 'method' && <Method sc={subject} day={day} t={t} />}
        {sheet.kind === 'scen' && <Scen sc={subject} t={t} lang={lang} />}
        {sheet.kind === 'cmp' && <Compare data={data} current={current} t={t} lang={lang} />}
        {sheet.kind === 'tech' && <Tech sc={subject} day={day} t={t} lang={lang} />}
      </div>
    </div>
  );
}

function Prov({ sc, t }: { sc: ScenarioData; t: T }) {
  return (
    <>
      <h3>{t('prov.h')}</h3>
      <p dangerouslySetInnerHTML={{ __html: t('prov.p1') }} />
      <span className="mono">provenance: {sc.provenance}</span>
      <span className="mono">placeholder_note: {sc.placeholderNote}</span>
      <p dangerouslySetInnerHTML={{ __html: t('prov.p2') }} />
    </>
  );
}

function Method({ sc, day, t }: { sc: ScenarioData; day: string; t: T }) {
  const method = sc.days[day]?.method ?? {};
  const bp = method.behavior_parameters ?? {};
  const isHyp = method.volume_is_hypothesis === true || method.mode === 'sample';
  return (
    <>
      <h3>{t('meth.h')}</h3>
      <p>
        <b>{t(isHyp ? 'meth.x' : 'meth.o')}</b>
      </p>
      <p>{method.description}</p>
      <ul>
        <li>
          {t('meth.l1', {
            walk: bp.walk_catchment_m ?? '?',
            retry: bp.station_retry_count ?? '?',
            speed: bp.ride_speed_kmh ?? '?',
            detour: bp.ride_detour_factor ?? '?',
          })}
        </li>
        <li>{t('meth.l2', { source: basename(method.demand_source) })}</li>
        {isHyp ? (
          <li>
            {t('meth.scale', {
              base: method.volume_base_measured_per_day ?? '?',
              scale: method.scale ?? '?',
              sim: method.volume_simulated ?? '?',
            })}
            {Array.isArray(method.seeds) ? ` · seeds ${method.seeds.join(', ')}` : ''}
          </li>
        ) : (
          <li>{t('meth.replayed', { n: method.n_days_replayed ?? '?', date: method.representative_date ?? '?' })}</li>
        )}
        <li>{t('meth.l3')}</li>
      </ul>
      {isHyp && <p dangerouslySetInnerHTML={{ __html: t('meth.rule') }} />}
    </>
  );
}

/** The full story behind one plan — opened from a C card's "▸ full story", or a D pill's ⓘ. */
function Scen({ sc, t, lang }: { sc: ScenarioData; t: T; lang: Lang }) {
  const weights = sc.params.periodWeights.map((w) => fmtNum(lang, w * 100, 1)).join(' / ');
  return (
    <>
      <h3>
        {scenName(sc, t)}{' '}
        <span className="mono" style={{ display: 'inline', background: 'none', padding: 0, fontSize: 12, color: 'var(--ink-2)' }}>
          {sc.short}
        </span>
      </h3>
      <p className="narr">{scenCopy(sc, t, 'narrative', sc.fallback.narrative)}</p>
      <table className="params">
        <tbody>
          <tr>
            <td>{t('c.p.capex')}</td>
            <td>{fmtEur(sc.params.budget)}</td>
          </tr>
          <tr>
            <td>{t('c.p.ops')}</td>
            <td>{fmtNum(lang, sc.params.opsRatio * 100, 2)} %</td>
          </tr>
          <tr>
            <td>{t('c.p.per')}</td>
            <td>{t('c.p.perv', { n: sc.params.demandPeriods, weights: `${weights} %` })}</td>
          </tr>
          <tr>
            <td>{t('c.p.eps')}</td>
            <td>{sc.params.epsilon}</td>
          </tr>
          <tr>
            <td>{t('c.p.mode')}</td>
            <td>{sc.params.solveMode}</td>
          </tr>
        </tbody>
      </table>
      <p className="narr">
        <b>{t('c.expect')}</b>
      </p>
      <ul>
        {(['service', 'environment', 'economics'] as const).map((k) => (
          <li key={k}>
            {t(`c.expect.${k}`)} — {scenCopy(sc, t, `expect.${k}`, sc.fallback.expect[k])}
          </li>
        ))}
      </ul>
      <p className="narr" style={{ fontSize: 12 }}>
        {t('c.srcnote')}
      </p>
    </>
  );
}

/** The three plans side by side; the current plan's column is highlighted (ux-plan section 4). */
function Compare({ data, current, t, lang }: { data: GameData; current: ScenarioData; t: T; lang: Lang }) {
  const baseDay = current.dayIds.find((d) => !isHypDay(current, d)) ?? current.dayIds[0];
  const hypDay = current.dayIds.find((d) => isHypDay(current, d));

  const rows: { label: string; hyp: boolean; get: (s: ScenarioData) => string }[] = [
    // capex_spent_eur is optional in the results contract — fall back to the budget, never "0 €"
    { label: t('d.cmp.inv'), hyp: false, get: (s) => fmtEur(s.capexSpent > 0 ? s.capexSpent : s.capexBudget) },
    { label: t('d.cmp.st'), hyp: false, get: (s) => String(s.days[baseDay]?.kpi?.service?.stations ?? s.stations.length) },
  ];
  if (hypDay) {
    const at = (s: ScenarioData) => s.days[hypDay]?.kpi;
    rows.push(
      { label: t('d.cmp.srv'), hyp: true, get: (s) => fmtPct(lang, at(s)?.service?.served_ratio ?? 0) },
      { label: t('d.cmp.cpt'), hyp: true, get: (s) => fmtNum(lang, at(s)?.economics?.cost_per_served_trip_eur ?? 0, 2) },
      { label: t('d.cmp.co2'), hyp: true, get: (s) => `${fmtNum(lang, at(s)?.environment?.co2_avoided_kg_per_day ?? 0)} kg` },
      { label: t('d.cmp.res'), hyp: true, get: (s) => fmtEurSigned(at(s)?.economics?.operating_result_eur_per_day ?? 0) }
    );
  }

  return (
    <>
      <h3>{t('d.cmp.h')}</h3>
      <p style={{ fontSize: 12, margin: '2px 0 0' }}>{t('d.cmp.sub')}</p>
      <div style={{ overflowX: 'auto' }}>
        <table className="cmp">
          <thead>
            <tr>
              <th />
              {data.scenarios.map((s) => (
                <th key={s.id} className={s.id === current.id ? 'cur' : ''}>
                  {s.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={row.hyp ? 'hyprow' : ''}>
                <td>{row.label}</td>
                {data.scenarios.map((s) => (
                  <td key={s.id} className={s.id === current.id ? 'cur' : ''}>
                    {row.get(s)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** simulate.py `method.mode` -> its copy key; anything unknown reads as a trace replay. */
const METHOD_KEY: Record<string, string> = { sample: 'd.t.mc', instance: 'd.t.inst', replay: 'd.t.replay' };

/** Under the hood — method, rider behaviour, rebalancing, model parameters, provenance. */
function Tech({ sc, day, t, lang }: { sc: ScenarioData; day: string; t: T; lang: Lang }) {
  const dd = sc.days[day] ?? sc.days[sc.dayIds[0]];
  const method = dd?.method ?? {};
  const bp = method.behavior_parameters ?? {};
  return (
    <>
      <h3>{t('d.tech.sum')}</h3>
      <div className="kv">
        <span>{t('d.t.method')}</span>
        <b>{t(METHOD_KEY[method.mode as string] ?? 'd.t.replay')}</b>
      </div>
      <p className="narr">{method.description}</p>
      <div className="kv">
        <span>{t('d.t.rider')}</span>
        <b>
          {t('d.t.riderv', {
            walk: bp.walk_catchment_m ?? '?',
            retry: bp.station_retry_count ?? '?',
            speed: bp.ride_speed_kmh ?? '?',
          })}
        </b>
      </div>
      <div className="kv">
        <span>{t('d.t.moved')}</span>
        <b>{`${fmtNum(lang, dd?.rebalancing.bikes_moved ?? 0, 2)} ${t('d.perday')}`}</b>
      </div>
      <div className="kv">
        <span>{t('d.t.trucks')}</span>
        <b>{fmtNum(lang, dd?.rebalancing.truck_dispatches ?? 0, 2)}</b>
      </div>
      <div className="kv">
        <span>{t('d.t.rcost')}</span>
        <b>{`${fmtEur(dd?.rebalancing.cost_eur ?? 0)} ${t('d.perday')}`}</b>
      </div>
      <div className="kv">
        <span>{t('d.t.params')}</span>
        <b>{`${fmtEur(sc.params.budget)} · ${fmtNum(lang, sc.params.opsRatio * 100, 2)} % · ε ${sc.params.epsilon}`}</b>
      </div>
      {sc.provenance && (
        <p className="narr" style={{ color: 'var(--green-ink)' }}>
          ◌ {sc.provenance}
        </p>
      )}
    </>
  );
}
