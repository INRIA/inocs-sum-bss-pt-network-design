"""
Benchmark: direct Gurobi full-MIP vs ALNS (Gurobi-LP oracle / HiGHS-LP
oracle, both on a PersistentOperationalModel so repeated design evaluations
don't pay Gurobi's ~3.4s Python-side model-construction cost every time) on
the small baseline instance (372 real OD pairs, T=3, budget=80,000) used
throughout this project's scale/capability testing.

Run: PYTHONPATH=. .venv/bin/python alns_solver/benchmark.py
"""
import random
import time

from input_handler.instance_attribute_extracter import get_instance_attribute
from instance_builder import generate_h3_instances
from main import get_shortest_path_solver, main_run_single_instance
from util.util import EPSILON

from alns_solver.context import ProblemContext
from alns_solver.oracles import PersistentOperationalModel, solve_mip_gurobi, solve_lp_gurobi, solve_lp_highs
from alns_solver.operators import build_station_score, greedy_insertion
from alns_solver.alns import ALNSConfig, run_alns


def build_context(epsilon=EPSILON):
    config = generate_h3_instances()
    _configure, demand_generator, grid_generator, public_transport, station_layout = \
        get_instance_attribute(config)
    network_with_bss, shortest_path_solver = get_shortest_path_solver(
        grid_generator, public_transport, station_layout
    )
    context = ProblemContext(network_with_bss, shortest_path_solver, demand_generator, epsilon)
    return config, context


def time_repeated_oracle_calls(pool, designs, fn, name, n_repeat=1):
    times = []
    obj = None
    for design in designs:
        t0 = time.time()
        result = fn(pool, design)
        times.append(time.time() - t0)
        obj = result.obj_val
    avg_ms = sum(times) / len(times) * 1000
    print(f"  {name:12s} n_calls={len(times):3d}  avg={avg_ms:8.2f}ms  "
          f"min={min(times) * 1000:7.2f}ms  max={max(times) * 1000:7.2f}ms  last_obj~={obj:.2f}")
    return times


def bench_naive_vs_persistent(context, designs):
    print("\n=== naive (rebuild model per call) vs persistent (reuse model, only refix y) ===")

    print(" naive rebuild-from-scratch per call (what a first-cut implementation would do):")
    naive_times = []
    for design in designs:
        t0 = time.time()
        from alns_solver.oracles import PersistentOperationalModel as _POM
        fresh_pool = _POM(context)
        result = solve_lp_gurobi(fresh_pool, design)
        naive_times.append(time.time() - t0)
    print(f"  lp_gurobi (rebuilt each time)  n_calls={len(naive_times)}  "
          f"avg={sum(naive_times) / len(naive_times) * 1000:8.2f}ms")

    print(" persistent model (build once, refix y bounds per call):")
    pool = PersistentOperationalModel(context)
    time_repeated_oracle_calls(pool, designs, solve_mip_gurobi, "mip_gurobi")
    time_repeated_oracle_calls(pool, designs, solve_lp_gurobi, "lp_gurobi")
    time_repeated_oracle_calls(pool, designs, solve_lp_highs, "lp_highs")
    return pool


def run_direct_full_mip(config):
    print("\n=== direct Gurobi full MIP (y free) ===")
    t0 = time.time()
    bike_sharing_model, *_ = main_run_single_instance(config, epsilon=EPSILON, solve_mode="integrated")
    wall = time.time() - t0
    m = bike_sharing_model.model
    print(f"  wall={wall:.3f}s  status={m.Status}  obj={m.ObjVal:.4f}  "
          f"gap={m.MIPGap:.4f}  runtime={m.Runtime:.3f}s")
    return m.ObjVal, m.Runtime


def polish_with_exact_mip(pool, alns_result):
    warm = {"w": alns_result.best_result.w, "v1": alns_result.best_result.v1}
    return solve_mip_gurobi(pool, alns_result.best_design, time_limit=120.0, warm_hints=warm)


def run_alns_variant(context, oracle_name, oracle_fn, config: ALNSConfig):
    print(f"\n=== ALNS with {oracle_name} oracle ===")
    pool = PersistentOperationalModel(context)
    t0 = time.time()
    result = run_alns(context, oracle_fn, config, pool=pool)
    wall = time.time() - t0
    print(f"  wall={wall:.3f}s  oracle_calls={result.oracle_calls}  "
          f"cache_hits={result.cache_hits}  total_oracle_time={result.total_oracle_time:.3f}s  "
          f"avg_oracle_call={result.total_oracle_time / max(result.oracle_calls, 1) * 1000:.2f}ms")
    print(f"  ALNS best_obj (approx, from {oracle_name}) = {result.best_obj:.4f}  "
          f"|design|={len(result.best_design)}")

    polished = polish_with_exact_mip(pool, result)
    print(f"  exact MIP polish of best design: feasible={polished.feasible}  "
          f"obj={polished.obj_val:.4f}")

    milestones = []
    seen = set()
    for it, elapsed, obj, best_obj, accepted in result.history:
        key = round(best_obj, 2)
        if key not in seen:
            seen.add(key)
            milestones.append((it, elapsed, best_obj))
    print("  convergence milestones (iter, elapsed_s, best_obj):")
    for it, elapsed, best_obj in milestones[:15]:
        print(f"    iter={it:4d}  t={elapsed:6.2f}s  best_obj={best_obj:.2f}")

    return result, wall, polished


def main():
    config, context = build_context()

    station_score = build_station_score(context)
    designs = [
        greedy_insertion(frozenset(), random.Random(seed), context.Q, context.B, station_score=station_score)
        for seed in range(5)
    ]
    print(f"probe design sizes: {[len(d) for d in designs]}")
    bench_naive_vs_persistent(context, designs)

    exact_obj, exact_runtime = run_direct_full_mip(config)

    alns_cfg = ALNSConfig(max_iterations=400, max_time_seconds=180.0, seed=42)

    lp_gurobi_result, lp_gurobi_wall, lp_gurobi_polished = run_alns_variant(
        context, "lp_gurobi", solve_lp_gurobi, alns_cfg
    )
    lp_highs_result, lp_highs_wall, lp_highs_polished = run_alns_variant(
        context, "lp_highs", solve_lp_highs, alns_cfg
    )

    print("\n=== summary ===")
    print(f"direct full MIP           : obj={exact_obj:.4f}  time={exact_runtime:.3f}s")
    print(f"ALNS+Gurobi-LP -> polish   : obj={lp_gurobi_polished.obj_val:.4f}  "
          f"alns_time={lp_gurobi_wall:.3f}s  gap_vs_exact={(exact_obj - lp_gurobi_polished.obj_val) / exact_obj * 100:.3f}%")
    print(f"ALNS+HiGHS-LP  -> polish   : obj={lp_highs_polished.obj_val:.4f}  "
          f"alns_time={lp_highs_wall:.3f}s  gap_vs_exact={(exact_obj - lp_highs_polished.obj_val) / exact_obj * 100:.3f}%")


if __name__ == "__main__":
    main()
