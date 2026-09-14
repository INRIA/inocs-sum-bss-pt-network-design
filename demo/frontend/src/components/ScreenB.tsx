import type { GameData, Lang, Weekday } from '../lib/types';
import type { T } from '../lib/i18n';
import { fmtInt, fmtNum, hh } from '../lib/format';

/** Insight-strip hour buckets (mockup `updateHourUI`) — authored copy describing a pattern. */
const bucket = (weekday: Weekday, h: number) =>
  weekday === 'mon' ? (h < 6 ? 0 : h < 10 ? 1 : h < 16 ? 2 : h < 20 ? 3 : 4) : h < 9 ? 0 : h < 15 ? 1 : h < 20 ? 2 : 3;

/**
 * Step B — watch the city (ux-plan section 2, amended by v2 section 3). The exploration deck lives
 * here, not under the map: day toggle, play, hour scrubber and the insight line drive the map's
 * live mode from inside the step. There are no layer buttons here — the legend bars own that
 * (v2 section 4.2).
 */
export default function ScreenB({
  data,
  t,
  lang,
  weekday,
  hour,
  playing,
  onWeekday,
  onHour,
  onTogglePlay,
  onNext,
}: {
  data: GameData;
  t: T;
  lang: Lang;
  weekday: Weekday;
  hour: number;
  playing: boolean;
  onWeekday: (w: Weekday) => void;
  onHour: (h: number) => void;
  onTogglePlay: () => void;
  onNext: () => void;
}) {
  // Screen B's fact tiles summarise the whole dataset — they never move with the scrubber.
  const anyScenario = data.scenarios[0];
  const observedTrips = anyScenario?.days.monday?.kpi?.service?.demand_trips;

  return (
    <>
      <p className="eyebrow">{t('b.eyebrow')}</p>
      <h2>{t('b.title')}</h2>
      <p className="lede">{t('b.lede2')}</p>

      <div className="facts">
        <div className="fact">
          <b className="mono">{fmtInt(data.city.ptBoardings.monday ?? 0)}</b>
          <span>{t('b.f1', { sun: fmtInt(data.city.ptBoardings.sunday ?? 0) })}</span>
        </div>
        <div className="fact">
          <b className="mono">{observedTrips != null ? fmtNum(lang, observedTrips) : '—'}</b>
          <span>{t('b.f2')}</span>
        </div>
        <div className="fact">
          <b className="mono">{t('b.f3.v')}</b>
          <span>{t('b.f3')}</span>
        </div>
        <div className="fact">
          <b className="mono">{fmtNum(lang, data.city.medianTripKm, 2)} km</b>
          <span>{t('b.f4')}</span>
        </div>
      </div>

      <div className="deck">
        <p className="decklab">{t('b.deck')}</p>
        <div className="dockline">
          <div className="seg" role="group" aria-label={t('b.day.aria')}>
            <button aria-pressed={weekday === 'mon'} onClick={() => onWeekday('mon')}>
              {t('day.mon')}
            </button>
            <button aria-pressed={weekday === 'sun'} onClick={() => onWeekday('sun')}>
              {t('day.sun')}
            </button>
          </div>
          <button className="play" onClick={onTogglePlay} aria-label={t('b.play.aria')}>
            {playing ? '⏸' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={23}
            value={hour}
            aria-label={t('b.hour.aria')}
            onChange={(e) => onHour(+e.target.value)}
          />
          <span className="hourlbl mono">
            {hh(hour)} · {t(weekday === 'mon' ? 'day.mon' : 'day.sun')}
          </span>
        </div>
        <div className="dockline2">
          <p className="insight">
            <span className="tick">●</span>
            <span>{t(`b.ins.${weekday}.${bucket(weekday, hour)}`)}</span>
          </p>
        </div>
      </div>

      <p className="note">{t('b.note')}</p>

      <button className="cta go" onClick={onNext}>
        {t('b.cta')}
      </button>
    </>
  );
}
