import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import MapFrame, { type MapControls } from '../map/frame/MapFrame';
import { SNAP_HEIGHT, useBottomSheet, type Snap } from '../../lib/useBottomSheet';
import type { GameStep } from '../../domain/game/steps';
import type { Viewport } from '../../hooks/viewport';
import type { T } from '../../lib/i18n';
import { onSnapRequest } from './sheetBus';
import type { StepView } from './stepView';

/**
 * The responsive frame of plan-technical §B.1, and nothing else.
 *
 * Desktop and tablet-landscape: two columns in a fixed viewport, step card
 * left, map right, no page scroll — the existing `cols / leftcol / rightcol`
 * grid. Phone and tablet-portrait: full-bleed map with the step content in the
 * existing draggable bottom sheet, snapped per step (§B.2: Build peeks so the
 * map is the task, Predict opens full). Phone-landscape: a 44 % side panel,
 * because a sheet has no room to open.
 *
 * The map is mounted HERE, once, and never unmounted: the camera, the zoom and
 * the running animations survive every step change. A step only says what to
 * draw, through `view.map`.
 */
const SNAP: Record<GameStep, Snap> = {
  entry: 'full',
  budget: 'full',
  build: 'peek',
  predict: 'full',
  run: 'peek',
  optimiser: 'half',
  conclusions: 'full',
};

/**
 * How much of the map the sheet hides at each snap.
 *
 * The circular study area is centred in what is LEFT above the sheet rather
 * than pinned to the top of a screen-tall box, which left a phone with the map
 * glued under the tracker and a blank band below it. At `full` the map is not
 * visible at all, so nothing is reserved.
 */
const MAP_INSET: Record<Snap, string> = {
  peek: SNAP_HEIGHT.peek,
  half: SNAP_HEIGHT.half,
  full: '0px',
};

export default function StepShell({
  step,
  view,
  viewport,
  t,
  controlsRef,
  onUnitPx,
}: {
  step: GameStep;
  view: StepView;
  viewport: Viewport;
  t: T;
  controlsRef: RefObject<MapControls | null>;
  onUnitPx: (unitPx: number) => void;
}) {
  const sheetRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const snapTo = useBottomSheet(sheetRef, handleRef);
  const [snap, setSnap] = useState<Snap>(SNAP[step] ?? 'half');

  // The per-step snap of §B.2, overridden while a step asks for something else
  // (Run rises to `full` when the day has finished playing). On a desktop the
  // sheet CSS is inert, so setting the variable there is harmless.
  const wanted = view.snap ?? SNAP[step] ?? 'half';
  useEffect(() => {
    setSnap(wanted);
    snapTo(wanted);
  }, [wanted, snapTo]);

  // A control inside the card may ask for room (the "Help me" chip on a phone).
  useEffect(
    () =>
      onSnapRequest((requested) => {
        setSnap(requested);
        snapTo(requested);
      }),
    [snapTo],
  );

  // `.stepcard` is ONE scroll container, reused by all six steps: without this
  // a visitor arriving on a step lands wherever the previous one was left —
  // the conclusions opening halfway down its own ticket, for instance.
  useEffect(() => {
    if (cardRef.current) cardRef.current.scrollTop = 0;
    if (sheetRef.current) sheetRef.current.scrollTop = 0;
  }, [step]);

  const primary = view.primary;

  return (
    <main
      className={`cols playcols vp-${viewport}`}
      style={{ '--mapinset': MAP_INSET[snap] } as CSSProperties}
    >
      <section className="leftcol playsheet" ref={sheetRef}>
        <div className="sheethandle" ref={handleRef}>
          <span />
        </div>
        <article className={`stepcard playstep step-${step}`} ref={cardRef}>
          <p className="playbrief">
            <span className="playrhythm">{view.rhythm}</span>
            <span>{view.brief}</span>
          </p>
          {view.panel}
        </article>
        {primary && (
          <div className="playbar">
            {primary.href ? (
              <a className={`cta playprimary${primary.go ? ' go' : ''}`} href={primary.href}>
                {primary.label}
              </a>
            ) : (
              <button
                className={`cta playprimary${primary.go ? ' go' : ''}`}
                onClick={primary.onClick}
                disabled={primary.disabled}
              >
                {primary.label}
              </button>
            )}
            {primary.note && <span className="playbarnote">{primary.note}</span>}
          </div>
        )}
      </section>

      <aside className="rightcol playmapcol">
        <MapFrame
          id="playmap"
          ariaLabel={t('play.map.aria')}
          t={t}
          top={view.map.top}
          bottom={view.map.bottom}
          overlay={view.map.overlay}
          popover={view.map.popover}
          onTap={view.map.onTap}
          doubleTapZoom={view.map.doubleTapZoom}
          controlsRef={controlsRef}
          onUnitPx={onUnitPx}
        >
          {view.map.children}
        </MapFrame>
      </aside>
    </main>
  );
}
