import type { T } from '../lib/i18n';
import { baselineOf } from '../lib/families';
import { fmtInt, fmtNum, fmtPct, hh, hlabel } from '../lib/format';
import type { GameData, Lang, Weekday } from '../lib/types';

/** Insight-strip hour buckets (mockup `updateHourUI`) — authored copy describing a pattern. */
const bucket = (weekday: Weekday, h: number) =>
  weekday === 'mon' ? (h < 6 ? 0 : h < 10 ? 1 : h < 16 ? 2 : h < 20 ? 3 : 4) : h < 9 ? 0 : h < 15 ? 1 : h < 20 ? 2 : 3;

/**
 * Step 2 — watch the city. Everything the v2 step had is kept (fact tiles, Monday/Sunday toggle,
 * play button, hour scrubber, insight line; the stop bubbles are on the map) and the bridge to the
 * model is added: the same day as the three periods the optimiser actually solves, with the
 * observed weights of the selected day type (profiles.json) and the paper's baseline profile.
 */
export default function Step2({
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
  const dayKey = weekday === 'mon' ? 'weekday' : 'sunday';
  const weights = data.city.periodWeights[dayKey] ?? [];
  const bounds = data.city.periodBounds;
  const observed = data.city.tripsPerDayObserved[dayKey];
  const baseline = baselineOf(data.scenarios);

  const periodLabel = (i: number) =>
    bounds[i] ? t(`s2.per.${i}`, { a: hlabel(bounds[i][0]), b: hlabel(bounds[i][1]) }) : `${i + 1}`;

  return (
    <>
      <p className="eyebrow">{t('s2.eyebrow')}</p>
      <h2>{t('s2.title')}</h2>
      <p className="lede">{t('s2.lede')}</p>

      <div className="facts facts-row">
        <div className="fact">
          <b className="mono">{fmtInt(data.city.ptBoardings.monday ?? 0)}</b>
          <span>{t('s2.f1', { sun: fmtInt(data.city.ptBoardings.sunday ?? 0) })}</span>
        </div>
        <div className="fact">
          <b className="mono">{t('s2.f2.v')}</b>
          <span>{t('s2.f2')}</span>
        </div>
        <div className="fact">
          <b className="mono">{fmtNum(lang, data.city.medianTripKm, 2)} km</b>
          <span>{t('s2.f3')}</span>
        </div>
        <div className="fact">
          <b className="mono">{observed != null ? fmtNum(lang, observed, 1) : '—'}</b>
          <span>{t('s2.f4')}</span>
        </div>
      </div>

      <div className="deck">
        <p className="decklab">{t('s2.deck')}</p>
        <div className="dockline">
          <div className="seg" role="group" aria-label={t('s2.day.aria')}>
            <button aria-pressed={weekday === 'mon'} onClick={() => onWeekday('mon')}>
              {t('day.mon')}
            </button>
            <button aria-pressed={weekday === 'sun'} onClick={() => onWeekday('sun')}>
              {t('day.sun')}
            </button>
          </div>
          <button className="play" onClick={onTogglePlay} aria-label={t('s2.play.aria')}>
            {playing ? '⏸' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={23}
            value={hour}
            aria-label={t('s2.hour.aria')}
            onChange={(e) => onHour(+e.target.value)}
          />
          <span className="hourlbl mono">
            {hh(hour)} · {t(weekday === 'mon' ? 'day.mon' : 'day.sun')}
          </span>
        </div>
        <div className="dockline2">
          <p className="insight">
            <span className="tick">●</span>
            <span>{t(`s2.ins.${weekday}.${bucket(weekday, hour)}`)}</span>
          </p>
        </div>
      </div>

      <div className="modelbox">
        <p className="note" style={{ margin: 0 }} dangerouslySetInnerHTML={{ __html: t('s2.model.h') }} />
        <div className="periods">
          {weights.map((w, i) => (
            <div className="per" key={i}>
              <b className="mono">{fmtPct(lang, w, 0)}</b>
              <span>{periodLabel(i)}</span>
            </div>
          ))}
        </div>
        {baseline && baseline.params.periodWeights.length > 0 && (
          <p className="note" style={{ marginBottom: 0 }}>
            {t('s2.model.baseline', {
              w: baseline.params.periodWeights.map((w) => fmtPct(lang, w, 0)).join(' / '),
            })}
          </p>
        )}
      </div>

      <p className="note">{t('s2.note')}</p>

      <button className="cta go" onClick={onNext}>
        {t('s2.cta')}
      </button>
    </>
  );
}
