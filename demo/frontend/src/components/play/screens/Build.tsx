import { useState } from 'react';
import { fmtEur, fmtInt, fmtPct } from '../../../lib/format';
import type { T } from '../../../lib/i18n';
import type { Lang } from '../../../lib/types';
import type { ModelConstants } from '../../../domain/evaluation/types';
import type { BudgetState } from '../../../domain/placement/budget';
import type { ReachState, TapDetail } from '../../../hooks/usePlacement';

/**
 * Step 2 — the panel beside the map while the visitor places stations.
 *
 * The felt constraint is money, not the station cap: at the shipped budgets
 * the cap never binds (100 candidates against 100 to 600 affordable), so what
 * matters, and what is therefore the big number here, is what is LEFT for
 * docks and bikes (plan.md §2bis: "the meter is the core mechanic").
 *
 * `lowRemaining` — when that number turns red — is the cost of five more docks
 * and three more bikes per station already placed: below it the model can no
 * longer put a usable amount of stock behind the layout. It is computed from
 * the unit costs the export carries, never from a literal.
 *
 * The reach read-out says "within reach" and never "served": reach
 * overestimates service by up to 1.9x at 20 k€ (domain/placement/reach.ts).
 */
export function lowRemaining(constants: ModelConstants, placed: number): number {
  return placed * (5 * constants.dock_cost + 3 * constants.unit_bike_cost);
}

export default function Build({
  meter,
  constants,
  reach,
  demandTotal,
  byMe,
  byAssistant,
  canUndo,
  roomLeft,
  lastTap,
  playing,
  periodName,
  onAssist,
  onUndo,
  onClear,
  onTogglePlay,
  t,
  lang,
}: {
  meter: BudgetState;
  constants: ModelConstants;
  reach: ReachState;
  demandTotal: number;
  byMe: number;
  byAssistant: number;
  canUndo: boolean;
  roomLeft: number;
  lastTap: TapDetail | null;
  playing: boolean;
  periodName: string;
  onAssist: (n: number) => void;
  onUndo: () => void;
  onClear: () => void;
  onTogglePlay: () => void;
  t: T;
  lang: Lang;
}) {
  const [assistN, setAssistN] = useState(10);
  const low = meter.remainingEur < lowRemaining(constants, meter.placed);
  const maxAssist = Math.max(1, Math.min(roomLeft, 60));

  const tapNote =
    lastTap?.outcome === 'ambiguous'
      ? t('play.build.tap.ambiguous')
      : lastTap?.outcome === 'refused'
        ? t(lastTap.reasonKey ?? 'play.build.tap.refused')
        : null;

  return (
    <>
      <h2 className="playh2">{t('play.build.title')}</h2>

      <p className="playmeter">
        <b className="mono">{fmtInt(meter.placed)}</b> {t('play.build.stations')} ·{' '}
        <b className="mono">{fmtEur(meter.stationsEur)}</b> {t('play.build.onstations')}
      </p>
      <p className={`playleft${low ? ' low' : ''}${meter.overBudget ? ' over' : ''}`}>
        <b className="mono">{fmtEur(Math.max(0, meter.remainingEur))}</b>{' '}
        <span>{t('play.build.leftfor')}</span>
      </p>
      {low && !meter.overBudget && <p className="note playwarn">{t('play.build.lowwarn')}</p>}
      {meter.overBudget && <p className="note playwarn">{t('play.build.overwarn')}</p>}

      <p className="playreach">
        <b className="mono">{fmtInt(reach.flow)}</b>{' '}
        <span>
          {t('play.build.reach', {
            total: fmtInt(demandTotal),
            pct: fmtPct(lang, reach.share, 0),
          })}
        </span>
      </p>
      <p className="note">{t('play.build.reachnote')}</p>

      <div className="playassist card">
        <p className="decklab">{t('play.build.assist')}</p>
        <div className="playassistrow">
          <input
            type="range"
            min={1}
            max={maxAssist}
            value={Math.min(assistN, maxAssist)}
            onChange={(e) => setAssistN(Number(e.target.value))}
            aria-label={t('play.build.assistcount')}
          />
          <span className="mono playassistn">{Math.min(assistN, maxAssist)}</span>
          <button className="ghostbtn" onClick={() => onAssist(Math.min(assistN, maxAssist))} disabled={roomLeft <= 0}>
            {t('play.build.assistcta')}
          </button>
        </div>
        <p className="note">{t('play.build.assistnote')}</p>
      </div>

      <div className="playrow">
        <button className="ghostbtn" onClick={onUndo} disabled={!canUndo}>
          ↶ {t('play.build.undo')}
        </button>
        <button className="ghostbtn" onClick={onClear} disabled={meter.placed === 0}>
          {t('play.build.clear')}
        </button>
        <button className="ghostbtn playplay" onClick={onTogglePlay} aria-pressed={playing}>
          {playing ? '❚❚' : '▶'} {t('play.build.watch')}
          <span className="playperiod">{periodName}</span>
        </button>
      </div>

      {tapNote && <p className="note playwarn">{tapNote}</p>}
      <p className="note">{t('play.build.hint')}</p>
      <p className="note playwho">
        {t('play.build.who', { me: fmtInt(byMe), assistant: fmtInt(byAssistant) })}
      </p>
    </>
  );
}
