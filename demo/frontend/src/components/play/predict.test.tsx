/**
 * One question per screen, with "n of 5" dots and every option a full-width
 * button (plan-technical §B.2). The poll shows no verdict of any kind: the
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
    <Predict questions={questions} answers={answers} onAnswer={() => {}} t={t} />,
  );

const count = (html: string, needle: string): number => html.split(needle).length - 1;
/** renderToStaticMarkup escapes quotes, so compare against escaped copy. */
const esc = (text: string): string => text.replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
const dots = (html: string): number => (html.match(/class="playdot[ "]/g) ?? []).length;

describe('Predict', () => {
  it('asks the five step-3 polls, one screen at a time', () => {
    expect(questions).toHaveLength(5);
    const html = render();
    const first = questions[0]!;
    expect(html).toContain(esc(t(first.questionKey)));
    for (const other of questions.slice(1)) expect(html).not.toContain(esc(t(other.questionKey)));
  });

  it('draws one dot per question and says where the visitor is', () => {
    const html = render();
    expect(dots(html)).toBe(questions.length);
    expect(html).toContain(t('play.predict.progress', { n: 1, total: questions.length }));
    expect(html).toContain('playdot cur');
  });

  it('renders every option of the current question as its own button', () => {
    const html = render();
    const first = questions[0]!;
    expect(count(html, 'class="playoption"')).toBe(first.options.length);
    for (const option of first.options) expect(html).toContain(esc(t(option.labelKey)));
  });

  it('promises no right answer, and stamps what has been answered on the ticket', () => {
    const html = render({ served: 'lt40' });
    expect(html).toContain(t('play.predict.noright'));
    expect(html).toContain(t('play.short.served'));
    expect(html).toContain(t('play.q.served.lt40'));
    expect(html).toContain('aria-pressed="true"');
  });

  it('shows an empty ticket before anything is answered', () => {
    expect(render()).toContain(t('play.ticket.empty'));
  });
});
