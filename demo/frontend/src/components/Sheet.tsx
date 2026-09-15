import { useEffect } from 'react';
import type { T } from '../lib/i18n';
import { scenName, scenNarrative, scenPitch } from '../lib/scen';
import { fmtEur, fmtInt, fmtNum, fmtPct, hlabel } from '../lib/format';
import type { GameData, Lang, ScenarioData } from '../lib/types';

/** The two modal contents of v3: a plan's full story + parameters, and the "how is this computed?" texts. */
export type SheetKind = { kind: 'story'; id: string } | { kind: 'how'; topic: string } | null;

/**
 * Centred modal: dark scrim, click-outside and Esc close. Machine-generated provenance stays
 * quoted verbatim (ux-plan section 10); every figure in the parameter table is read from the
 * scenario configuration or the run's own record.
 */
export default function Sheet({
  sheet,
  onClose,
  data,
  current,
  t,
  lang,
}: {
  sheet: SheetKind;
  onClose: () => void;
  data: GameData;
  current: ScenarioData | undefined;
  t: T;
  lang: Lang;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!sheet) return null;
  const subject = sheet.kind === 'story' ? data.scenarios.find((s) => s.id === sheet.id) ?? current : current;

  return (
    <div className="sheetbg open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t('sheet.aria')}>
        <button className="close" onClick={onClose} aria-label={t('sheet.close')}>
          ×
        </button>
        {sheet.kind === 'story' && subject && <Story sc={subject} data={data} t={t} lang={lang} />}
        {sheet.kind === 'how' && <How topic={sheet.topic} sc={subject} t={t} lang={lang} />}
      </div>
    </div>
  );
}

/** The full story behind one plan: pitch, narrative, result, and the model parameters as a table. */
function Story({ sc, data, t, lang }: { sc: ScenarioData; data: GameData; t: T; lang: Lang }) {
  const p = sc.paper;
  const bounds = data.city.periodBounds;
  const periodText = bounds.length
    ? `${sc.params.demandPeriods} — ${bounds.map((b) => `${hlabel(b[0])}–${hlabel(b[1])}`).join(' / ')}`
    : String(sc.params.demandPeriods);
  const opEur = p ? p.opBudgetEur : sc.params.budget * sc.params.opsRatio;
  const status = sc.technical.gurobi_status ?? sc.technical.status;
  const gap = sc.technical.mip_gap;
  const wall = sc.technical.wall_clock_s ?? sc.technical.runtime;

  const rows: [string, string][] = [
    [t('story.budget'), fmtEur(sc.params.budget)],
    [t('story.ops'), `${fmtNum(lang, sc.params.opsRatio * 100, 2)} % → ${fmtEur(opEur)} ${t('story.perday')}`],
    [t('story.station'), t('story.station.v')],
    [t('story.dock'), t('story.dock.v')],
    [t('story.bike'), t('story.bike.v')],
    [t('story.truck'), t('story.truck.v')],
    [t('story.periods'), periodText],
    [t('story.weights'), `${sc.params.periodWeights.map((w) => fmtInt(w * 100)).join(' / ')} %`],
    [t('story.profile'), sc.axisLabel || sc.temporalProfile],
    [t('story.eps'), String(sc.params.epsilon)],
    [t('story.lambda'), t('story.lambda.v')],
    [t('story.cap'), t('story.cap.v')],
    [t('story.mode'), sc.params.solveMode],
    [t('story.seed'), String(sc.params.seed)],
  ];
  if (sc.hasResults) {
    rows.push([
      t('story.solver'),
      t('story.solver.v', {
        status: status != null ? String(status) : '—',
        gap: gap != null ? fmtPct(lang, Number(gap), 2) : '—',
        wall: wall != null ? fmtNum(lang, Number(wall), 1) : '—',
        date: sc.ranAt ? sc.ranAt.slice(0, 10) : '—',
      }),
    ]);
  }

  return (
    <>
      <h3>{t('story.h', { name: scenName(sc, t) })}</h3>
      <p>{scenPitch(sc, t)}</p>
      <p className="narr">{scenNarrative(sc, t)}</p>
      {p ? (
        <p>
          <b>{t('story.result')}</b>{' '}
          {t('story.result.v', {
            stations: fmtInt(p.stations),
            reg: fmtInt(p.nReg),
            trans: fmtInt(p.nTrans),
            docks: fmtInt(p.docks),
            bikes: fmtInt(p.bikes),
            served: fmtPct(lang, p.servedRatio, 0),
            pt: fmtPct(lang, p.ptAssistedShare, 0),
          })}
        </p>
      ) : (
        <p className="pend">{t('story.pending')}</p>
      )}
      <p>
        <b>{t('story.params')}</b>
      </p>
      <div className="tw">
        <table className="params">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">{t('story.src')}</p>
      {sc.paperReference && <p className="note mono">{sc.paperReference}</p>}
      {sc.provenance && <p className="note mono">{sc.provenance}</p>}
    </>
  );
}

/** "How is this computed?" — one authored explanation per headline, plus the two advanced popups. */
function How({ topic, sc, t, lang }: { topic: string; sc: ScenarioData | undefined; t: T; lang: Lang }) {
  const p = sc?.paper;
  const vars: Record<string, string | number> = {
    demand: p ? fmtInt(p.demandTotal) : '—',
    nvar: sc?.technical.n_variables != null ? fmtInt(Number(sc.technical.n_variables)) : '—',
    ncon: sc?.technical.n_constraints != null ? fmtInt(Number(sc.technical.n_constraints)) : '—',
    gain: p ? fmtNum(lang, p.avgTimeGainMin, 1) : '—',
    saving: p ? fmtPct(lang, p.timeSavingRatio, 0) : '—',
  };
  const stress = sc?.stressTest ?? [];
  return (
    <>
      <h3>{t(`how.${topic}.h`)}</h3>
      <p dangerouslySetInnerHTML={{ __html: t(`how.${topic}.p`, vars) }} />
      {topic === 'stress' && stress.length > 0 && (
        <ul>
          {stress.map((d) => (
            <li key={d.day}>
              {t(`s4.stress.day.${d.day}`, { n: fmtInt(d.nDaysReplayed) })} — {fmtNum(lang, d.demand, 2)}{' '}
              {t('s4.stress.trips').toLowerCase()}, {fmtPct(lang, d.servedRatio, 1)} {t('s4.stress.served').toLowerCase()}
              {d.representativeDate ? ` · ${d.representativeDate}` : ''}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
