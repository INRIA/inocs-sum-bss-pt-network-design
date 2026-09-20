# `domain/game` — the application logic of the planner game

Pure TypeScript: no React, no DOM, no `fetch`, no node imports. **The dependency
rule (plan-technical §C.2): this folder imports nothing from the project except
other `domain/` modules.** `infra/` imports `domain`, hooks import `domain` and
`infra`, components import hooks. Anything here that needs a number the model
produces takes it as an argument — it never reaches for `lib/`, a fixture or a
file. Screens format and translate; this layer only computes, and returns i18n
KEYS (`play.*`) where a word is needed.

A station is an INTEGER here: its index in `GameData.candidates`, the interning
contract of `domain/evaluation/types.ts`, so a layout can go straight to the
evaluator, the reach table and the hit test without a lookup.

## `steps.ts` — the route

The six tracker steps (`budget`, `build`, `predict`, `run`, `optimiser`,
`conclusions`) behind one untracked `entry`, each with a label key and the
rhythm verb of plan.md §2. `canEnter(step, session)` returns `{ ok }` or
`{ ok: false, reasonKey }`: build needs a budget, predict a station, run the
five step-3 answers, optimiser an evaluation, conclusions a visit to the
optimiser. `furthestAllowed` is where an invalid deep link lands, and
`progress(session)` gives the tracker its index plus the fraction inside the
step (stations against a soft target while building, answers while predicting).

## `session.ts` — state, reducer, persistence

`Session` is the whole game: budget, placed stations with `by: 'me' |
'assistant'`, a bounded undo history, the predictions, the step and the visited
steps, the trucks switch, and the evaluation **without its flows** (they are
bulky and only the run animation wants them; `useEvaluation` keeps them in
memory, keyed by hash). `reduce` is total — an action it cannot honour returns
the state unchanged — and the matching queries (`canPlace`, `canEnter`) give the
reason. Any layout change drops the evaluation; **choosing a different budget
clears everything downstream, predictions included**, because "under 40 %" does
not mean the same thing at 20 k€ and at 120 k€. `layoutHash` is the identity of
"this layout at this budget". `createActions` binds the typed action surface to
a dispatch, and `serialize` / `deserialize` are the only bridge to storage:
`deserialize` never throws and returns null for an unknown version or a
malformed blob (the undo history is not persisted).

## `predictions.ts` — the six polls, as data

`PREDICTIONS` carries each question's i18n keys, its options, where it is asked
(`predict`, or `optimiser` for "double the budget") and which conclusion card of
the full demo it links to. One resolver per question returns
`{ predictionId, chosen, actual, matched, facts }`, where `facts` holds the
numbers the reveal sentence interpolates — no prose. `matched` is never a score;
it picks the tone. The bands are documented at each resolver and sit between the
option values, so the option nearest the truth is the true one: served 40/70/90
per cent, PT share 0.15/0.30/0.50, rush 3 and 10 percentage points, trucks 0 and
20 runs (the optimiser's exact count, never the relaxed LP's), "double" 1.20 and
1.70 on the served ratio. The rhythm answer is computed from the two plans'
station lists, not hard-coded.

## `ticket.ts` — the recap of step 6

Budget, how many stations the visitor placed and how many the assistant did,
every prediction with its resolution, and the three marks of the served line
(random planner · you · optimiser), all measured by the same engine and
following the trucks switch. Returns null before there is anything to replay.

## `results.ts` — the view-model of steps 4 and 5

`resultsView` turns one evaluation into the hero, the three tiles (PT share;
midday against the mean of the two peaks; trips that depend on trucks), the
per-period series, the losses by cause and the "what you built" facts. It never
gives the visitor a truck count. `optimiserView` builds the same shape for the
optimiser's column from `references.json` — the browser's own engine on the
optimiser's layout — with the published paper figure carried alongside for the
proof popup, and fills docks, bikes, truck runs and the per-period split from
the run's paper KPIs when the screen passes them. `compare` returns the
"You · Optimiser" rows in the order plan.md §2bis asks for: stations, docks,
bikes, truck runs (optimiser only), then served trips.

## Hooks

`src/hooks/` wires this layer to React and stays thin: `useGameSession` (state
plus persistence, hydrated after mount), `useHashStep` (`#/step/<id>` both
ways), `usePlacement` (tap → hit test → decision, plus the reach preview and the
budget meter), `useEvaluation` (both solves while the visitor predicts, with the
estimate fallback), `useViewport`. Their non-trivial logic lives in the pure
neighbours `hashStep.ts`, `viewport.ts` and `evaluationPair.ts`, which are the
tested parts.
