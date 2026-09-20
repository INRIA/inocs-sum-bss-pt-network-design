/**
 * ports.ts — the session's outward contracts.
 *
 * Only the persistence port lives here for now; the session reducer itself
 * arrives with P3. Declared in the domain so `infra/sessionStore.ts` can be
 * swapped for a memory stub in tests without the domain knowing about
 * `localStorage`.
 *
 * Pure domain: no React, no DOM, no fetch, no node imports.
 */

/**
 * Somewhere to keep the visitor's session between reloads.
 *
 * Every method must be total: a private window, blocked site data or a quota
 * error is a normal outcome, not an exception the caller has to handle.
 */
export interface SessionStore {
  /** The stored value, or null when there is none (or it could not be read). */
  load(): unknown | null;
  /** Best effort. A failure to persist is swallowed, never thrown. */
  save(value: unknown): void;
  /** Best effort. Removes whatever `save` wrote. */
  clear(): void;
}
