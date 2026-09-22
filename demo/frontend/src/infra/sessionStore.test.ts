/**
 * sessionStore.test.ts — persistence must never be able to break the game.
 */
import { describe, expect, it } from 'vitest';

import { SESSION_KEY, createSessionStore, type StorageLike } from './sessionStore';

const memory = (): StorageLike & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
};

const throwing = (): StorageLike => ({
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('quota');
  },
  removeItem() {
    throw new Error('blocked');
  },
});

describe('sessionStore', () => {
  it('round-trips a value', () => {
    const storage = memory();
    const store = createSessionStore(storage);
    expect(store.load()).toBeNull();
    store.save({ step: 'build', placed: [1, 2, 3] });
    expect(store.load()).toEqual({ step: 'build', placed: [1, 2, 3] });
    store.clear();
    expect(store.load()).toBeNull();
  });

  it('writes under a versioned key', () => {
    const storage = memory();
    createSessionStore(storage).save({ a: 1 });
    expect([...storage.map.keys()]).toEqual([SESSION_KEY]);
    expect(SESSION_KEY).toMatch(/^sum-play-session-v\d+$/);
  });

  it('survives storage that throws on every call', () => {
    const store = createSessionStore(throwing());
    expect(() => store.save({ a: 1 })).not.toThrow();
    expect(store.load()).toBeNull();
    expect(() => store.clear()).not.toThrow();
  });

  it('survives no storage at all', () => {
    const store = createSessionStore(null);
    expect(() => store.save({ a: 1 })).not.toThrow();
    expect(store.load()).toBeNull();
    expect(() => store.clear()).not.toThrow();
  });

  it('treats corrupt content as nothing saved', () => {
    const storage = memory();
    storage.map.set(SESSION_KEY, '{not json');
    expect(createSessionStore(storage).load()).toBeNull();
  });

  it('drops a value it cannot serialise instead of throwing', () => {
    const storage = memory();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const store = createSessionStore(storage);
    expect(() => store.save(cyclic)).not.toThrow();
    expect(store.load()).toBeNull();
  });
});
