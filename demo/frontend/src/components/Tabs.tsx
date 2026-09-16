import type { T } from '../lib/i18n';

/**
 * The five steps as header tabs (plan.md section 7). Number + title for every step; the selected
 * tab is green and shows the step's subtitle under its title; a step already visited keeps a green
 * number. Any tab is clickable — the demo is a document, not a wizard.
 *
 * On mobile the row stays horizontal: the title moves under the number and only the selected tab
 * shows its subtitle (see global.css, `@media (max-width: 700px)`).
 */
export default function Tabs({
  step,
  visited,
  onGo,
  t,
}: {
  step: number;
  visited: number[];
  onGo: (i: number) => void;
  t: T;
}) {
  return (
    <nav className="tabs" aria-label={t('nav.aria')}>
      {[0, 1, 2, 3, 4].map((i) => (
        <button
          key={i}
          className={`tab${i === step ? ' cur' : visited.includes(i) ? ' done' : ''}`}
          aria-current={i === step ? 'step' : undefined}
          onClick={() => onGo(i)}
        >
          <span className="n">{i + 1}</span>
          <span className="t">{t(`tab.${i + 1}`)}</span>
          <span className="s">{t(`tabsub.${i + 1}`)}</span>
        </button>
      ))}
    </nav>
  );
}
