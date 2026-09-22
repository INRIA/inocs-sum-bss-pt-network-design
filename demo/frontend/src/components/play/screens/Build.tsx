import type { ReactNode } from "react";
import { fmtEur, fmtInt, fmtPct, hh } from "../../../lib/format";
import type { T } from "../../../lib/i18n";
import type { Lang } from "../../../lib/types";
import type { ModelConstants } from "../../../domain/evaluation/types";
import type { BudgetState } from "../../../domain/placement/budget";
import type { ReachState, TapDetail } from "../../../hooks/usePlacement";

/**
 * Step 1, second part — the panel beside the map while the visitor places stations.
 *
 * The felt constraint is money, not the station cap: at the shipped budgets
 * the cap never binds (100 candidates against 100 to 600 affordable), so what
 * matters, and what is therefore the big number here, is what is LEFT for
 * docks and bikes (plan.md §2bis: "the meter is the core mechanic").
 *
 * A choice is only meaningful if its trade-off is visible BEFORE it is made,
 * so all three read-outs are predictive: the reach bar shows how far the
 * layout is from covering the city, the assistant says where its N stations
 * would take that bar before it places any of them, and the "money left" hint
 * says plainly how little stock each station would get. None of them
 * prescribes a number of stations.
 *
 * `lowRemaining` — when that number turns red — is the cost of five more docks
 * and three more bikes per station already placed: below it the model can no
 * longer put a usable amount of stock behind the layout. It is computed from
 * the unit costs the export carries, never from a literal.
 *
 * The reach read-out says "within reach" and never "served": reach
 * overestimates service by up to 1.9x at 20 k€ (domain/placement/reach.ts).
 */
export function lowRemaining(
  constants: ModelConstants,
  placed: number,
): number {
  return placed * (5 * constants.dock_cost + 3 * constants.unit_bike_cost);
}

/** What one more euro of the remaining budget buys each station already placed. */
export function perStationLeft(remainingEur: number, placed: number): number {
  return placed > 0 ? Math.max(0, remainingEur) / placed : 0;
}

/** How many stations one press of the random button places. */
export const RANDOM_BATCH = 10;

/**
 * Back, play/pause, forward, then the day's timeline and clock to the right.
 * Back and forward move one hour and pause the clock (the visitor is looking
 * at that hour); the slider does the same.
 */
export function DayTransport({
  label,
  playing,
  hour,
  periodName,
  onTogglePlay,
  onSeekHour,
  t,
}: {
  label?: string;
  playing: boolean;
  hour: number;
  periodName: string;
  onTogglePlay: () => void;
  onSeekHour: (hour: number) => void;
  t: T;
}) {
  return (
    <div
      className="playtransport"
      role="group"
      aria-label={t("play.build.watch")}
    >
      <span className="playtlabel">{label ?? t("play.build.moveslabel")}</span>
      <button
        className="ghostbtn playtbtn"
        onClick={() => onSeekHour(hour - 1)}
        aria-label={t("play.build.hourback")}
      >
        ◀
      </button>
      <button
        className="ghostbtn playtbtn playplay"
        onClick={onTogglePlay}
        aria-pressed={playing}
        aria-label={t("play.build.watch")}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <button
        className="ghostbtn playtbtn"
        onClick={() => onSeekHour(hour + 1)}
        aria-label={t("play.build.hourfwd")}
      >
        ▶▶
      </button>
      <input
        className="playtimeline"
        type="range"
        min={0}
        max={23}
        value={hour}
        onChange={(e) => onSeekHour(Number(e.target.value))}
        aria-label={t("s2.hour.aria")}
      />
      <span className="playclock mono">
        {hh(hour)}
        <span className="playperiod">{periodName}</span>
      </span>
    </div>
  );
}

export default function Build({
  top,
  meter,
  constants,
  reach,
  demandTotal,
  byMe,
  byAssistant,
  canUndo,
  roomLeft,
  freeLeft,
  compact,
  lastTap,
  playing,
  hour,
  periodName,
  onSeekHour,
  onPlaceRandom,
  onUndo,
  onClear,
  onTogglePlay,
  t,
  lang,
}: {
  /** The instructions and budget cards: first in the panel, right under the phone's peek bar. */
  top: ReactNode;
  meter: BudgetState;
  constants: ModelConstants;
  reach: ReachState;
  demandTotal: number;
  byMe: number;
  byAssistant: number;
  canUndo: boolean;
  roomLeft: number;
  /** Candidate sites nobody has taken yet: the assistant cannot offer more. */
  freeLeft: number;
  /** The sheet layout: the peek bar exists, and the controls it carries are not repeated. */
  compact: boolean;
  lastTap: TapDetail | null;
  playing: boolean;
  /** The day clock (0-23) the city pulse follows. */
  hour: number;
  periodName: string;
  onSeekHour: (hour: number) => void;
  onPlaceRandom: (n: number) => void;
  onUndo: () => void;
  onClear: () => void;
  onTogglePlay: () => void;
  t: T;
  lang: Lang;
}) {
  const low = meter.remainingEur < lowRemaining(constants, meter.placed);
  // The button places what is affordable and free, up to a batch; disabled
  // when nothing more can be placed.
  const canRandom = Math.min(roomLeft, freeLeft) > 0;
  const remaining = Math.max(0, meter.maxStations - meter.placed);
  const fill =
    meter.maxStations > 0
      ? Math.min(100, Math.round((meter.placed / meter.maxStations) * 100))
      : 0;

  const tapNote =
    lastTap?.outcome === "ambiguous"
      ? t("play.build.tap.ambiguous")
      : lastTap?.outcome === "refused"
        ? t(lastTap.reasonKey ?? "play.build.tap.refused")
        : null;

  return (
    <>
      {/* Pinned in the peek area on a phone: one meter line and the three
          controls the map needs. Everything below is the same panel, for a
          visitor who drags the sheet up. Hidden on a desktop (play.css). */}
      {compact && (
        <div className="playpeekbar">
          <p className="playpeekline">
            <b className="mono">{fmtInt(meter.placed)}</b>{" "}
            {t("play.build.stations")} ·{" "}
            <b className="mono">{fmtEur(Math.max(0, meter.remainingEur))}</b>{" "}
            {t("play.build.peekleft")} ·{" "}
            <b className="mono">{fmtPct(lang, reach.share, 0)}</b>{" "}
            {t("play.build.peekreach")}
          </p>
          <div className="playpeekchips">
            <button
              className="ghostbtn"
              onClick={() => onPlaceRandom(RANDOM_BATCH)}
              disabled={!canRandom}
            >
              {t("play.build.assistcta", { n: RANDOM_BATCH })}
            </button>
            <button className="ghostbtn" onClick={onUndo} disabled={!canUndo}>
              ↶ {t("play.build.undo")}
            </button>
          </div>
          <DayTransport
            playing={playing}
            hour={hour}
            periodName={periodName}
            onTogglePlay={onTogglePlay}
            onSeekHour={onSeekHour}
            t={t}
          />
        </div>
      )}

      {top}

      <h2 className="playh2">{t("play.build.title")}</h2>

      <div className="playbuildrow">
        <div className="playcounter">
          <div
            className="playcounterring"
            role="img"
            aria-label={`${fmtInt(meter.placed)} / ${fmtInt(meter.maxStations)} ${t("play.build.stations")}`}
          >
            <b className="mono">{fmtInt(meter.placed)}</b>
            <span className="mono">/ {fmtInt(meter.maxStations)}</span>
          </div>
          <p className="playcounterlab">
            <b className="mono">{fmtInt(remaining)}</b>{" "}
            {t("play.build.remaining")}
            <span className="playcounterspent">
              <b className="mono">{fmtEur(meter.stationsEur)}</b>{" "}
              {t("play.build.onstations")}
            </span>
          </p>
        </div>

        <div className="playassist">
          <button
            className="ghostbtn"
            onClick={() => onPlaceRandom(RANDOM_BATCH)}
            disabled={!canRandom}
          >
            {t("play.build.assistcta", { n: RANDOM_BATCH })}
          </button>
        </div>

        <div className="playrow">
          {!compact && (
            <button className="ghostbtn" onClick={onUndo} disabled={!canUndo}>
              ↶ {t("play.build.undo")}
            </button>
          )}
          <button
            className="ghostbtn"
            onClick={onClear}
            disabled={meter.placed === 0}
          >
            {t("play.build.clear")}
          </button>
        </div>
      </div>
      {low && !meter.overBudget && (
        <p className="note playwarn">
          {t("play.build.lowwarn", {
            each: fmtEur(perStationLeft(meter.remainingEur, meter.placed)),
          })}
        </p>
      )}
      {meter.overBudget && (
        <p className="note playwarn">{t("play.build.overwarn")}</p>
      )}

      {!compact && (
        <DayTransport
          playing={playing}
          hour={hour}
          periodName={periodName}
          onTogglePlay={onTogglePlay}
          onSeekHour={onSeekHour}
          t={t}
        />
      )}

      {tapNote && <p className="note playwarn">{tapNote}</p>}
      <p className="note">{t("play.build.hint")}</p>
      <p className="note playwho">
        {t("play.build.who", {
          me: fmtInt(byMe),
          assistant: fmtInt(byAssistant),
        })}
      </p>
    </>
  );
}
