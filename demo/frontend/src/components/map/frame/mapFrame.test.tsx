/**
 * MapFrame slot layout (plan-technical.md §C.3): the chrome around the map is generic, but its
 * DOM order is a contract MapPanel's byte-identical rebuild depends on. This pins that order with
 * plain substring/index assertions — never a full markup snapshot.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MapFrame from './MapFrame';
import { makeT } from '../../../lib/i18n';

const t = makeT('en');

function render(popOpenContent = true) {
  return renderToStaticMarkup(
    <MapFrame
      id="test"
      ariaLabel="test map"
      t={t}
      top={<span className="TOP-MARK">top</span>}
      bottom={<span className="BOTTOM-MARK">bottom</span>}
      overlay={<div className="OVERLAY-MARK">overlay</div>}
      popover={popOpenContent ? <div className="POPOVER-MARK">popover</div> : null}
    >
      <circle className="LAYER-MARK" r={1} />
    </MapFrame>
  );
}

describe('MapFrame', () => {
  it('renders the documented slot order: top, canvas + overlay, chip, zoom, bottom', () => {
    const html = render();
    const iTop = html.indexOf('TOP-MARK');
    const iLayer = html.indexOf('LAYER-MARK');
    const iOverlay = html.indexOf('OVERLAY-MARK');
    const iChip = html.indexOf('layerchip');
    const iZoom = html.indexOf('mapzoom');
    const iBottom = html.indexOf('BOTTOM-MARK');

    expect(iTop).toBeGreaterThan(-1);
    expect(iLayer).toBeGreaterThan(iTop);
    expect(iOverlay).toBeGreaterThan(iLayer);
    expect(iChip).toBeGreaterThan(iOverlay);
    expect(iZoom).toBeGreaterThan(iChip);
    expect(iBottom).toBeGreaterThan(iZoom);
  });

  it('wraps the top and bottom slots in their legend bars, and the layers inside a clipped SVG', () => {
    const html = render();
    expect(html).toContain('class="maplegend maptop"');
    expect(html).toContain('class="maplegend mapbot"');
    expect(html).toContain('class="mapwrap"');
    expect(html).toContain('<svg');
    expect(html).toContain('LAYER-MARK');
  });

  it('does not render the popover unless it is open (chip toggles internal state)', () => {
    const html = render();
    // popOpen starts false, so the popover content is never in the initial markup
    expect(html).not.toContain('POPOVER-MARK');
    expect(html).not.toContain('class="layerpop"');
  });

  it('always renders the three zoom buttons', () => {
    const html = render();
    expect(html).toContain(t('map.zin'));
    expect(html).toContain(t('map.zout'));
    expect(html).toContain(t('map.zreset'));
  });
});
