import { useState } from 'react';

import type { T } from '../../../lib/i18n';
import type { GameData, Lang } from '../../../lib/types';
import Step5 from '../../Step5';

/**
 * Step 6 — the full demo's "compare plans" step (its step 5), shown as is.
 *
 * `Step5` holds no state of its own, so this only owns which proofs are open,
 * the same way `Game.tsx` does; the content is the full demo's, not a copy.
 */
export default function ComparePlans({
  data,
  onRestart,
  lang,
  t,
}: {
  data: GameData;
  onRestart: () => void;
  lang: Lang;
  t: T;
}) {
  const [open, setOpen] = useState<number[]>([]);
  const toggle = (n: number): void =>
    setOpen((current) => (current.includes(n) ? current.filter((x) => x !== n) : [...current, n]));
  return <Step5 data={data} t={t} lang={lang} open={open} onToggle={toggle} onRestart={onRestart} />;
}
