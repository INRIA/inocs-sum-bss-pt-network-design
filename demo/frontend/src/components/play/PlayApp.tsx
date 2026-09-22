import { useEffect, useMemo, useRef, useState } from 'react';

import { prevStep } from '../../domain/game/steps';
import type { GameData as EngineData } from '../../domain/evaluation/types';
import { useEvaluation } from '../../hooks/useEvaluation';
import { useGameSession } from '../../hooks/useGameSession';
import { useHashStep } from '../../hooks/useHashStep';
import { useViewport } from '../../hooks/useViewport';
import { EstimateEvaluator } from '../../infra/estimateEvaluator';
import { fetchGameFile, loadGameData } from '../../infra/gameData';
import { createSessionStore } from '../../infra/sessionStore';
import { createWorkerEvaluator, type WorkerEvaluator } from '../../infra/workerEvaluator';
import { makeT } from '../../lib/i18n';
import type { PlayData } from '../../lib/playData';
import type { GameData, Lang } from '../../lib/types';
import type { MapControls } from '../map/frame/MapFrame';
import StepShell from './StepShell';
import Tracker from './Tracker';
import { useStepContent } from './useStepContent';

/**
 * The game's composition root — and nothing else.
 *
 * It constructs the three implementations ONCE (the session store, the exact
 * evaluator in its worker, the estimate fallback), wires the hooks that carry
 * the rules, and renders the chrome. Every rule it appears to apply lives
 * somewhere else: the guards in `domain/game/steps.ts`, the state in
 * `session.ts`, the step's content in `useStepContent`, the layout in
 * `StepShell`. That is the shape plan-technical §C.4 asks for, without a
 * container: dependency inversion by construction, here.
 *
 * Nothing touches the network or a worker during the server render, and the
 * session hydrates after mount, so the first client markup matches the server's.
 */
/** The root type scale of guided mode, and where it is remembered. */
export type PlayScale = 'normal' | 'large';
const SCALE_KEY = 'sum.play.scale';

/**
 * Elements that own the arrow and space keys themselves: typing, choosing in a
 * select, dragging a slider, or moving between the map's candidate sites.
 */
export function ownsKeys(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((element as HTMLElement).isContentEditable) return true;
  return element.closest('.candidates') != null;
}

export default function PlayApp({
  data,
  play,
  baseUrl,
}: {
  data: GameData;
  play: PlayData;
  baseUrl: string;
}) {
  const [lang, setLang] = useState<Lang>('en');
  const t = useMemo(() => makeT(lang), [lang]);
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const store = useMemo(() => createSessionStore(), []);
  // `references.byBudget` is a Map, which island props do not carry: the page
  // ships the decoded entries as an array and the Map is rebuilt here, once.
  const references = useMemo(
    () => new Map(play.references.map((entry) => [entry.budgetEur, entry])),
    [play.references],
  );
  const env = useMemo(
    () => ({
      constants: play.constants ?? undefined,
      candidateCount: play.candidates.length,
      reach: play.coverage?.reach,
    }),
    [play],
  );

  // Guided / projector mode (plan-technical §B.1, last row): one root type
  // scale, remembered per device. Storage is a convenience, never a
  // requirement — a private window or blocked site data simply forgets it.
  const [scale, setScale] = useState<PlayScale>('normal');
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SCALE_KEY);
      if (stored === 'large' || stored === 'normal') setScale(stored);
    } catch {
      /* no storage: the default scale stands */
    }
  }, []);
  const chooseScale = (next: PlayScale): void => {
    setScale(next);
    try {
      window.localStorage.setItem(SCALE_KEY, next);
    } catch {
      /* nothing to do: the scale still applies for this visit */
    }
  };

  const { session, actions, hydrated } = useGameSession(store, env);
  // The hash is resolved only once the stored session is back: before that the
  // session is still EMPTY, and a deep link past the first step would be refused by
  // its own guard and rewritten to it.
  useHashStep(session.step, actions.go, hydrated);
  const { viewport } = useViewport();

  // The exact engine: one worker for the page's whole life. Created after
  // mount (there is no `Worker` on the server) and torn down with the page.
  const [worker, setWorker] = useState<WorkerEvaluator | null>(null);
  useEffect(() => {
    if (!play.available || !play.solverVersion) return;
    // No `wasmUrl`: the bundler emits `highs.wasm` itself, base-prefixed and
    // hashed, and the package's glue resolves it (infra/highsEvaluator.ts).
    const instance = createWorkerEvaluator({ baseUrl: base, timeLimitSeconds: 8 });
    setWorker(instance);
    return () => instance?.dispose();
  }, [base, play.available, play.solverVersion]);

  // The fallback needs the full payload (paths and arcs included), so it is
  // fetched — never shipped as island props (plan-technical §C.5).
  const [fallback, setFallback] = useState<EstimateEvaluator | null>(null);
  // The same payload feeds the run animation: only a solved path catalogue can
  // say where a trip goes (`runSprites.ts`), so it is kept, not just wrapped.
  const [engine, setEngine] = useState<EngineData | null>(null);
  useEffect(() => {
    if (!play.available) return;
    let alive = true;
    loadGameData(fetchGameFile(base))
      .then((engineData: EngineData) => {
        if (!alive) return;
        setEngine(engineData);
        setFallback(new EstimateEvaluator(engineData));
      })
      .catch(() => {
        // No fallback is a legitimate state: `useEvaluation` then reports the
        // worker's own error instead of quietly showing something else.
      });
    return () => {
      alive = false;
    };
  }, [base, play.available]);

  const evaluation = useEvaluation({ evaluator: worker, fallback, session, actions });

  const controls = useRef<MapControls | null>(null);
  const [unitPx, setUnitPx] = useState(2);

  const view = useStepContent({
    session,
    actions,
    play,
    data,
    evaluation,
    engine,
    references,
    controls,
    unitPx,
    t,
    lang,
    baseUrl: base,
    compact: viewport === 'phone' || viewport === 'tablet',
  });

  const back = prevStep(session.step);

  // Keyboard, for a projector with no mouse: ArrowRight is the step's primary
  // action, ArrowLeft goes back, Space is whatever the step animates. Ignored
  // while the focus is in a control that owns those keys itself — a text
  // field, a select, a slider, or a candidate site on the map.
  const primary = view.primary;
  const onSpace = view.onSpace;
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (ownsKeys(document.activeElement)) return;
      if (event.key === 'ArrowRight') {
        if (!primary || primary.disabled) return;
        event.preventDefault();
        primary.onClick();
      } else if (event.key === 'ArrowLeft') {
        if (!back) return;
        event.preventDefault();
        actions.go(back);
      } else if (event.key === ' ' || event.code === 'Space') {
        if (!onSpace) return;
        event.preventDefault();
        onSpace();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [primary, back, actions, onSpace]);

  return (
    <div className="app playapp" data-scale={scale}>
      <header className="top playtop">
        <div className="toprow">
          <span className="brand">
            <span>
              <b>SUM</b> · <span>{t('brand.lab')}</span>
            </span>
          </span>
          <a className="playdemolink" href={base}>
            {t('play.nav.demo')}
          </a>
          <span className="playscale" role="group" aria-label={t('play.scale.aria')}>
            <button aria-pressed={scale === 'normal'} onClick={() => chooseScale('normal')}>
              A
            </button>
            <button aria-pressed={scale === 'large'} onClick={() => chooseScale('large')}>
              A+
            </button>
          </span>
          <span className="lang" role="group" aria-label={t('lang.aria')}>
            <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
              EN
            </button>
            <button aria-pressed={lang === 'fr'} onClick={() => setLang('fr')}>
              FR
            </button>
          </span>
        </div>
      </header>

      <Tracker
        session={session}
        onGo={(target) => actions.go(target)}
        onBack={back ? () => actions.go(back) : null}
        onRestart={() => {
          // One tap must not wipe a layout the visitor spent minutes on.
          if (window.confirm(t('play.nav.restartConfirm'))) actions.restart();
        }}
        compact={viewport === 'phone' || viewport === 'phone-landscape' || viewport === 'tablet'}
        t={t}
      />

      {play.available ? (
        <StepShell
          step={session.step}
          view={view}
          viewport={viewport}
          t={t}
          controlsRef={controls}
          onUnitPx={setUnitPx}
        />
      ) : (
        <main className="cols playcols">
          <section className="leftcol">
            <article className="stepcard">
              <h2>{t('play.unavailable.title')}</h2>
              <p className="note">{t('play.unavailable.body')}</p>
            </article>
          </section>
        </main>
      )}
    </div>
  );
}
