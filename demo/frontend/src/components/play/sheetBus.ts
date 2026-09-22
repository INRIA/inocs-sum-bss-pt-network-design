/**
 * sheetBus.ts — the one channel a control inside the step card has to the
 * bottom sheet that CONTAINS it.
 *
 * The sheet is owned by `StepShell`; the step's content is assembled far from
 * it by `useStepContent`, which has no handle on it and should not get one —
 * a step describes what to show, never how the shell is laid out
 * (plan-technical §C.3). One control genuinely needs the exception: the "Help
 * me" chip pinned in the peek area of the phone's Build step must open the
 * sheet far enough to show the slider it is about to focus.
 *
 * So: a request, not a command. Anyone may ask for a snap; the shell decides
 * whether it applies (on a desktop the sheet CSS is inert and the request is a
 * no-op). No DOM events, no globals beyond this module, nothing to clean up
 * but the returned unsubscribe.
 */
import type { Snap } from '../../lib/useBottomSheet';

type Listener = (snap: Snap) => void;

const listeners = new Set<Listener>();

/** Ask the shell to open the sheet to `snap`. Safe to call with no listener. */
export function requestSnap(snap: Snap): void {
  for (const listener of [...listeners]) listener(snap);
}

/** Listen for snap requests. Returns the unsubscribe. */
export function onSnapRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
