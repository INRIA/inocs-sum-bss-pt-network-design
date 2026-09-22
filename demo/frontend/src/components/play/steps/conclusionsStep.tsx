import type { BudgetReference } from '../../../domain/evaluation/types';
import { BUDGET_SCENARIO, type Session, type SessionActions } from '../../../domain/game/session';
import StationsLayer from '../../map/layers/StationsLayer';
import type { T } from '../../../lib/i18n';
import type { GameData, Lang } from '../../../lib/types';
import type { PlayScene } from '../playScene';
import ComparePlans from '../screens/ComparePlans';
import type { StepParts } from './runStep';
import { planOf } from '../optimiserFacts';
import { browsingOf } from './optimiserStep';

/**
 * Step 6 — Reflect: the full demo's "compare plans" content, shown as is.
 */
export interface ConclusionsStepInput {
  readonly session: Session;
  readonly actions: SessionActions;
  readonly scene: PlayScene;
  readonly data: GameData;
  readonly reference: BudgetReference | null;
  readonly t: T;
  readonly lang: Lang;
}

/** The morning served rate of the sharp-peak run: the rush proof's third figure. */
export function sharpMorning(data: GameData): number | null {
  const sharp = data.scenarios.find((sc) => sc.id === 'rhythm_sharp')?.paper ?? null;
  if (!sharp) return null;
  const demand = sharp.demandByPeriod[0] ?? 0;
  return demand > 0 ? (sharp.servedByPeriod[0] ?? 0) / demand : null;
}

export function conclusionsStep(input: ConclusionsStepInput): StepParts {
  const { session, actions, scene, data, t, lang } = input;
  // The panel is the full demo's "compare plans" step, unchanged.
  const panel = <ComparePlans data={data} onRestart={actions.restart} lang={lang} t={t} />;

  const browsing = browsingOf(session);
  const optimiserPlan = planOf(data, BUDGET_SCENARIO[browsing]);
  return {
    panel,
    map: {
      children:
        scene.layers.plan && optimiserPlan ? (
          <StationsLayer
            variant="plan"
            stations={optimiserPlan.stations}
            show={{ transfer: true, regular: true, capacity: false, inventory: false }}
            period={0}
            dropKey={0}
            t={t}
          />
        ) : null,
      stations:
        scene.layers.ghost && scene.mine.length > 0 ? (
          <StationsLayer variant="ghost" stations={scene.mine.map((s) => ({ x: s.x, y: s.y }))} />
        ) : null,
    },
  };
}
