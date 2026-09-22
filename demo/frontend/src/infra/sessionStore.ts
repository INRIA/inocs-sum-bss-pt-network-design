/**
 * sessionStore.ts — keep the visitor's session across a reload.
 *
 * `localStorage` behind try/catch, everywhere. A private window, blocked site
 * data, a full quota or a server-side render are all normal outcomes, so every
 * method is total: reads return null, writes are dropped, nothing throws. The
 * game must work with storage entirely absent.
 *
 * The key carries a VERSION. A change to the session shape bumps it, so an old
 * saved session is ignored rather than half-restored into a new reducer.
 */
import type { SessionStore } from '../domain/game/ports';

/**
 * Bump when the stored shape or the stored CONTENT changes. Old keys are simply
 * never read again — v2 replaced the "week-end rhythm" poll with "bikes per
 * station", so a v1 session carried an answer to a question the game no longer
 * asks.
 */
export const SESSION_VERSION = 2;
export const SESSION_KEY = `sum-play-session-v${SESSION_VERSION}`;

/** The slice of the Web Storage API used here. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `localStorage`, or null when it is unavailable (SSR, blocked, disabled). */
export function defaultStorage(): StorageLike | null {
  try {
    if (typeof globalThis === 'undefined') return null;
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    return storage ?? null;
  } catch {
    // Accessing the property itself throws when site data is blocked.
    return null;
  }
}

export function createSessionStore(
  storage: StorageLike | null = defaultStorage(),
  key: string = SESSION_KEY,
): SessionStore {
  return {
    load(): unknown | null {
      if (!storage) return null;
      try {
        const raw = storage.getItem(key);
        return raw == null ? null : (JSON.parse(raw) as unknown);
      } catch {
        // Unreadable or corrupt: behave exactly as if nothing was saved.
        return null;
      }
    },
    save(value: unknown): void {
      if (!storage) return;
      try {
        storage.setItem(key, JSON.stringify(value));
      } catch {
        // Quota, private mode, serialisation cycle: persistence is best effort.
      }
    },
    clear(): void {
      if (!storage) return;
      try {
        storage.removeItem(key);
      } catch {
        // Nothing to do; the caller cannot act on this either.
      }
    },
  };
}
