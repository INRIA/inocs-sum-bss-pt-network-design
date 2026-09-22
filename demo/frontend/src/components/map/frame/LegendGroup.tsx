import type { ReactNode } from 'react';

export interface LegendItem<K extends string> {
  key: K;
  label: string;
  swatch: ReactNode;
  pressed: boolean;
}

/**
 * The legend item button, generic over its key type (plan-technical.md §C.3): a swatch, a label,
 * and its own show/hide state as `aria-pressed`. Emits the same markup `LayerToggles` always has —
 * moving it here does not change what either legend bar renders.
 */
export default function LegendGroup<K extends string>({
  items,
  onToggle,
}: {
  items: LegendItem<K>[];
  onToggle: (k: K) => void;
}) {
  return (
    <>
      {items.map((it) => (
        <button key={it.key} className="legit" aria-pressed={it.pressed} onClick={() => onToggle(it.key)}>
          {it.swatch}
          <span>{it.label}</span>
        </button>
      ))}
    </>
  );
}
