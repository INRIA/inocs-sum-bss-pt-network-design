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

  const { session, actions } = useGameSession(store, env);
  useHashStep(session.step, actions.go);
  const { viewport } = useViewport();

  // The exact engine: one worker for the page's whole life. Created after
  // mount (there is no `Worker` on the server) and torn down with the page.
  const [worker, setWorker] = useState<WorkerEvaluator | null>(null);
  useEffect(() => {
    if (!play.available || !play.solverPath) return;
    const instance = createWorkerEvaluator({
      baseUrl: base,
      wasmUrl: new URL(`${base}data/${play.solverPath}`, window.location.href).href,
      timeLimitSeconds: 8,
    });
    setWorker(instance);
    return () => instance?.dispose();
  }, [base, play.available, play.solverPath]);

  // The fallback needs the full payload (paths and arcs included), so it is
  // fetched — never shipped as island props (plan-technical §C.5).
  const [fallback, setFallback] = useState<EstimateEvaluator | null>(null);
  useEffect(() => {
    if (!play.available) return;
    let alive = true;
    loadGameData(fetchGameFile(base))
      .then((engineData: EngineData) => {
        if (alive) setFallback(new EstimateEvaluator(engineData));
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
    references,
    controls,
    unitPx,
    t,
    lang,
  });

  const back = prevStep(session.step);

  return (
    <div className="app playapp" data-scale="normal">
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
        demoUrl={base}
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
