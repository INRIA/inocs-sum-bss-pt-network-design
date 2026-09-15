import type { T } from '../lib/i18n';
import { fmtInt, fmtNum, fmtPct } from '../lib/format';
import type { Lang, ScenarioData } from '../lib/types';

/**
 * The demo-side stress test (plan.md section 5): the stdlib simulator replays the trips Geneva
 * actually recorded against the built network. It is NOT part of the paper, and the table says so
 * in its own header. A run without `sim_<day>.json` simply has no rows.
 */
export default function StressTable({ sc, t, lang }: { sc: ScenarioData; t: T; lang: Lang }) {
  if (!sc.stressTest.length) return <p className="note">{t('s4.stress.none')}</p>;
  return (
    <div className="tw">
      <table>
        <thead>
          <tr>
            <th>{t('s4.stress.h')}</th>
            <th className="n">{t('s4.stress.trips')}</th>
            <th className="n">{t('s4.stress.served')}</th>
            <th className="n">{t('s4.stress.nostation')}</th>
            <th className="n">{t('s4.stress.nobike')}</th>
            <th className="n">{t('s4.stress.nodock')}</th>
          </tr>
        </thead>
        <tbody>
          {sc.stressTest.map((d) => (
            <tr key={d.day}>
              <td>{t(`s4.stress.day.${d.day}`, { n: fmtInt(d.nDaysReplayed) })}</td>
              <td className="n">{fmtNum(lang, d.demand, 2)}</td>
              <td className="n">{fmtPct(lang, d.servedRatio, 1)}</td>
              <td className="n">{fmtNum(lang, d.noStation, 2)}</td>
              <td className="n">{fmtNum(lang, d.noBike, 2)}</td>
              <td className="n">{fmtNum(lang, d.noDock, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
