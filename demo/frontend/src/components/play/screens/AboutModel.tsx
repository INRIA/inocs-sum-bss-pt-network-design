import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { T } from '../../../lib/i18n';

/**
 * "About the research model": a button and the modal it opens, reusing the
 * full demo's `.sheetbg` / `.sheet` look. The modal is portalled to the body so
 * the step card's scroll container and the phone's bottom sheet cannot clip or
 * offset it; nothing is rendered on the server, so markup stays identical.
 */
export default function AboutModel({ t }: { t: T }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button className="ghostbtn playabout" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {t('play.about.cta')}
      </button>
      {open &&
        createPortal(
          <div className="sheetbg open" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label={t('play.about.title')}>
              <button className="close" onClick={() => setOpen(false)} aria-label={t('sheet.close')}>
                ×
              </button>
              <h3>{t('play.about.title')}</h3>
              <div className="playaboutbody">
                <p>{t('play.about.p1')}</p>
                <p>{t('play.about.p2')}</p>
                <p>{t('play.about.p3')}</p>
                <p>{t('play.about.p4')}</p>
                <p>{t('play.about.p5')}</p>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
