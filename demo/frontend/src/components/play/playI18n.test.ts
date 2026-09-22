/**
 * Every `play.*` key the game asks for must exist in BOTH dictionaries.
 *
 * Two halves, because the game names its copy in two ways: the literals the
 * screens write (`t('play.build.cta')`), found by scanning the source, and the
 * families the DOMAIN names (a step, a rhythm verb, a guard reason, a question
 * and its options), enumerated from the domain itself — so adding a prediction
 * or a step fails here until its copy exists, which is the point.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import en from '../../i18n/en.json';
import fr from '../../i18n/fr.json';
import { ALL_STEPS } from '../../domain/game/steps';
import { PREDICTIONS, PREDICTION_IDS } from '../../domain/game/predictions';
import { BUDGET_IDS } from '../../domain/game/session';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../..');

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__guard__' ? [] : walk(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')
      ? [path]
      : [];
  });

/** `t('play.x.y')` literals written in the source. Template keys are enumerated below. */
function literalKeys(): string[] {
  const found = new Set<string>();
  for (const file of walk(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/t\(\s*'(play\.[a-zA-Z0-9._-]+)'/g)) {
      found.add(match[1]!);
    }
  }
  return [...found].sort();
}

/** The families the domain names, built from the domain's own ids. */
function domainKeys(): string[] {
  const keys: string[] = [];
  for (const step of ALL_STEPS) {
    keys.push(`play.step.${step}`, `play.rhythm.${step}`, `play.brief.${step}`);
  }
  // Guard reasons, read off the guard table itself rather than restated here.
  const steps = readFileSync(join(SRC, 'domain/game/steps.ts'), 'utf8');
  for (const match of steps.matchAll(/no\('(play\.[a-zA-Z0-9._-]+)'\)/g)) keys.push(match[1]!);
  for (const question of PREDICTIONS) {
    keys.push(question.questionKey);
    for (const option of question.options) keys.push(option.labelKey);
  }
  for (const id of PREDICTION_IDS) keys.push(`play.short.${id}`);
  for (const id of BUDGET_IDS) {
    keys.push(`play.budget.name.${id}`);
  }
  for (const status of ['idle', 'running', 'ready', 'estimate', 'error']) {
    keys.push(`play.status.${status}`);
  }
  // The families the VIEW-MODELS name: a loss cause, a comparison row, a mark
  // of the served line and the tone of a reveal are all keys the domain builds
  // by template, so they are enumerated from the domain's own unions.
  for (const cause of ['noStation', 'noStock', 'unreachable']) keys.push(`play.loss.${cause}`);
  for (const row of ['stations', 'docks', 'bikes', 'truckRuns', 'served']) {
    keys.push(`play.compare.${row}`);
  }
  for (const mark of ['random', 'you', 'optimiser']) keys.push(`play.mark.${mark}`);
  for (const tone of ['close', 'other']) keys.push(`play.tone.${tone}`);
  // The reveal sentences of step 6: read off `reveal.ts` itself, the same way
  // the guard reasons are read off `steps.ts`, so a new branch fails here
  // until both dictionaries carry its sentence.
  const reveal = readFileSync(join(SRC, 'components/play/reveal.ts'), 'utf8');
  for (const match of reveal.matchAll(/'(play\.[a-zA-Z0-9._-]+)'/g)) keys.push(match[1]!);
  for (const step of ['run', 'optimiser', 'conclusions']) {
    for (const field of ['eyebrow', 'title', 'lede', 'cta']) keys.push(`play.${step}.${field}`);
  }
  return [...new Set(keys)].sort();
}

const dict = (source: Record<string, string>) => (key: string): boolean => Boolean(source[key]);
const hasEn = dict(en as Record<string, string>);
const hasFr = dict(fr as Record<string, string>);

describe('play.* copy', () => {
  it('finds the literals the screens use', () => {
    const keys = literalKeys();
    expect(keys.length).toBeGreaterThan(30);
    expect(keys).toContain('play.build.cta');
  });

  it('has an English string for every key the game asks for', () => {
    const missing = [...literalKeys(), ...domainKeys()].filter((key) => !hasEn(key));
    expect(missing).toEqual([]);
  });

  it('has a French string for every key the game asks for', () => {
    const missing = [...literalKeys(), ...domainKeys()].filter((key) => !hasFr(key));
    expect(missing).toEqual([]);
  });

  it('keeps the two dictionaries in step on the play namespace', () => {
    const only = (a: Record<string, string>, b: Record<string, string>) =>
      Object.keys(a).filter((key) => key.startsWith('play.') && !b[key]);
    expect(only(en as Record<string, string>, fr as Record<string, string>)).toEqual([]);
    expect(only(fr as Record<string, string>, en as Record<string, string>)).toEqual([]);
  });
});
