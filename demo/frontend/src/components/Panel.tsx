import type { ReactNode } from 'react';

/**
 * One step of the left accordion (ux-plan-v2 section 3). Exactly one panel is `open` (it takes
 * `flex:1` and fills the column); a step already played collapses to a `summary` row carrying its
 * one-line green conclusion and is clickable to revisit; a step not reached yet is `locked` at 50%
 * opacity. On mobile only the open panel is rendered visible — the stepper is the navigation.
 */
export type PanelState = 'open' | 'summary' | 'locked';

export default function Panel({
  letter,
  title,
  summary,
  state,
  bodyClass,
  onOpen,
  children,
}: {
  letter: string;
  title: string;
  summary: string;
  state: PanelState;
  bodyClass: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <article className={`panel ${state}`}>
      <button className="phead" onClick={onOpen} disabled={state === 'locked'}>
        <span className="pdot">{letter}</span>
        <span className="plbl">{title}</span>
        <span className="psum">{summary}</span>
      </button>
      <div className={`pbody ${bodyClass}`}>{children}</div>
    </article>
  );
}
