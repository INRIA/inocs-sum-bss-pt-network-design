import { useState } from 'react';
import { TRACKER, canEnter, progress, type GameStep } from '../../domain/game/steps';
import type { Session } from '../../domain/game/session';
import type { T } from '../../lib/i18n';

/**
 * The progress tracker AS navigation (UX reference §2).
 *
 * Six worded steps on a connecting line; done / current / upcoming read from
 * colour, icon AND the line, so no legend is needed. A small bike carries the
 * global progress (`progress(session).overall`) and slides with a CSS
 * transition, frozen under `prefers-reduced-motion` (play.css).
 *
 * A step the session may enter is a button. A locked one is NOT a control at
 * all — it renders as a span, so nothing focusable promises something the
 * guard would refuse — and carries the guard's own reason as its title and
 * `aria-description`.
 *
 * On a phone the whole thing collapses to "2 of 6 · Build" over a thin bar
 * (plan-technical §B.1); tapping it opens the full route as a list.
 */
export default function Tracker({
  session,
  onGo,
  onBack,
  demoUrl,
  compact,
  t,
}: {
  session: Session;
  onGo: (step: GameStep) => void;
  onBack: (() => void) | null;
  demoUrl: string;
  compact: boolean;
  t: T;
}) {
  const [routeOpen, setRouteOpen] = useState(false);
  const p = progress(session);
  const current = session.step;
  const currentIndex = TRACKER.findIndex((step) => step.id === current);
  const shownIndex = currentIndex < 0 ? 0 : currentIndex;

  const state = (index: number): 'done' | 'current' | 'upcoming' =>
    index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming';

  const steps = TRACKER.map((step, index) => {
    const guard = canEnter(step.id, session);
    return { step, index, guard, state: state(index) };
  });

  const offramps = (
    <div className="playoff">
      {onBack && (
        <button className="playoffbtn" onClick={onBack}>
          ← {t('play.nav.back')}
        </button>
      )}
      <a className="playoffbtn" href={demoUrl}>
        {t('play.nav.demo')}
      </a>
    </div>
  );

  if (compact) {
    return (
      <nav className="tracker compact" aria-label={t('play.tracker.aria')}>
        <div className="trackrow">
          <button
            className="trackline"
            aria-expanded={routeOpen}
            onClick={() => setRouteOpen((open) => !open)}
          >
            <span className="trackpos">
              {t('play.tracker.position', {
                n: shownIndex + 1,
                total: TRACKER.length,
                label: t(TRACKER[shownIndex]!.labelKey),
              })}
            </span>
            <span className="trackchev" aria-hidden="true">
              {routeOpen ? '▲' : '▼'}
            </span>
          </button>
          {offramps}
        </div>
        <div className="trackbar">
          <span className="trackfill" style={{ width: `${Math.round(p.overall * 100)}%` }} />
        </div>
        {routeOpen && (
          <ol className="trackroute">
            {steps.map(({ step, index, guard, state: how }) => (
              <li key={step.id} className={`trackitem ${how}${guard.ok ? '' : ' locked'}`}>
                {guard.ok ? (
                  <button
                    onClick={() => {
                      setRouteOpen(false);
                      onGo(step.id);
                    }}
                  >
                    <span className="trackno">{index + 1}</span>
                    <span className="tracklab">{t(step.labelKey)}</span>
                    <span className="trackverb">{t(step.rhythmKey)}</span>
                  </button>
                ) : (
                  <span title={t(guard.reasonKey)} aria-description={t(guard.reasonKey)}>
                    <span className="trackno" aria-hidden="true">
                      🔒
                    </span>
                    <span className="tracklab">{t(step.labelKey)}</span>
                    <span className="trackverb">{t(guard.reasonKey)}</span>
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </nav>
    );
  }

  return (
    <nav className="tracker" aria-label={t('play.tracker.aria')}>
      <ol className="tracksteps">
        <span className="trackrail" aria-hidden="true">
          <span className="trackrailfill" style={{ width: `${Math.round(p.overall * 100)}%` }} />
          <span className="trackbike" style={{ left: `${Math.round(p.overall * 100)}%` }}>
            🚲
          </span>
        </span>
        {steps.map(({ step, index, guard, state: how }) => (
          <li key={step.id} className={`trackitem ${how}${guard.ok ? '' : ' locked'}`}>
            {guard.ok ? (
              <button onClick={() => onGo(step.id)} aria-current={how === 'current' ? 'step' : undefined}>
                <span className="trackno" aria-hidden="true">
                  {how === 'done' ? '✓' : index + 1}
                </span>
                <span className="tracklab">{t(step.labelKey)}</span>
              </button>
            ) : (
              <span title={t(guard.reasonKey)} aria-description={t(guard.reasonKey)}>
                <span className="trackno" aria-hidden="true">
                  🔒
                </span>
                <span className="tracklab">{t(step.labelKey)}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
      {offramps}
    </nav>
  );
}
