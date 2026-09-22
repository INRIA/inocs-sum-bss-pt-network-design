import { useState } from 'react';

import type { BuiltFacts } from '../../../domain/game/results';
import { fmtEur, fmtInt } from '../../../lib/format';
import type { T } from '../../../lib/i18n';

/**
 * "What you built" — the procurement recap, in the map's overlay slot.
 *
 * plan-technical §B.4: results never shrink the map, so they sit in the
 * existing closable box over it (`resbtn` / `respanel`, the convention
 * `MapPanel` already uses in the full demo). It is an input recap, not a KPI
 * (plan.md §5), which is exactly why it lives here and not among the tiles.
 */
export default function BuiltBox({
  facts,
  title,
  t,
}: {
  facts: BuiltFacts;
  /** "Your network" on step 4, "The optimiser's network" on step 5. */
  title: string;
  t: T;
}) {
  const [open, setOpen] = useState(false);
  const rows: [string, string][] = [
    [fmtInt(facts.stations), t('leg.stations')],
    [fmtInt(facts.atPtStops), t('leg.atpt')],
  ];
  return (
    <>
      <button
        className="resbtn"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="playbuiltbox"
      >
        <span>{title}</span>
        <b aria-hidden="true">{open ? '▾' : '▴'}</b>
      </button>
      {open && (
        <section className="respanel" id="playbuiltbox" aria-label={title}>
          <div className="reshead">
            <b>{title}</b>
            <button className="resclose" onClick={() => setOpen(false)} aria-label={t('map.results.hide')}>
              ×
            </button>
          </div>
          <div className="netfacts resfacts">
            {rows.map(([value, label]) => (
              <div className="card fact" key={label}>
                <b className="mono">{value}</b>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
