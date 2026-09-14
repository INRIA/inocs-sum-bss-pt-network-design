import type { ScenarioData } from '../lib/types';
import type { T } from '../lib/i18n';
import { fmtInt } from '../lib/format';

/**
 * "What you built": the four physical facts of the network (ux-plan-v2 section 4.3). They live
 * under the map on desktop and fold into the top of the D sheet on mobile (section 6, note 1) —
 * one component so the two placements can never drift apart. Performance KPIs stay in the left
 * column; these are never duplicated there.
 */
export default function NetFacts({ sc, day, t, className = '' }: { sc: ScenarioData; day: string; t: T; className?: string }) {
  const svc = sc.days[day]?.kpi?.service ?? {};
  const facts: [string, string][] = [
    [String(svc.stations ?? sc.stations.length), t('d.n.newstations')],
    [String(sc.transferCount), t('d.n.atpt')],
    [fmtInt(svc.docks ?? 0), t('d.n.docks')],
    [fmtInt(svc.bikes ?? 0), t('d.n.bikes')],
  ];
  return (
    <div className={`netfacts ${className}`.trim()}>
      {facts.map(([v, l]) => (
        <div className="card fact" key={l}>
          <b className="mono">{v}</b>
          <span>{l}</span>
        </div>
      ))}
    </div>
  );
}
