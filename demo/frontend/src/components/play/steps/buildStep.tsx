import type { Session, SessionActions } from '../../../domain/game/session';
import type { T } from '../../../lib/i18n';
import type { PlayData } from '../../../lib/playData';
import type { GameData, Lang } from '../../../lib/types';
import CandidatesLayer from '../../map/layers/CandidatesLayer';
import TripsLayer from '../../map/layers/TripsLayer';
import type { PlayScene } from '../playScene';
import Budget from '../screens/Budget';
import Build from '../screens/Build';
import PlanIntro from '../screens/PlanIntro';
import type { StepParts } from './runStep';

/**
 * Step 1 — Decide: choose the budget, then place the stations while the city
 * moves as a hint. One panel, one page: the instructions and the budget cards
 * first, always visible, and the placement controls under them once a budget
 * is chosen. Nothing can be placed before that, so the map's layers and taps
 * stay live but the panel says what to do first.
 *
 * The map is the task here, so the panel is a meter and the layers are the
 * game: the city pulse (plan-technical §A.2), the free candidate sites, and
 * the visitor's own stations, which the shell adds. A tap goes through the
 * frame, never through a child's click handler (§C.1: the pan/zoom hook
 * captures the pointer).
 */
export interface BuildStepInput {
  readonly session: Session;
  readonly actions: SessionActions;
  readonly play: PlayData;
  readonly data: GameData;
  readonly scene: PlayScene;
  readonly periodName: string;
  /** Phone or tablet portrait: the panel pins its meter line and chips at the top. */
  readonly compact: boolean;
  readonly t: T;
  readonly lang: Lang;
}

export function buildStep(input: BuildStepInput): StepParts {
  const { session, actions, play, data, scene, t, lang } = input;
  // The instructions and the budget cards, together, whether or not a budget
  // is chosen yet: the whole step is one page.
  const head = (
    <>
      <PlanIntro t={t} />
      <Budget
        data={data}
        selected={session.budgetId}
        hasLayout={session.placed.length > 0}
        onChoose={actions.chooseBudget}
        t={t}
      />
    </>
  );
  return {
    panel: !session.budgetId ? (
      head
    ) : (
      <Build
        top={head}
        meter={scene.placement.budgetMeter}
        constants={play.constants!}
        reach={scene.placement.reach}
        demandTotal={play.demandTotal}
        byMe={session.placed.filter((s) => s.by === 'me').length}
        byAssistant={session.placed.filter((s) => s.by === 'assistant').length}
        canUndo={session.history.length > 0}
        roomLeft={scene.placement.budgetMeter.roomLeft}
        freeLeft={scene.free.length}
        compact={input.compact}
        lastTap={scene.placement.lastTap}
        playing={scene.playing}
        hour={scene.hour}
        onSeekHour={scene.seekHour}
        periodName={input.periodName}
        onPlaceRandom={actions.placeRandom}
        onUndo={actions.undo}
        onClear={actions.clearLayout}
        onTogglePlay={scene.togglePlay}
        t={t}
        lang={lang}
      />
    ),
    map: {
      children: (
        <>
          {scene.layers.pulse && <TripsLayer sprites={[...scene.pulse]} loop radius={1.05} tone="demand" />}
          {scene.layers.candidates && (
            <CandidatesLayer
              candidates={[...scene.free]}
              onToggle={(id) => {
                const candidate = play.candidates.find((entry) => entry.id === id);
                if (candidate) actions.toggleStation(candidate.index);
              }}
              label={(candidate) => t('play.build.candidate', { id: candidate.id })}
            />
          )}
        </>
      ),
      onTap: scene.onTap,
      doubleTapZoom: false,
    },
  };
}
