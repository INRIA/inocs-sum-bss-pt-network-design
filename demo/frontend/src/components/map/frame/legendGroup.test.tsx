/**
 * LegendGroup (plan-technical.md §C.3): a generic legend item list. `Legend.tsx`'s `LayerToggles`
 * is pinned byte-for-byte by the map guard; this tests the generic primitive directly.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LegendGroup, { type LegendItem } from './LegendGroup';

type Key = 'a' | 'b';

const items: LegendItem<Key>[] = [
  { key: 'a', label: 'Alpha', swatch: <i className="sw-a" />, pressed: true },
  { key: 'b', label: 'Beta', swatch: <i className="sw-b" />, pressed: false },
];

describe('LegendGroup', () => {
  it('renders one button per item, each with its label and swatch', () => {
    const html = renderToStaticMarkup(<LegendGroup items={items} onToggle={() => {}} />);
    expect(html.split('class="legit"').length - 1).toBe(2);
    expect(html).toContain('>Alpha<');
    expect(html).toContain('>Beta<');
    expect(html).toContain('class="sw-a"');
    expect(html).toContain('class="sw-b"');
  });

  it('reflects pressed state as aria-pressed', () => {
    const html = renderToStaticMarkup(<LegendGroup items={items} onToggle={() => {}} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });

  it('accepts an onToggle callback typed to the item key', () => {
    const onToggle = vi.fn((_k: Key) => {});
    expect(() => renderToStaticMarkup(<LegendGroup items={items} onToggle={onToggle} />)).not.toThrow();
  });
});
