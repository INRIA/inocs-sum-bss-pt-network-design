import type { T } from '../lib/i18n';
import { allPlans, answers } from '../lib/questions';
import { scenName } from '../lib/scen';
import { fmtEur, fmtInt, fmtNum, fmtPct } from '../lib/format';
import Proof from './Proofs';
import type { GameData, Lang } from '../lib/types';

/**
 * Step 5 — the four questions answered. Each card carries a conclusion computed from the runs and
 * a "show the proof" button; several proofs can be open at once and always stack in question
 * order. The all-plans table at the bottom lists every scenario, pending runs included.
 */
export default function Step5({
  data,
  t,
  lang,
  open,
  onToggle,
  onRestart,
}: {
  data: GameData;
  t: T;
  lang: Lang;
  open: number[];
  onToggle: (n: number) => void;
  onRestart: () => void;
}) {
  const qa = answers(data, t, lang);
  const plans = allPlans(data);

  return (
    <>
      <p className="eyebrow">{t('s5.eyebrow')}</p>
      <h2>{t('s5.title')}</h2>
      <p className="lede">{t('s5.lede')}</p>

      <div className="qgrid">
        {qa.map((a) => (
          <div className={`qcard${open.includes(a.n) ? ' open' : ''}`} key={a.n}>
            <span className="no">{t('s1.qno', { n: a.n })}</span>
            <h3>{t(`q${a.n}.short`)}</h3>
            <p className="concl">{a.conclusion}</p>
            {a.pending && <span className="pb">{t('s5.pending', { list: a.pending })}</span>}
            <button className="proof" onClick={() => onToggle(a.n)}>
              {open.includes(a.n) ? t('s5.hide') : t('s5.show')}
            </button>
          </div>
        ))}
      </div>

      {qa
        .filter((a) => open.includes(a.n))
        .map((a) => (
          <div className="qblock proofblock" key={a.n} id={`proof${a.n}`}>
            <div className="qbhead">
              <h3>
                {t('s1.qno', { n: a.n })} · {t(`q${a.n}.short`)}
              </h3>
              <button className="ghostbtn small" onClick={() => onToggle(a.n)}>
                {t('s5.hide.short')}
              </button>
            </div>
            <div className="paper">{t('s5.paperref', { ref: t(`q${a.n}.paper`) })}</div>
            <Proof n={a.n} data={data} t={t} lang={lang} />
            <div className="answer">{a.conclusion}</div>
            {a.pending && <div className="pend">{t('s5.pending', { list: a.pending })}</div>}
          </div>
        ))}

      <div className="qblock">
        <h3>{t('s5.all.h')}</h3>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>{t('s5.all.plan')}</th>
                <th className="n">{t('s5.all.budget')}</th>
                <th className="n">{t('s5.all.served')}</th>
                <th className="n">{t('s5.all.pt')}</th>
                <th className="n">{t('s5.all.min')}</th>
                <th className="n">{t('s5.all.stations')}</th>
                <th className="n">{t('s5.all.docks')}</th>
                <th className="n">{t('s5.all.bikes')}</th>
                <th className="n">{t('s5.all.trucks')}</th>
                <th className="n">{t('s5.all.pertrip')}</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((s) => {
                const p = s.paper;
                const name = `${scenName(s, t)}${s.axisLabel ? ` · ${s.axisLabel}` : ''}`;
                if (!p) {
                  return (
                    <tr className="pend" key={s.id}>
                      <td>{name}</td>
                      <td className="n" colSpan={9}>
                        {t('pending.row')}
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={s.id}>
                    <td>
                      {name}
                      {s.legacy && <span className="legacychip">{t('s3.legacy')}</span>}
                    </td>
                    <td className="n">{fmtEur(p.budgetEur)}</td>
                    <td className="n">{fmtPct(lang, p.servedRatio, 0)}</td>
                    <td className="n">{fmtPct(lang, p.ptAssistedShare, 0)}</td>
                    <td className="n">{fmtNum(lang, p.avgTimeGainMin, 1)}</td>
                    <td className="n">{fmtInt(p.stations)}</td>
                    <td className="n">{fmtInt(p.docks)}</td>
                    <td className="n">{fmtInt(p.bikes)}</td>
                    <td className="n">{fmtInt(p.dispatchCostEur)}</td>
                    <td className="n">{fmtInt(p.investmentPerServedTripEur)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note">{t('s5.all.note')}</p>
      </div>

      <button className="cta" onClick={onRestart}>
        {t('s5.cta')}
      </button>
    </>
  );
}
