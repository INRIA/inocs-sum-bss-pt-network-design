import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Panel, { type PanelState } from './Panel';
import ScreenA from './ScreenA';
import ScreenB from './ScreenB';
import ScreenC from './ScreenC';
import ScreenD from './ScreenD';
import MapPanel from './MapPanel';
import Sheet, { type SheetKind } from './Sheet';
import type { MapKind } from './CityMap';
import { makeT } from '../lib/i18n';
import { scenName } from '../lib/scen';
import { isMobile, useBottomSheet } from '../lib/useBottomSheet';
import { fmtEur, fmtInt } from '../lib/format';
import type { GameData, Lang, LayerKey, Layers, Weekday } from '../lib/types';

/**
 * The whole game is one island holding one GameState (ux-plan section 5, layout per v2).
 *
 * Desktop: a fixed viewport that never scrolls — the left column is a step accordion, the right
 * column is ONE map instance mounted here and never unmounted, so its pan/zoom camera and layer
 * state survive every step change. Below 980px the same markup becomes a full-bleed map with the
 * accordion as a draggable bottom sheet.
 *
 * Language switching re-renders in place: it never resets screen, scenario, day, hour or layers.
 */
const ALL_ON: Layers = {
  stops: true,
  tram: true,
  bus: true,
  rail: true,
  poi: true,
  bike: true,
  transfer: true,
  regular: true,
};

export default function Game({ data }: { data: GameData }) {
  const [lang, setLang] = useState<Lang>('en');
  const [screen, setScreen] = useState(0);
  const [visited, setVisited] = useState<number[]>([0]);
  const [weekday, setWeekday] = useState<Weekday>('mon');
  const [hour, setHour] = useState(8);
  const [layers, setLayers] = useState<Layers>(ALL_ON);
  const [scenario, setScenario] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [simDay, setSimDay] = useState<string>(data.scenarios[0]?.dayIds[0] ?? 'monday');
  const [dropKey, setDropKey] = useState(0);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const sheetRef = useRef<HTMLElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const snapTo = useBottomSheet(sheetRef, handleRef);

  const t = useMemo(() => makeT(lang), [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // the sheet starts at half so both the map and the step are readable on a phone
  useEffect(() => {
    if (isMobile()) snapTo('half');
  }, [snapTo]);

  const stopPlay = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setPlaying(false);
  }, []);

  // autoplay: one hour every 420 ms, stops cleanly at 23 and on any step change
  const togglePlay = useCallback(() => {
    if (timer.current) return stopPlay();
    setPlaying(true);
    timer.current = setInterval(() => {
      setHour((h) => {
        if (h >= 23) {
          stopPlay();
          return 23;
        }
        return h + 1;
      });
    }, 420);
  }, [stopPlay]);

  useEffect(() => () => stopPlay(), [stopPlay]);

  const go = useCallback(
    (n: number) => {
      stopPlay();
      setScreen(n);
      setVisited((v) => (v.includes(n) ? v : [...v, n]));
      // results are reading material, the other steps keep the map in view
      if (isMobile()) snapTo(n === 3 ? 'full' : 'half');
    },
    [stopPlay, snapTo]
  );

  /** Step C: selecting a plan IS building it (v2 section 3) — no separate confirmation. */
  const build = useCallback(
    (id: string) => {
      const sc = data.scenarios.find((s) => s.id === id);
      if (!sc) return;
      setScenario(id);
      // land on the day the player already has intuition for (ux-plan section 5.3)
      const wanted = weekday === 'sun' ? 'sunday' : 'monday';
      setSimDay(sc.dayIds.includes(wanted) ? wanted : sc.dayIds[0]);
      setChosen(id);
      setDropKey((k) => k + 1);
      go(3);
    },
    [data.scenarios, weekday, go]
  );

  const switchScenario = useCallback((id: string) => {
    setScenario(id);
    setDropKey((k) => k + 1); // stations replay their drop-in; day and reading position are untouched
  }, []);

  const toggleLayer = useCallback((k: LayerKey) => setLayers((l) => ({ ...l, [k]: !l[k] })), []);

  // presentation clicker: -> advances, <- goes back, space plays the day, Esc closes a modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSheet(null);
        return;
      }
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowRight') {
        if (screen === 0) go(1);
        else if (screen === 1) go(2);
        else if (screen === 2 && scenario) build(scenario);
        else if (screen === 2 && visited.includes(3)) go(3);
      }
      if (e.key === 'ArrowLeft' && screen > 0) go(screen - 1);
      if (e.key === ' ' && (screen === 1 || screen === 2)) {
        e.preventDefault();
        togglePlay();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [screen, scenario, visited, go, build, togglePlay]);

  const shown = data.scenarios.find((s) => s.id === (scenario ?? chosen)) ?? data.scenarios[0];
  const kind: MapKind = screen === 0 ? 'city' : screen === 3 ? 'network' : 'live';

  const stateOf = (i: number): PanelState => (screen === i ? 'open' : visited.includes(i) ? 'summary' : 'locked');
  const tryGo = (i: number) => {
    if (i !== screen && visited.includes(i)) go(i);
  };

  // one-line conclusions carried by the collapsed rows (v2 section 3) — numbers stay data-bound
  const summaries = [
    screen !== 0 && visited.includes(0) ? t('sum.a') : '',
    screen > 1
      ? t(weekday === 'mon' ? 'sum.b.mon' : 'sum.b.sun', {
          n: fmtInt(data.city.ptBoardings[weekday === 'mon' ? 'monday' : 'sunday'] ?? 0),
        })
      : '',
    screen > 2 && chosen && shown ? t('sum.c', { n: scenName(shown, t), b: fmtEur(shown.params.budget) }) : '',
    '',
  ];

  const steps = ['step.a', 'step.b', 'step.c', 'step.d'];

  return (
    <div className="app">
      <header className="top">
        <div className="toprow">
          <span className="brand">
            <span>
              <b>SUM</b> · <span>{t('brand.lab')}</span>
            </span>
          </span>
          <span className="team">INOCS · Inria</span>
          <span className="lang" role="group" aria-label={t('lang.aria')}>
            <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
              EN
            </button>
            <button aria-pressed={lang === 'fr'} onClick={() => setLang('fr')}>
              FR
            </button>
          </span>
        </div>
        <nav className="stepper" aria-label={t('nav.aria')}>
          {steps.map((key, i) => (
            <Fragment key={key}>
              {i > 0 && <span className={`tie${screen > i - 1 ? ' done' : ''}`} />}
              <button
                className={`stop${i === screen ? ' cur' : visited.includes(i) ? ' done' : ''}`}
                disabled={!visited.includes(i)}
                onClick={() => tryGo(i)}
              >
                <span className="dot" />
                <span className="lbl">{t(key)}</span>
              </button>
            </Fragment>
          ))}
        </nav>
      </header>

      <main className="cols">
        <section className="leftcol" ref={sheetRef}>
          <div className="sheethandle" ref={handleRef}>
            <span />
          </div>

          <Panel letter="A" title={t('p.a')} summary={summaries[0]} state={stateOf(0)} bodyClass="a" onOpen={() => tryGo(0)}>
            <ScreenA data={data} t={t} onNext={() => go(1)} />
          </Panel>

          <Panel letter="B" title={t('p.b')} summary={summaries[1]} state={stateOf(1)} bodyClass="b" onOpen={() => tryGo(1)}>
            <ScreenB
              data={data}
              t={t}
              lang={lang}
              weekday={weekday}
              hour={hour}
              playing={playing}
              onWeekday={setWeekday}
              onHour={setHour}
              onTogglePlay={togglePlay}
              onNext={() => go(2)}
            />
          </Panel>

          <Panel letter="C" title={t('p.c')} summary={summaries[2]} state={stateOf(2)} bodyClass="c" onOpen={() => tryGo(2)}>
            <ScreenC
              data={data}
              t={t}
              lang={lang}
              weekday={weekday}
              selected={scenario}
              onBuild={build}
              onSheet={setSheet}
            />
          </Panel>

          <Panel letter="D" title={t('p.d')} summary={summaries[3]} state={stateOf(3)} bodyClass="d" onOpen={() => tryGo(3)}>
            <ScreenD
              data={data}
              t={t}
              lang={lang}
              scenario={scenario ?? chosen}
              chosen={chosen}
              simDay={simDay}
              onScenario={switchScenario}
              onSimDay={setSimDay}
              onSheet={setSheet}
              onBack={() => go(2)}
            />
          </Panel>
        </section>

        <aside className="rightcol">
          <MapPanel
            data={data}
            kind={kind}
            t={t}
            lang={lang}
            weekday={weekday}
            hour={hour}
            layers={layers}
            onToggleLayer={toggleLayer}
            scenario={shown}
            day={simDay}
            dropKey={dropKey}
            onSheet={setSheet}
          />
          <div className="credit">
            <span dangerouslySetInnerHTML={{ __html: t('credit') }} /> · <span className="mono">←→</span>{' '}
            <span>{t('credit.kbd')}</span> · <span>{t('map.attrib')}</span>
          </div>
        </aside>
      </main>

      <Sheet
        sheet={sheet}
        onClose={() => setSheet(null)}
        data={data}
        scenarioId={scenario ?? chosen}
        day={simDay}
        t={t}
        lang={lang}
      />
    </div>
  );
}
