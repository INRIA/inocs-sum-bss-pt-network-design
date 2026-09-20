/**
 * hashStep.test.ts — the deep-link grammar.
 *
 * `useHashStep` is a subscription around these two functions, so pinning them
 * pins the behaviour that matters: an unknown hash names nothing, and a hash
 * the session cannot honour walks back one step at a time.
 */
import { describe, expect, it } from 'vitest';

import { STEP_HASH_PREFIX, parseStepHash, stepHash, stepsBackFrom } from './hashStep';

describe('parseStepHash', () => {
  it('reads every step, with or without the leading hash or a trailing slash', () => {
    expect(parseStepHash('#/step/build')).toBe('build');
    expect(parseStepHash('/step/conclusions')).toBe('conclusions');
    expect(parseStepHash('#/step/entry/')).toBe('entry');
  });

  it('names nothing for anything else', () => {
    for (const hash of ['', '#', '#/step/', '#/step/nowhere', '#build', '#/steps/build']) {
      expect(parseStepHash(hash)).toBeNull();
    }
  });

  it('round-trips with stepHash', () => {
    expect(stepHash('optimiser')).toBe(`${STEP_HASH_PREFIX}optimiser`);
    expect(parseStepHash(stepHash('optimiser'))).toBe('optimiser');
  });
});

describe('stepsBackFrom', () => {
  it('tries the step itself first, then every earlier one', () => {
    expect(stepsBackFrom('predict')).toEqual(['predict', 'build', 'budget', 'entry']);
    expect(stepsBackFrom('entry')).toEqual(['entry']);
  });

  it('falls back to the whole route, latest first, for an unknown step', () => {
    expect(stepsBackFrom('nowhere' as never)[0]).toBe('conclusions');
  });
});
