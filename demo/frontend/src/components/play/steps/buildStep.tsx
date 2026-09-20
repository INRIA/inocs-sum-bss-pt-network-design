import type { Session, SessionActions } from '../../../domain/game/session';
import type { T } from '../../../lib/i18n';
import type { PlayData } from '../../../lib/playData';
import type { Lang } from '../../../lib/types';
import CandidatesLayer from '../../map/layers/CandidatesLayer';
import TripsLayer from '../../map/layers/TripsLayer';
import type { PlayScene } from '../playScene';
import Build from '../screens/Build';
import type { StepParts } from './runStep';

/**
 * Step 2 — Decide: place the stations while the city moves as a hint.
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
  readonly scene: PlayScene;
  readonly periodName: string;
  readonly t: T;
  readonly lang: Lang;
}

export function buildStep(input: BuildStepInput): StepParts {
  const { session, actions, play, scene, t, lang } = input;
  return {
    panel: (
      <Build
        meter={scene.placement.budgetMeter}
        constants={play.constants!}
        reach={scene.placement.reach}
        demandTotal={play.demandTotal}
        byMe={session.placed.filter((s) => s.by === 'me').length}
        byAssistant={session.placed.filter((s) => s.by === 'assistant').length}
        canUndo={session.history.length > 0}
        roomLeft={scene.placement.budgetMeter.roomLeft}
        lastTap={scene.placement.lastTap}
        playing={scene.playing}
        periodName={input.periodName}
        onAssist={actions.assist}
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
          {scene.layers.pulse && <TripsLayer sprites={[...scene.pulse]} loop radius={1.05} />}
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
