"""
Adaptive Large Neighborhood Search over the station-design space, following
the classic Ropke & Pisinger (2006) scheme: roulette-wheel adaptive operator
selection with segment-based weight updates, simulated-annealing acceptance.
"""
import math
import random
import time
from dataclasses import dataclass, field

from alns_solver.design import feasible_to_add
from alns_solver.operators import (
    DESTROY_OPERATORS, REPAIR_OPERATORS, build_station_score,
    build_coverage_structures, max_coverage_greedy,
)
from alns_solver.oracles import PersistentOperationalModel, solve_root_relaxation


@dataclass
class ALNSConfig:
    max_iterations: int = 2000
    # Real stopping conditions are max_iterations and no_improve_limit; this
    # is only a safety net against a run hanging, not a target budget.
    max_time_seconds: float = 3600.0
    # Stop early once this many iterations pass with no new best (a
    # convergence signal), even if max_iterations hasn't been reached yet.
    no_improve_limit: int = 400
    segment_size: int = 25
    # Sampled fresh each iteration from [destroy_frac_min, destroy_frac_max].
    # A/B-tested randomizing this (0.10-0.30) plus a periodic stagnation
    # "kick" (destroy_frac x2.5 every 100 non-improving iterations) against
    # a fixed 0.15/no-kick baseline on BOTH an easy instance (T=3: 0.40% vs
    # 2.53% gap) and a hard one (T=8/50%: 8.12% vs 8.20-8.36% gap, even with
    # 3.75x more patience budget) -- randomization+kick lost both times.
    # Defaulting to the fixed/no-kick values that actually won; the knobs
    # stay available (destroy_frac_min==max collapses to "fixed") for future
    # retuning, just not enabled out of the box.
    destroy_frac_min: float = 0.15
    destroy_frac_max: float = 0.15
    stagnation_kick_every: int = 0
    stagnation_kick_multiplier: float = 2.5
    reaction_factor: float = 0.3
    score_new_best: float = 5.0
    score_improved: float = 3.0
    score_accepted: float = 1.0
    score_rejected: float = 0.0
    # Objective swings between accepted moves on this problem run in the
    # hundreds (station-level design changes), not the single digits -- a
    # low starting temperature (e.g. 0.03 * initial_obj) makes SA reject
    # almost every worse move, degenerating into greedy hill-climbing that
    # plateaus at the first local optimum (observed: stuck ~13% above the
    # known exact optimum after iteration ~120 out of 400).
    sa_start_temp_frac: float = 0.15
    sa_cooling_rate: float = 0.999
    seed: int = 42
    # Solve the full LP relaxation (y continuous, jointly optimised with
    # everything else -- not the fixed-y oracle) once before the search
    # starts, and use the fractional y* as the construction prior instead of
    # the purely structural build_station_score. A/B-tested across 5 seeds
    # on the baseline instance: CONSISTENTLY worse (avg gap 1.77% vs 0.34%)
    # and converged faster (got stuck sooner) every single time -- the LP's
    # fractional ranking makes an overconfident-looking initial design that
    # the search then struggles to escape. Defaulting to off; the machinery
    # (and cached y_reduced_cost) stays available for a future dual-guided
    # operator, which is a different use than raw construction ranking.
    use_root_relaxation_prior: bool = False
    # Initial construction: max-coverage greedy (models constraint (4)'s
    # station-gating coupling -- a path needs several stations open
    # simultaneously before it contributes anything, so a station's true
    # marginal value depends on what's already open) instead of a static
    # per-station score. Monotone submodular under the budget constraint,
    # so this greedy carries the classical (1-1/e) approximation guarantee
    # relative to the best subset under this coverage proxy -- but as a
    # ONE-SHOT, hard-committed initial design it turned out to be the same
    # kind of overconfident trap as use_root_relaxation_prior: mild net
    # positive on the T=3 baseline (5 seeds), but isolated A/B on T=5
    # (100%/80% density, old vs new construction with score held fixed
    # either way) showed it ALONE roughly doubles the gap (2.28%->4.55%,
    # 1.68%->4.35%), with zero seed-to-seed variance -- not noise, a real
    # instance-dependent regression. Defaulting to off. The same coverage
    # logic is still exposed to the search as the max_coverage_repair
    # REPAIR_OPERATORS entry (an ongoing, adaptively-weighted *option*
    # rather than a one-time hard commitment), which is the safer way to
    # let it help when it actually does without being able to single-
    # handedly wreck a run when it doesn't.
    use_max_coverage_construction: bool = False


@dataclass
class ALNSResult:
    best_design: frozenset
    best_obj: float
    best_result: object
    history: list = field(default_factory=list)  # (iter, elapsed, obj, best_obj, accepted)
    oracle_calls: int = 0
    cache_hits: int = 0
    total_oracle_time: float = 0.0
    destroy_weights: dict = field(default_factory=dict)
    repair_weights: dict = field(default_factory=dict)
    stop_reason: str = ""
    iterations_run: int = 0
    # y's reduced costs from the root LP relaxation (empty dict if
    # use_root_relaxation_prior was False) -- not consumed by any operator
    # yet, cached here for a future dual-guided destroy/repair operator.
    y_reduced_cost: dict = field(default_factory=dict)


def run_alns(context, oracle_fn, config: ALNSConfig = None, pool=None):
    """oracle_fn(pool, design) -> OracleResult. Pass a pre-built `pool`
    (alns_solver.oracles.PersistentOperationalModel) to share it across
    multiple ALNS runs/oracle comparisons on the same context; otherwise one
    is built here (the ~3.4s one-time model-construction cost)."""
    config = config or ALNSConfig()
    rng = random.Random(config.seed)
    pool = pool or PersistentOperationalModel(context)

    y_reduced_cost = {}
    if config.use_root_relaxation_prior:
        # Must run before any set_design()/oracle_fn(pool, ...) call fixes
        # y's bounds on the pool -- see solve_root_relaxation's docstring.
        station_score, y_reduced_cost = solve_root_relaxation(pool)
    else:
        station_score = build_station_score(context)

    cache = {}

    def evaluate(design):
        nonlocal cache
        if design in cache:
            result_, was_cached = cache[design], True
        else:
            result_ = oracle_fn(pool, design)
            cache[design] = result_
            was_cached = False
        return result_, was_cached

    oracle_calls = 0
    cache_hits = 0
    total_oracle_time = 0.0

    # Built unconditionally: max_coverage_repair (a REPAIR_OPERATORS entry,
    # always in the pool) needs this regardless of whether the one-off
    # initial construction uses it too.
    coverage = build_coverage_structures(context)

    if config.use_max_coverage_construction:
        current_design = max_coverage_greedy(context.Q, context.B, coverage)
    else:
        current_design = REPAIR_OPERATORS["greedy_insertion"](
            frozenset(), rng, context.Q, context.B, station_score=station_score,
        )
    current_result, cached = evaluate(current_design)
    if not cached:
        oracle_calls += 1
        total_oracle_time += current_result.runtime
    best_design, best_result = current_design, current_result
    best_obj = current_result.obj_val

    destroy_names = list(DESTROY_OPERATORS)
    repair_names = list(REPAIR_OPERATORS)
    destroy_weights = {n: 1.0 for n in destroy_names}
    repair_weights = {n: 1.0 for n in repair_names}
    destroy_scores = {n: 0.0 for n in destroy_names}
    repair_scores = {n: 0.0 for n in repair_names}
    destroy_uses = {n: 0 for n in destroy_names}
    repair_uses = {n: 0 for n in repair_names}

    temperature = config.sa_start_temp_frac * max(abs(best_obj), 1.0)

    history = []
    t_start = time.time()
    iters_since_improvement = 0
    stop_reason = "max_iterations"
    it = 0

    for it in range(1, config.max_iterations + 1):
        elapsed = time.time() - t_start
        if elapsed >= config.max_time_seconds:
            stop_reason = "max_time_seconds"
            break
        if iters_since_improvement >= config.no_improve_limit:
            stop_reason = "converged_no_improve"
            break

        d_name = rng.choices(destroy_names, weights=[destroy_weights[n] for n in destroy_names])[0]
        r_name = rng.choices(repair_names, weights=[repair_weights[n] for n in repair_names])[0]

        destroy_frac = rng.uniform(config.destroy_frac_min, config.destroy_frac_max)
        is_kick = (
            config.stagnation_kick_every > 0
            and iters_since_improvement > 0
            and iters_since_improvement % config.stagnation_kick_every == 0
        )
        if is_kick:
            destroy_frac = min(0.9, destroy_frac * config.stagnation_kick_multiplier)
        q = max(1, round(destroy_frac * max(len(current_design), 1)))
        destroyed = DESTROY_OPERATORS[d_name](
            current_design, rng, q, station_flow=current_result.station_flow,
            station_score=station_score,
        )
        candidate = REPAIR_OPERATORS[r_name](
            destroyed, rng, context.Q, context.B, station_score=station_score,
            station_flow=best_result.station_flow, current_result=best_result,
            coverage=coverage,
        )

        result, cached = evaluate(candidate)
        if cached:
            cache_hits += 1
        else:
            oracle_calls += 1
            total_oracle_time += result.runtime

        accepted = False
        score = config.score_rejected
        iters_since_improvement += 1
        if result.feasible:
            if result.obj_val > best_obj + 1e-9:
                accepted = True
                score = config.score_new_best
                best_design, best_result, best_obj = candidate, result, result.obj_val
                iters_since_improvement = 0
            elif result.obj_val > current_result.obj_val + 1e-9:
                accepted = True
                score = config.score_improved
            else:
                delta = result.obj_val - current_result.obj_val
                accept_prob = math.exp(delta / temperature) if temperature > 1e-9 else 0.0
                if rng.random() < accept_prob:
                    accepted = True
                    score = config.score_accepted

        if accepted:
            current_design, current_result = candidate, result

        destroy_scores[d_name] += score
        repair_scores[r_name] += score
        destroy_uses[d_name] += 1
        repair_uses[r_name] += 1

        temperature *= config.sa_cooling_rate

        if it % config.segment_size == 0:
            for n in destroy_names:
                if destroy_uses[n] > 0:
                    avg = destroy_scores[n] / destroy_uses[n]
                    destroy_weights[n] = (1 - config.reaction_factor) * destroy_weights[n] + config.reaction_factor * avg
                destroy_scores[n], destroy_uses[n] = 0.0, 0
            for n in repair_names:
                if repair_uses[n] > 0:
                    avg = repair_scores[n] / repair_uses[n]
                    repair_weights[n] = (1 - config.reaction_factor) * repair_weights[n] + config.reaction_factor * avg
                repair_scores[n], repair_uses[n] = 0.0, 0

        history.append((it, time.time() - t_start, result.obj_val if result.feasible else None,
                        best_obj, accepted))

    return ALNSResult(
        best_design=best_design, best_obj=best_obj, best_result=best_result,
        history=history, oracle_calls=oracle_calls, cache_hits=cache_hits,
        total_oracle_time=total_oracle_time,
        destroy_weights=destroy_weights, repair_weights=repair_weights,
        stop_reason=stop_reason, iterations_run=len(history),
        y_reduced_cost=y_reduced_cost,
    )
