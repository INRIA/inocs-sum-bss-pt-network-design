import { useRef, useState } from "react";
import { fmtEur, fmtInt, fmtPct } from "../../../lib/format";
import type { T } from "../../../lib/i18n";
import type { Lang } from "../../../lib/types";
import type { ModelConstants } from "../../../domain/evaluation/types";
import type { BudgetState } from "../../../domain/placement/budget";
import type { ReachState, TapDetail } from "../../../hooks/usePlacement";
import { requestSnap } from "../sheetBus";

/**
 * Step 2 — the panel beside the map while the visitor places stations.
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

/** The assistant's slider starts here, and is clamped by what is still free and affordable. */
export const ASSIST_DEFAULT = 20;

export default function Build({
  meter,
  constants,
  reach,
  demandTotal,
  byMe,
  byAssistant,
  canUndo,
  roomLeft,
  freeLeft,
  previewReach,
  compact,
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
  /** Candidate sites nobody has taken yet: the assistant cannot offer more. */
  freeLeft: number;
  /** Share of the day's demand the layout plus the assistant's next `n` would reach. */
  previewReach: (n: number) => number;
  /** The sheet layout: the peek bar exists, and the controls it carries are not repeated. */
  compact: boolean;
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
  const [assistN, setAssistN] = useState(ASSIST_DEFAULT);
  const sliderRef = useRef<HTMLInputElement | null>(null);
  const low = meter.remainingEur < lowRemaining(constants, meter.placed);
  // The slider offers exactly what the assistant could actually place: free
  // sites the budget still covers, never a fixed 10 or 20.
  const maxAssist = Math.max(1, Math.min(roomLeft, freeLeft));
  const n = Math.min(assistN, maxAssist);
  const preview = previewReach(n);

  const tapNote =
    lastTap?.outcome === "ambiguous"
      ? t("play.build.tap.ambiguous")
      : lastTap?.outcome === "refused"
        ? t(lastTap.reasonKey ?? "play.build.tap.refused")
        : null;

  /** The chip in the peek area: open the sheet far enough to show the slider, then focus it. */
  const openAssistant = (): void => {
    requestSnap("half");
    window.setTimeout(() => sliderRef.current?.focus(), 280);
  };

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
              onClick={openAssistant}
              disabled={roomLeft <= 0}
            >
              {t("play.build.assist")}
            </button>
            <button className="ghostbtn" onClick={onUndo} disabled={!canUndo}>
              ↶ {t("play.build.undo")}
            </button>
            <button
              className="ghostbtn playplay"
              onClick={onTogglePlay}
              aria-pressed={playing}
            >
              {playing ? "❚❚" : "▶"} {t("play.build.watch")}
            </button>
          </div>
        </div>
      )}

      <h2 className="playh2">{t("play.build.title")}</h2>

      <p className="playmeter">
        <b className="mono">{fmtInt(meter.placed)}</b>{" "}
        {t("play.build.stations")} ·{" "}
        <b className="mono">{fmtEur(meter.stationsEur)}</b>{" "}
        {t("play.build.onstations")}
      </p>
      <p
        className={`playleft${low ? " low" : ""}${meter.overBudget ? " over" : ""}`}
      >
        <b className="mono">{fmtEur(Math.max(0, meter.remainingEur))}</b>{" "}
        <span>{t("play.build.leftfor")}</span>
      </p>
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

      <p className="playreach">
        <b className="mono">{fmtInt(reach.flow)}</b>{" "}
        <span>
          {t("play.build.reach", {
            total: fmtInt(demandTotal),
            pct: fmtPct(lang, reach.share, 0),
          })}
        </span>
      </p>
      <div
        className="playreachbar"
        role="img"
        aria-label={t("play.build.reach", {
          total: fmtInt(demandTotal),
          pct: fmtPct(lang, reach.share, 0),
        })}
      >
        <i
          style={{ width: `${Math.min(100, Math.round(reach.share * 100))}%` }}
        />
      </div>
      <p className="note playreachcap">{t("play.build.reachcap")}</p>
      <p className="note">{t("play.build.reachnote")}</p>

      <div className="playassist card">
        <p className="decklab">{t("play.build.assist")}</p>
        <div className="playassistrow">
          <input
            ref={sliderRef}
            type="range"
            min={1}
            max={maxAssist}
            value={n}
            onChange={(e) => setAssistN(Number(e.target.value))}
            aria-label={t("play.build.assistcount")}
          />
          <span className="mono playassistn">{n}</span>
          <button
            className="ghostbtn"
            onClick={() => onAssist(n)}
            disabled={roomLeft <= 0}
          >
            {t("play.build.assistcta")}
          </button>
        </div>
        <p className="playassistpreview">
          {t("play.build.assistpreview", { pct: fmtPct(lang, preview, 0) })}
        </p>
        <p className="note">{t("play.build.assistnote")}</p>
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
        {!compact && (
          <button
            className="ghostbtn playplay"
            onClick={onTogglePlay}
            aria-pressed={playing}
          >
            {playing ? "❚❚" : "▶"} {t("play.build.watch")}
            <span className="playperiod">{periodName}</span>
          </button>
        )}
        {compact && <span className="playperiod">{periodName}</span>}
      </div>

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
