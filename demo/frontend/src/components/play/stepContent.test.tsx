/**
 * A server-render smoke test of the whole step wiring.
 *
 * `useStepContent` only uses state/memo hooks, so `renderToStaticMarkup` runs
 * it for real against the REAL payload — the same files the page reads at build
 * time. It cannot click anything (no DOM, no browser), but it does prove that
 * every step composes its map and its panel without throwing, that the map is
 * mounted once, and that Build draws the layers plan-technical §A.2 asks for.
 *
 * Skipped when `public/data/` has not been generated yet: `npm run prepare-data`
 * writes it, and a fresh clone has no reason to fail here.
 */
import { createRef } from 'react';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import StepShell from './StepShell';
import { useStepContent } from './useStepContent';
import {
  EMPTY_SESSION,
  createActions,
  reduce,
  type Session,
} from '../../domain/game/session';
import { ALL_STEPS, type GameStep } from '../../domain/game/steps';
import { fakeEvaluation } from '../../domain/game/testSupport';
import type { UseEvaluation } from '../../hooks/useEvaluation';
import { makeT } from '../../lib/i18n';
import type { MapControls } from '../map/frame/MapFrame';

const ready = existsSync('public/data/manifest.json') && existsSync('public/data/game/coverage.json');

const t = makeT('en');
const idle: UseEvaluation = {
  status: 'idle',
  current: null,
  both: null,
  error: null,
  evaluate: () => {},
};

describe.skipIf(!ready)('useStepContent', async () => {
  const { loadGameData } = await import('../../lib/data');
  const { loadPlayData } = await import('../../lib/playData');
  const data = loadGameData();
  const play = loadPlayData();
  const references = new Map(play.references.map((entry) => [entry.budgetEur, entry]));

  const render = (session: Session): string => {
    const actions = createActions(() => {}, () => session, {
      constants: play.constants ?? undefined,
      candidateCount: play.candidates.length,
      reach: play.coverage?.reach,
    });
    function Harness() {
      const controls = createRef<MapControls | null>();
      const view = useStepContent({
        session,
        actions,
        play,
        data,
        evaluation: idle,
        references,
        controls,
        unitPx: 2,
        t,
        lang: 'en',
      });
      return (
        <StepShell
          step={session.step}
          view={view}
          viewport="desktop"
          t={t}
          controlsRef={controls}
          onUnitPx={() => {}}
        />
      );
    }
    return renderToStaticMarkup(<Harness />);
  };

  const at = (step: GameStep, placed: number[] = []): Session => {
    let session = reduce(EMPTY_SESSION, { type: 'chooseBudget', budgetId: '080k' });
    for (const id of placed) {
      session = reduce(session, { type: 'toggleStation', id, constants: play.constants ?? undefined });
    }
    return { ...session, step, visited: [...ALL_STEPS] };
  };

  /** A session that has been solved: the three last steps have something to show. */
  const solved = (step: GameStep): Session => {
    const base = at(step, [3, 7, 11]);
    const withTrucks = fakeEvaluation({ served: 1000 });
    const withoutTrucks = fakeEvaluation({ served: 940 });
    return {
      ...base,
      trucks: true,
      layoutHash: 'test',
      evaluation: { withTrucks, withoutTrucks },
      predictions: { served: '70to90', pt: '4in10', rush: 'bit', trucks: 'few', rhythm: 'same' },
    };
  };

  it('renders the three last steps against a solved session', () => {
    const run = render(solved('run'));
    expect(run).toContain(t('play.pie.h').replace(/'/g, '&#x27;'));

    const optimiser = render(solved('optimiser'));
    expect(optimiser).toContain(t('play.kpi.stations'));
    expect(optimiser).toContain(t('play.pie.h').replace(/'/g, '&#x27;'));
    // the optimiser's own network is drawn, with the visitor's underneath in
    // grey: the ghost variant is the only layer rendered at 0.6 opacity
    expect(optimiser).toContain('opacity="0.6"');

    const conclusions = render(solved('conclusions'));
    // the full demo's "compare plans" step, shown as is
    expect(conclusions).toContain(t('s5.title'));
    expect(conclusions).toContain(t('s5.all.h'));
  });

  it('renders every step with one map and one primary action', () => {
    for (const step of ALL_STEPS) {
      const html = render(at(step, [3, 7, 11]));
      // one map frame, not one <svg>: the legend swatches are inline SVG too
      expect(html.split('class="mapwrap"').length - 1, step).toBe(1);
      expect(html.split('class="cta playprimary').length - 1, step).toBe(1);
      expect(html, step).toContain('playbrief');
    }
  });

  it('draws the city pulse, the free sites and the placed stations on Build', () => {
    const html = render(at('build', [3, 7, 11]));
    expect(html).toContain('class="trips trips-demand"');
    expect(html).toContain('class="candidates"');
    // three placed stations, drawn by the player variant of StationsLayer
    expect(html.split('class="trip ').length - 1).toBeGreaterThan(50);
    expect(html).toContain(t('play.build.leftfor'));
  });

  it('shows the free sites only while building', () => {
    expect(render(at('predict', [3, 7]))).not.toContain('class="candidates"');
  });

  it('reads the budget meter and the reach preview off the real payload', () => {
    const empty = render(at('build'));
    const some = render(at('build', [3, 7, 11, 19, 27]));
    expect(empty).toContain(t('play.build.reachnote'));
    // five stations cost money and put real demand within reach
    expect(some).not.toEqual(empty);
  });
});
