import type { ScenarioData } from '../lib/types';
import type { T } from '../lib/i18n';
import { fmtInt } from '../lib/format';

/**
 * "What you built": the four physical facts of the network (ux-plan-v2 section 4.3), read from the
 * model's own solution. They live under the map on desktop and fold into the top of the step-4
 * sheet on mobile (section 6, note 1) — one component so the two placements can never drift apart.
 */
export default function NetFacts({ sc, t, className = '' }: { sc: ScenarioData; t: T; className?: string }) {
  const p = sc.paper;
  const facts: [string, string][] = [
    [fmtInt(p?.stations ?? sc.stations.length), t('leg.stations')],
    [fmtInt(p?.nTrans ?? sc.stations.filter((s) => s.transfer).length), t('leg.atpt')],
    [fmtInt(p?.docks ?? 0), t('leg.docks')],
    [fmtInt(p?.bikes ?? 0), t('leg.bikes')],
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
