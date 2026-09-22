/**
 * The step template (UX reference §3): a one-line brief with its rhythm verb,
 * the content, and exactly ONE primary action — on every step, at every
 * viewport. The map is mounted by the shell, not by the step.
 */
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import StepShell from './StepShell';
import type { StepView } from './stepView';
import { ALL_STEPS, stepDef, type GameStep } from '../../domain/game/steps';
import type { Viewport } from '../../hooks/viewport';
import { makeT } from '../../lib/i18n';
import type { MapControls } from '../map/frame/MapFrame';

const t = makeT('en');

const viewOf = (step: GameStep): StepView => ({
  brief: t(`play.brief.${step}`),
  rhythm: t(stepDef(step).rhythmKey),
  panel: <p className="PANEL-MARK">panel</p>,
  primary: { label: `go-${step}`, onClick: () => {}, go: true },
  map: { children: <circle className="LAYER-MARK" r={1} /> },
});

const render = (step: GameStep, viewport: Viewport = 'desktop'): string =>
  renderToStaticMarkup(
    <StepShell
      step={step}
      view={viewOf(step)}
      viewport={viewport}
      t={t}
      controlsRef={createRef<MapControls | null>()}
      onUnitPx={() => {}}
    />,
  );

const count = (html: string, needle: string): number => html.split(needle).length - 1;

describe('StepShell', () => {
  it('gives every step exactly one primary action, and its own label', () => {
    for (const step of ALL_STEPS) {
      const html = render(step);
      expect(count(html, 'class="cta playprimary go"')).toBe(1);
      expect(html).toContain(`go-${step}`);
    }
  });

  it('renders the brief with its rhythm verb above the content', () => {
    const html = render('build');
    expect(html.indexOf('playrhythm')).toBeLessThan(html.indexOf('PANEL-MARK'));
    expect(html).toContain(t('play.rhythm.build'));
    // The server render escapes apostrophes, so compare the escaped copy.
    expect(html).toContain(t('play.brief.build').replace(/'/g, '&#x27;'));
  });

  it('mounts the map once, with the step layers inside it', () => {
    const html = render('build');
    expect(count(html, '<svg')).toBe(1);
    expect(html).toContain('LAYER-MARK');
    expect(html).toContain('class="mapcard"');
  });

  it('keeps the same two columns and the sheet handle at every viewport', () => {
    for (const viewport of ['phone', 'phone-landscape', 'tablet', 'desktop'] as Viewport[]) {
      const html = render('predict', viewport);
      expect(html).toContain(`playcols vp-${viewport}`);
      expect(count(html, 'class="sheethandle"')).toBe(1);
      expect(count(html, 'class="cta playprimary go"')).toBe(1);
    }
  });

  it('omits the action bar entirely when a step has no primary action', () => {
    const html = renderToStaticMarkup(
      <StepShell
        step="run"
        view={{ ...viewOf('run'), primary: null }}
        viewport="desktop"
        t={t}
        controlsRef={createRef<MapControls | null>()}
        onUnitPx={() => {}}
      />,
    );
    expect(html).not.toContain('playprimary');
  });
});
