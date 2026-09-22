/**
 * The four polls of step 3, all on screen and all optional. The poll shows no verdict of any kind: the
 * reveal belongs to step 4.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import Predict from './screens/Predict';
import { questionsFor } from '../../domain/game/predictions';
import { makeT } from '../../lib/i18n';

const t = makeT('en');
const questions = questionsFor('predict');

const render = (answers: Record<string, string> = {}): string =>
  renderToStaticMarkup(
    <Predict questions={questions} answers={answers} onAnswer={() => {}} onClear={() => {}} t={t} />,
  );

const count = (html: string, needle: string): number => html.split(needle).length - 1;
/** renderToStaticMarkup escapes quotes, so compare against escaped copy. */
const esc = (text: string): string => text.replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
const dots = (html: string): number => (html.match(/class="playdot[ "]/g) ?? []).length;

describe('Predict', () => {
  it('asks the four step-3 polls, all on screen', () => {
    expect(questions).toHaveLength(4);
    const html = render();
    for (const question of questions) expect(html).toContain(esc(t(question.questionKey)));
    expect(html).not.toContain(esc(t('play.q.rush')));
    expect(count(html, 'class="playpoll"')).toBe(4);
  });

  it('says the polls are optional and draws no dots or ticket', () => {
    const html = render();
    expect(html).toContain(t('play.predict.optional'));
    expect(html).not.toContain('playdot ');
    expect(html).not.toContain('playticket');
  });

  it('renders every option of every question as its own button', () => {
    const html = render();
    const total = questions.reduce((sum, question) => sum + question.options.length, 0);
    expect(count(html, 'class="playoption"')).toBe(total);
    for (const question of questions) {
      for (const option of question.options) expect(html).toContain(esc(t(option.labelKey)));
    }
  });

  it('promises no right answer and presses the chosen option', () => {
    const html = render({ served: 'lt40' });
    expect(html).toContain(t('play.predict.noright'));
    expect(count(html, 'aria-pressed="true"')).toBe(1);
  });
});
