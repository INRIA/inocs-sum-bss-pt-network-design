import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Tabs from './Tabs';
import Step1 from './Step1';
import Step2 from './Step2';
import Step3 from './Step3';
import Step4 from './Step4';
import Step5 from './Step5';
import MapPanel from './MapPanel';
import Sheet, { type SheetKind } from './Sheet';
import type { MapKind } from './CityMap';
import { makeT } from '../lib/i18n';
import { cardsOf } from '../lib/families';
import { isMobile, useBottomSheet } from '../lib/useBottomSheet';
import type { GameData, Lang, LayerKey, Layers, Weekday } from '../lib/types';

/**
 * The whole demo is one island holding one state (plan.md section 7).
 *
 * Desktop: a fixed viewport that never scrolls — the five steps are header tabs, the left column
 * holds only the current step, and the right column is ONE map instance mounted here and never
 * unmounted, so its pan/zoom camera and layer state survive every step change. Below 980px the
 * same markup becomes a full-bleed map with the step content as a draggable bottom sheet.
 *
 * Language switching re-renders in place: it never resets step, plan, day, hour, layers or period.
 */
const DEFAULT_LAYERS: Layers = {
  stops: true,
  tram: true,
  bus: true,
  rail: true,
  poi: true,
  bike: true,
  transfer: true,
  regular: true,
  // the model's two per-period read-outs: docks on by default, bikes in stock off (plan.md section 7)
  capacity: true,
  inventory: false,
};

export default function Game({ data }: { data: GameData }) {
  const [lang, setLang] = useState<Lang>('en');
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState<number[]>([0]);
  const [weekday, setWeekday] = useState<Weekday>('mon');
  const [hour, setHour] = useState(8);
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [scenario, setScenario] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [period, setPeriod] = useState(0);
  const [dropKey, setDropKey] = useState(0);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [playing, setPlaying] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [openQs, setOpenQs] = useState<number[]>([]);
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
      setStep(n);
      setVisited((v) => (v.includes(n) ? v : [...v, n]));
      // results and comparisons are reading material, the other steps keep the map in view
      if (isMobile()) snapTo(n >= 3 ? 'full' : 'half');
    },
    [stopPlay, snapTo]
  );

  /** Step 3: selecting a plan IS building it (v2 section 3) — no separate confirmation. */
  const build = useCallback(
    (id: string) => {
      if (!data.scenarios.some((s) => s.id === id)) return;
      setScenario(id);
      setChosen(id);
      setPeriod(0);
      setDropKey((k) => k + 1);
      go(3);
    },
    [data.scenarios, go]
  );

  const switchScenario = useCallback((id: string) => {
    setScenario(id);
    setDropKey((k) => k + 1); // stations replay their drop-in; reading position is untouched
  }, []);

  const toggleLayer = useCallback((k: LayerKey) => setLayers((l) => ({ ...l, [k]: !l[k] })), []);

  const toggleQ = useCallback((n: number) => {
    setOpenQs((q) => (q.includes(n) ? q.filter((x) => x !== n) : [...q, n]));
  }, []);

  // presentation clicker: -> advances, <- goes back, space plays the day, Esc closes a modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSheet(null);
        return;
      }
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowRight' && step < 4) go(step + 1);
      if (e.key === 'ArrowLeft' && step > 0) go(step - 1);
      if (e.key === ' ' && step === 1) {
        e.preventDefault();
        togglePlay();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step, go, togglePlay]);

  const solvedCards = cardsOf(data.scenarios).filter((s) => s.hasResults);
  const shown =
    data.scenarios.find((s) => s.id === (scenario ?? chosen)) ?? solvedCards[0] ?? data.scenarios.find((s) => s.hasResults);
  const kind: MapKind = step === 0 ? 'city' : step >= 3 && shown?.hasResults ? 'network' : 'live';

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
          <button
            className="switch"
            aria-pressed={advanced}
            title={t('adv.hint')}
            onClick={() => setAdvanced((a) => !a)}
          >
            <span className="tog" />
            <span>{t('adv.label')}</span>
          </button>
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
      <Tabs step={step} visited={visited} onGo={go} t={t} />

      <main className="cols">
        <section className="leftcol" ref={sheetRef}>
          <div className="sheethandle" ref={handleRef}>
            <span />
          </div>
          <article className={`stepcard s${step + 1}`}>
            {step === 0 && <Step1 data={data} t={t} onNext={() => go(1)} />}
            {step === 1 && (
              <Step2
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
            )}
            {step === 2 && (
              <Step3 data={data} t={t} lang={lang} selected={chosen} onBuild={build} onSheet={setSheet} />
            )}
            {step === 3 && (
              <Step4
                data={data}
                t={t}
                lang={lang}
                scenario={shown}
                chosen={chosen}
                advanced={advanced}
                howOpen={howOpen}
                onHowToggle={() => setHowOpen((o) => !o)}
                onScenario={switchScenario}
                onSheet={setSheet}
                onNext={() => go(4)}
                onBack={() => go(2)}
              />
            )}
            {step === 4 && (
              <Step5
                data={data}
                t={t}
                lang={lang}
                advanced={advanced}
                open={openQs}
                onToggle={toggleQ}
                onRestart={() => go(0)}
              />
            )}
          </article>
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
            period={period}
            onPeriod={setPeriod}
            dropKey={dropKey}
          />
          <div className="credit">
            <span dangerouslySetInnerHTML={{ __html: t('credit') }} /> · <span className="mono">←→</span>{' '}
            <span>{t('credit.kbd')}</span> · <span>{t('map.attrib')}</span>
          </div>
        </aside>
      </main>

      <Sheet sheet={sheet} onClose={() => setSheet(null)} data={data} current={shown} t={t} lang={lang} />
    </div>
  );
}
