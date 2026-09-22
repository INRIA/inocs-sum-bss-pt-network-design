import type { ReactNode } from 'react';
import type { FrameSlot } from '../map/frame/MapFrame';
import type { Snap } from '../../lib/useBottomSheet';

/**
 * What one step asks the shell to show.
 *
 * Every step gets the SAME template (UX reference §3, plan-technical §B.1): a
 * one-line brief, the content, exactly ONE primary action, and the rhythm verb
 * of plan.md §2. The map is described, never rendered, by the step: the shell
 * mounts it once and only swaps the layers and slots this object names, which
 * is the point of the map refactor (plan-technical §C.3).
 */
export interface PrimaryAction {
  readonly label: string;
  readonly onClick: () => void;
  /**
   * The action is a navigation: the shell renders an anchor instead of a
   * button, so it opens in a new tab, copies, and reads as a link. `onClick`
   * stays the keyboard path (ArrowRight in guided mode).
   */
  readonly href?: string;
  readonly disabled?: boolean;
  /** A discreet line under the action — a guard reason, or a status. */
  readonly note?: string;
  /** Renders green rather than blue: the action that ends a step. */
  readonly go?: boolean;
}

export interface StepMap {
  readonly children: ReactNode;
  readonly top?: FrameSlot;
  readonly bottom?: FrameSlot;
  readonly overlay?: FrameSlot;
  readonly popover?: FrameSlot;
  readonly onTap?: (point: { x: number; y: number }) => void;
  readonly doubleTapZoom?: boolean;
}

export interface StepView {
  /** "Here you will…" — one line, read in five seconds (UX reference §7). */
  readonly brief: string;
  /** Read → Decide → Observe → Reflect, from `STEP_DEFS[step].rhythmKey`. */
  readonly rhythm: string;
  readonly panel: ReactNode;
  readonly primary: PrimaryAction | null;
  readonly map: StepMap;
  /**
   * Where the phone's bottom sheet should sit RIGHT NOW, when that depends on
   * more than the step: the Run step peeks while the day plays and rises to
   * `full` as soon as there are results (plan-technical §B.2). Omitted, the
   * shell keeps the step's own snap.
   */
  readonly snap?: Snap;
  /** What Space does on this step in guided mode: pause the pulse, replay the day. */
  readonly onSpace?: () => void;
}
