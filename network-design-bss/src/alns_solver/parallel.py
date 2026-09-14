"""
Run several independent ALNS chains (different seeds) in separate
processes and keep the best result. Orthogonal to every other improvement
here -- oracle calls are cheap enough (26-45ms on the baseline instance)
that running N chains in parallel for the same wall-clock budget as one
chain is a straightforward way to hedge against any single chain getting
stuck in a bad basin, at the cost of N x the CPU.

Each worker rebuilds its own ProblemContext/PersistentOperationalModel from
scratch rather than trying to share Gurobi objects across the process pool
(gurobipy models aren't picklable, and sharing one Environment across
processes isn't supported) -- confirmed the academic license permits
multiple concurrent Gurobi processes before writing this.
"""
import multiprocessing as mp

from alns_solver.oracles import PersistentOperationalModel, solve_mip_gurobi, solve_lp_gurobi
from alns_solver.alns import ALNSConfig, run_alns


def _run_chain(args):
    context_builder, context_args, seed, alns_kwargs, polish_time_limit = args
    build_result = context_builder(*context_args)
    context = build_result[-1] if isinstance(build_result, tuple) else build_result

    pool = PersistentOperationalModel(context)
    cfg = ALNSConfig(seed=seed, **alns_kwargs)
    result = run_alns(context, solve_lp_gurobi, cfg, pool=pool)

    warm = {"w": result.best_result.w, "v1": result.best_result.v1}
    polished = solve_mip_gurobi(pool, result.best_design, time_limit=polish_time_limit, warm_hints=warm)

    return {
        "seed": seed,
        "approx_obj": result.best_obj,
        "polished_obj": polished.obj_val if polished.feasible else None,
        "iterations_run": result.iterations_run,
        "oracle_calls": result.oracle_calls,
        "stop_reason": result.stop_reason,
        "station_ids": sorted(s.node_id for s in result.best_design),
    }


def run_alns_parallel(context_builder, context_args, seeds, alns_kwargs=None,
                      polish_time_limit=120.0, n_workers=None):
    """context_builder(*context_args) must return a ProblemContext, or a
    tuple ending in one (matching build_context/build_grid_context's
    (config, context) return shape) -- must be a module-level function
    (picklable), not a closure.

    Returns (best_result_dict, all_result_dicts)."""
    alns_kwargs = alns_kwargs or {}
    n_workers = n_workers or len(seeds)
    tasks = [
        (context_builder, context_args, seed, alns_kwargs, polish_time_limit)
        for seed in seeds
    ]
    with mp.get_context("spawn").Pool(processes=n_workers) as pool:
        results = pool.map(_run_chain, tasks)

    feasible = [r for r in results if r["polished_obj"] is not None]
    best = max(feasible, key=lambda r: r["polished_obj"]) if feasible else None
    return best, results
