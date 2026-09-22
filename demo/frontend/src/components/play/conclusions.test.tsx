/**
 * Step 6 against the REAL committed data.
 *
 * Two things are pinned here. First, the ticket replays exactly the
 * predictions that were answered — no row for a question the visitor skipped,
 * and no score anywhere in what is rendered. Second, every reveal template
 * receives every fact it interpolates: the sentences are built from
 * `Resolution.facts`, so a template that named a fact the resolver does not
 * produce would ship a literal `{placeholder}` to a workshop screen.
 *
 * Skipped when `public/data/` has not been generated yet, like the other
 * data-backed tests.
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { BudgetReference } from '../../domain/evaluation/types';
import { PREDICTION_IDS, resolveAll, type ResolutionInputs } from '../../domain/game/predictions';
import { EMPTY_SESSION, reduce, type EvaluationSummary, type Session } from '../../domain/game/session';
import { buildTicket } from '../../domain/game/ticket';
import { translate } from '../../lib/i18n';
import { makeT } from '../../lib/i18n';
import { budgetLadder, doublePair, planFacts, planOf } from './optimiserFacts';
import { RHYTHM_SHARP, RHYTHM_SLOW, rhythmFacts, sharpMorning } from './steps/conclusionsStep';
import { revealOf } from './reveal';
import Conclusions from './screens/Conclusions';

const ready = existsSync('public/data/manifest.json') && existsSync('public/data/game/references.json');
const t = makeT('en');

/** The optimiser's own same-engine row reads as an evaluation summary. */
const asSummary = (run: BudgetReference['optimiserWithTrucks']): EvaluationSummary => ({
  ...run,
  quality: 'exact',
});

describe.skipIf(!ready)('step 6 on the committed data', async () => {
  const { loadGameData } = await import('../../lib/data');
  const { loadPlayData } = await import('../../lib/playData');
  const data = loadGameData();
  const play = loadPlayData();
  const reference = play.references.find((entry) => entry.budgetEur === 80000)!;
  const plan = planOf(data, 'budget_080k');
  const facts = planFacts(plan!)!;
  const ladder = budgetLadder(data);
  const pair = doublePair(ladder, 80000)!;

  const inputs: ResolutionInputs = {
    withTrucks: asSummary(reference.optimiserWithTrucks),
    withoutTrucks: asSummary(reference.optimiserWithoutTrucks),
    trucks: true,
    optimiserDispatches: facts.dispatches,
    rhythm: rhythmFacts(data),
    double: {
      lowBudgetEur: pair.low.budgetEur,
      highBudgetEur: pair.high.budgetEur,
      lowServed: pair.low.served,
      highServed: pair.high.served,
    },
  };

  const answers = { served: '70to90', pt: '4in10', trucks: 'few', rhythm: 'same' };

  const session = (): Session => {
    let next = reduce(EMPTY_SESSION, { type: 'chooseBudget', budgetId: '080k' });
    next = reduce(next, { type: 'toggleStation', id: 3 });
    next = reduce(next, { type: 'toggleStation', id: 7 });
    for (const [id, option] of Object.entries(answers)) {
      next = reduce(next, { type: 'answer', predictionId: id as never, optionId: option });
    }
    return {
      ...next,
      step: 'conclusions',
      evaluation: { withTrucks: inputs.withTrucks, withoutTrucks: inputs.withoutTrucks },
      layoutHash: 'test',
    };
  };

  it('fills every placeholder of every reveal, in both languages', () => {
    const resolutions = resolveAll(answers, inputs);
    expect(resolutions).toHaveLength(PREDICTION_IDS.length);
    for (const resolution of resolutions) {
      for (const lang of ['en', 'fr'] as const) {
        const reveal = revealOf(resolution, lang);
        const sentence = translate(lang, reveal.key, reveal.vars);
        expect(sentence, `${reveal.key}/${lang}`).not.toMatch(/[{}]/);
        expect(sentence, `${reveal.key}/${lang}`).not.toEqual(reveal.key);
        if (reveal.noteKey) {
          const note = translate(lang, reveal.noteKey, reveal.vars);
          expect(note, `${reveal.noteKey}/${lang}`).not.toMatch(/[{}]/);
          expect(note, `${reveal.noteKey}/${lang}`).not.toEqual(reveal.noteKey);
        }
        expect(translate(lang, reveal.toneKey)).not.toEqual(reveal.toneKey);
      }
    }
  });

  it('renders one row per answered prediction, and none for the rest', () => {
    const ticket = buildTicket(session(), { reference, resolution: inputs })!;
    const html = renderToStaticMarkup(
      <Conclusions
        ticket={ticket}
        data={data}
        periods={[]}
        optimiserPeriods={null}
        sharpMorning={sharpMorning(data)}
        onRestart={() => {}}
        lang="en"
        t={t}
      />,
    );
    expect(html.split('class="playrecap').length - 1).toBe(Object.keys(answers).length);
    expect(html).toContain(t('play.ticket.yousaid'));
    expect(html).toContain(t('play.ticket.modelsays'));
    expect(html).toContain(t('play.conclusions.closing'));
    // the one primary call to action is the shell's bar, so the card itself
    // carries no `cta`: only the secondary "play again" and the deeper layer
    expect(html).not.toContain('class="cta');
    expect(html).toContain(t('play.conclusions.again'));
    expect(html).not.toContain(t('play.deeper.cap'));
    // No score, in any form. "Points" is allowed only as the unit of a
    // percentage-point gap, so every occurrence must follow a number.
    expect(html.toLowerCase()).not.toMatch(/\b(score|scored|correct|incorrect|wrong|you win|you lose)\b/);
    // The only place "ranking" may appear is where the copy denies one.
    expect(html.toLowerCase().split('ranking').length - 1).toBe(
      html.toLowerCase().split('not a ranking').length - 1,
    );
    for (const match of html.toLowerCase().matchAll(/points/g)) {
      expect(html.slice(Math.max(0, match.index - 14), match.index)).toMatch(/\d[\d.,\s]*$/);
    }
  });

  it('can open the full demo proof of every card the ticket links to', async () => {
    const { default: Proof } = await import('../Proofs');
    for (const n of [1, 2, 3, 4]) {
      const html = renderToStaticMarkup(<Proof n={n} data={data} t={t} lang="en" />);
      expect(html.length, `proof ${n}`).toBeGreaterThan(100);
    }
  });

  it('asks "double the budget" on a pair that really is a doubling', () => {
    expect(pair.high.budgetEur).toBe(pair.low.budgetEur * 2);
    expect(pair.low.budgetEur).toBeLessThanOrEqual(80000);
  });

  it('resolves the rhythm question from the two plans, not from a literal', () => {
    expect(inputs.rhythm.sharpStations.length).toBeGreaterThan(0);
    expect(inputs.rhythm.referenceStations.length).toBeGreaterThan(0);
    const rhythm = resolveAll(answers, inputs).find((entry) => entry.predictionId === 'rhythm')!;
    expect(['same', 'move']).toContain(rhythm.actual);
    expect(revealOf(rhythm, 'en').noteKey).toBe('play.reveal.rhythm.note');
  });

  it('compares the busy weekday with the SLOWER rhythm, not with the budget ladder', () => {
    // Owner's decision: "weekday, busy day" is rhythm_sharp and "a slower,
    // week-end-like rhythm" is rhythm_uniform. The counts are read off the
    // committed runs, so this fails if the resolver is pointed elsewhere.
    const sharp = data.scenarios.find((sc) => sc.id === RHYTHM_SHARP)!;
    const slow = data.scenarios.find((sc) => sc.id === RHYTHM_SLOW)!;
    const facts = rhythmFacts(data);
    expect(facts.sharpStations.length).toBe(sharp.stations.length);
    expect(facts.referenceStations.length).toBe(slow.stations.length);
    // and NOT the reference plan of the visitor's own budget
    const ladderPlan = data.scenarios.find((sc) => sc.id === 'budget_080k')!;
    expect(facts.referenceStations.length).not.toBe(ladderPlan.stations.length);
    // the sentence then quotes the slower plan's own total
    const rhythm = resolveAll(answers, inputs).find((entry) => entry.predictionId === 'rhythm')!;
    expect(rhythm.facts.referenceTotal).toBe(slow.stations.length);
  });
});
