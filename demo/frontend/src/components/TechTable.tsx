import { Fragment } from 'react';
import type { T } from '../lib/i18n';
import { TECH, techCell } from '../lib/tech';
import { scenName } from '../lib/scen';
import { fmtEur } from '../lib/format';
import type { Lang, ScenarioData } from '../lib/types';

/**
 * The advanced technical tables (plan.md section 6b): the model's own evaluator row, grouped by
 * the paper section that discusses each block. Step 4 shows one column (the current plan), step 5
 * one column per plan with results. A metric a run did not produce renders as "—".
 */
function GroupHead({ id, span, t }: { id: string; span: number; t: T }) {
  return (
    <tr className="grp">
      <th colSpan={span}>
        {t(`tech.g.${id}`)}
        <span className="ref">{t('tech.paper', { ref: t(`tech.ref.${id}`) })}</span>
      </th>
    </tr>
  );
}

export function TechTable({ sc, t, lang }: { sc: ScenarioData; t: T; lang: Lang }) {
  return (
    <div className="tw">
      <table className="tech">
        <tbody>
          {TECH.map((g) => (
            <Fragment key={g.id}>
              <GroupHead id={g.id} span={2} t={t} />
              {g.rows.map((row) => (
                <tr key={row.key}>
                  <td>{t(`tech.m.${row.key}`)}</td>
                  <td className="n">{techCell(sc, row, lang)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TechCompare({ scenarios, t, lang }: { scenarios: ScenarioData[]; t: T; lang: Lang }) {
  if (!scenarios.length) return <p className="note">{t('s5.tech.none')}</p>;
  return (
    <div className="tw">
      <table className="tech">
        <thead>
          <tr>
            <th>{t('tech.metric')}</th>
            {scenarios.map((s) => (
              <th className="n" key={s.id}>
                {scenName(s, t)}
                <span className="ref">{s.axisLabel || fmtEur(s.params.budget)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TECH.map((g) => (
            <Fragment key={g.id}>
              <GroupHead id={g.id} span={scenarios.length + 1} t={t} />
              {g.rows.map((row) => (
                <tr key={row.key}>
                  <td>{t(`tech.m.${row.key}`)}</td>
                  {scenarios.map((s) => (
                    <td className="n" key={s.id}>
                      {techCell(s, row, lang)}
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
