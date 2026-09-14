"""
Lower-level "given a fixed station design y, solve the operational
subproblem (w, v, x, f, r, n)" solvers, used by ALNS to score candidate
designs without re-running the full station-selection MIP.

Measured on the small baseline instance: building the ~58k-variable /
~39k-constraint operational model from scratch (model.variables.set_variables
+ model.constraints.set_constraints, i.e. the Python-side loops that call
addVar/addConstr thousands of times) costs ~3.4s, while actually SOLVING it
costs 27-46ms regardless of MIP vs LP. So naive "call Gurobi fresh per
candidate design" ALNS would spend >99% of its time rebuilding a model whose
structure never changes across iterations -- only which y are fixed to 0/1
does. PersistentOperationalModel builds that structure ONCE per ALNS run and
every oracle call below just mutates y's bounds and re-optimizes (or
relaxes+re-optimizes a fresh LP copy), which is the actual fix the user's
"repeated Gurobi calls might be slow" concern needed.

Three interchangeable oracles built on top of that persistent model:

- solve_mip_gurobi : fixed y, full integer re-solve (Gurobi branch & bound),
                     warm-started from the previous call's basis.
- solve_lp_gurobi  : fixed y, LP relaxation of everything else (Gurobi
                     simplex/barrier via model.relax(), no branching).
- solve_lp_highs   : the SAME LP as solve_lp_gurobi, but solved by SciPy's
                     HiGHS engine instead of Gurobi (matrices are extracted
                     straight from the relaxed Gurobi model, so both oracles
                     solve one identical LP -- only the solver differs).

n (rebalancing vehicle count) carries a fixed dispatch cost per vehicle,
which is not part of a plain flow LP. The LP oracles drop that fixed-cost
term (keep only the linear per-distance rebalancing cost) and recover n
afterwards as ceil(r / vehicle_capacity), which only affects the
*approximate* score ALNS uses while searching; the final reported objective
always comes from one exact solve_mip_gurobi call on the best design found.
"""
import math
import time
from dataclasses import dataclass, field

import gurobipy as gp
import numpy as np
from scipy import sparse
from scipy.optimize import linprog

from model.variables import set_variables
from model.constraints import set_constraints
from model.objective import set_weighted_multi_objective
from util.cost import CostParameters
from util.util import CAPACITY_REBALANCING_VEHICLE

_SHARED_ATTRS = (
    "I", "K", "J", "B", "A_bike_network",
    "bike_outbound_station", "bike_inbound_station",
    "M1", "M2", "M3", "T", "T_1",
    "Q", "Q_r", "cs", "cp", "cu", "q_ub",
    "delta_ijr", "arc_to_paths", "node_to_paths", "path_to_nodes",
    "pi_kr", "M", "alpha", "penalty_coefficient", "total_flows",
    "demand_matrix", "shortest_path_solver", "demand_generator",
    "epsilon", "solve_mode",
)

GRB_INF = 1e100


@dataclass
class OracleResult:
    obj_val: float
    runtime: float
    feasible: bool
    station_flow: dict = field(default_factory=dict)
    w: dict = field(default_factory=dict)
    v1: dict = field(default_factory=dict)
    solver: str = ""
    extra: dict = field(default_factory=dict)


class PersistentOperationalModel:
    """Builds the operational model's variables/constraints/objective ONCE
    (y free binary), then lets callers repeatedly fix y to different
    candidate designs and re-solve without rebuilding anything."""

    def __init__(self, context):
        for attr in _SHARED_ATTRS:
            setattr(self, attr, getattr(context, attr))
        self.model = gp.Model("alns_subproblem")
        self.model.Params.OutputFlag = 0
        set_variables(self)
        set_constraints(self)
        set_weighted_multi_objective(self)
        self.model.update()
        self._relaxed_shell = None

    def set_design(self, design):
        for station in self.B:
            fixed = 1 if station in design else 0
            self.y[station].LB = fixed
            self.y[station].UB = fixed
        self.model.update()

    def relaxed_shell(self):
        """One LP relaxation of the model, built once purely as a STRUCTURE
        template for solve_lp_highs' matrix extraction (_lp_arrays) -- it is
        never re-optimized itself, only read for its constraint matrix/
        objective coefficients. (An earlier version of this method also
        reused this same relaxed model for solve_lp_gurobi by mutating its y
        bounds and re-optimizing in place, on the theory that Gurobi would
        warm-start from the previous basis. Measured A/B on the baseline
        instance: that was actually 4-5x SLOWER than just calling
        model.relax() fresh each time (26ms/call vs ~115-150ms/call) --
        mutating bounds on an already-solved model apparently prevents
        Gurobi's presolve from re-pruning the now-fixed-closed stations'
        variables/constraints as aggressively as a fresh relax() of the
        current bounds does. solve_lp_gurobi below relaxes fresh every call;
        only the matrix-structure extraction for HiGHS benefits from reuse
        here, since it never touches Gurobi's own solve path.)"""
        if self._relaxed_shell is None:
            self._relaxed_shell = self.model.relax()
            self._relaxed_shell.Params.OutputFlag = 0
        return self._relaxed_shell


def solve_root_relaxation(pool: PersistentOperationalModel):
    """Solve the FULL LP relaxation with y left continuous/free (not fixed
    to any particular design) exactly once, before any set_design() call
    ever touches the persistent model's y bounds -- pool.relaxed_shell() at
    that point is precisely "the whole problem's LP relaxation, y included".
    The fractional y* is a strong construction prior: this problem's root
    relaxations tend to already be nearly integral (see
    docs/alns_vs_gurobi_scale_test.md), so y* mostly separates into clear
    "open"/"closed" stations plus a handful of genuinely fractional ones,
    far more informative than a purely structural path-count/demand prior.
    y's reduced costs are also returned, cached for future dual-guided
    destroy/repair operators (not used by any operator yet).

    Must be called before the first set_design()/solve_*(pool, design) call
    on this pool, or the relaxation will reflect whatever design was last
    fixed instead of the true unconstrained root relaxation.
    """
    shell = pool.relaxed_shell()
    shell.optimize()
    y_star, y_reduced_cost = {}, {}
    for station in pool.B:
        var = shell.getVarByName(pool.y[station].VarName)
        y_star[station] = var.X
        y_reduced_cost[station] = var.RC
    return y_star, y_reduced_cost


def _station_flow_from_getter(m, getter):
    """Aggregate bike-arc throughput per station: sum of f[i,*,t]+f[*,i,t]."""
    flow = {station: 0.0 for station in m.B}
    for (i, j, t), var in m.f.items():
        val = getter(var)
        if val:
            flow[i] = flow.get(i, 0.0) + val
            flow[j] = flow.get(j, 0.0) + val
    return flow


def solve_mip_gurobi(pool: PersistentOperationalModel, design, time_limit=60.0,
                     mip_gap=0.0, warm_hints=None):
    t0 = time.time()
    pool.set_design(design)
    pool.model.Params.TimeLimit = time_limit
    pool.model.Params.MIPGap = mip_gap
    if warm_hints:
        for station, val in warm_hints.get("w", {}).items():
            if station in pool.B and val > 0:
                pool.w[station].Start = val
        for station, val in warm_hints.get("v1", {}).items():
            if station in pool.B and val > 0:
                pool.v[station, 0].Start = val
    pool.model.optimize()
    runtime = time.time() - t0
    feasible = pool.model.SolCount > 0
    if not feasible:
        return OracleResult(obj_val=float("-inf"), runtime=runtime,
                            feasible=False, solver="mip_gurobi")
    obj_val = float(pool.model.ObjVal)
    station_flow = _station_flow_from_getter(pool, lambda v: v.X)
    w = {station: pool.w[station].X for station in pool.B}
    v1 = {station: pool.v[station, 0].X for station in pool.B}
    return OracleResult(obj_val=obj_val, runtime=runtime, feasible=True,
                        station_flow=station_flow, w=w, v1=v1,
                        solver="mip_gurobi",
                        extra={"status": pool.model.Status,
                               "mip_gap": float(pool.model.MIPGap)})


def solve_lp_gurobi(pool: PersistentOperationalModel, design):
    """Relaxes a FRESH copy of the persistent MIP model every call (still
    skips the ~3.4s set_variables/set_constraints rebuild, only re-pays the
    cheap relax()+optimize()). See PersistentOperationalModel.relaxed_shell's
    docstring for why reusing one relaxed model in place is slower, not
    faster, despite the theoretical warm-start appeal."""
    t0 = time.time()
    pool.set_design(design)
    relaxed = pool.model.relax()
    relaxed.Params.OutputFlag = 0
    relaxed.optimize()
    runtime = time.time() - t0
    feasible = relaxed.Status == gp.GRB.OPTIMAL
    if not feasible:
        relaxed.dispose()
        return OracleResult(obj_val=float("-inf"), runtime=runtime,
                            feasible=False, solver="lp_gurobi")
    obj_val = float(relaxed.ObjVal)
    name_to_val = {v.VarName: v.X for v in relaxed.getVars()}
    station_flow = _station_flow_from_getter(pool, lambda v: name_to_val.get(v.VarName, 0.0))
    obj_val, w, v1 = _repair_dispatch_fixed_cost(pool, name_to_val, obj_val)
    relaxed.dispose()
    return OracleResult(obj_val=obj_val, runtime=runtime, feasible=True,
                        station_flow=station_flow, w=w, v1=v1,
                        solver="lp_gurobi")


def _repair_dispatch_fixed_cost(pool, name_to_val, obj_val):
    """The LP objective (model.objective.set_weighted_multi_objective) already
    charges a linear dispatch cost per unit of r, but not the fixed cost per
    vehicle n. Approximate n = ceil(r / vehicle capacity) and subtract the
    (previously un-charged) fixed-cost component from the objective.
    """
    fixed_only = 0.0
    for (i, j, t), var in pool.r.items():
        r_val = name_to_val.get(var.VarName, 0.0)
        if r_val <= 1e-9:
            continue
        n_val = math.ceil(r_val / CAPACITY_REBALANCING_VEHICLE - 1e-9)
        fixed_only += n_val * CostParameters.dispatch_fixed_cost

    obj_val = obj_val - pool.epsilon * fixed_only if pool.epsilon else obj_val
    w = {station: name_to_val.get(pool.w[station].VarName, 0.0) for station in pool.B}
    v1 = {station: name_to_val.get(pool.v[station, 0].VarName, 0.0) for station in pool.B}
    return obj_val, w, v1


def _lp_arrays(pool: PersistentOperationalModel):
    """Extract the LP's constraint matrix/objective ONCE (design-independent
    -- only y's bounds vary across designs) and cache it on the pool, so
    solve_lp_highs doesn't re-walk ~58k Gurobi variables / ~39k constraints
    through the Python API on every design evaluation."""
    if getattr(pool, "_lp_arrays_cache", None) is not None:
        return pool._lp_arrays_cache

    shell = pool.relaxed_shell()
    variables = shell.getVars()
    var_index = {v.VarName: idx for idx, v in enumerate(variables)}
    lb = np.array(shell.getAttr("LB", variables), dtype=float)
    ub = np.array(shell.getAttr("UB", variables), dtype=float)
    obj_coef = np.array(shell.getAttr("Obj", variables), dtype=float)
    sense = shell.ModelSense  # 1 = minimize, -1 = maximize
    c = obj_coef if sense == 1 else -obj_coef

    constrs = shell.getConstrs()
    A = shell.getA().tocsr()
    senses = shell.getAttr("Sense", constrs)
    rhs = np.array(shell.getAttr("RHS", constrs), dtype=float)

    le = np.array([s == "<" for s in senses])
    ge = np.array([s == ">" for s in senses])
    eq = np.array([s == "=" for s in senses])

    ub_blocks, ub_rhs = [], []
    if le.any():
        ub_blocks.append(A[le]); ub_rhs.append(rhs[le])
    if ge.any():
        ub_blocks.append(-A[ge]); ub_rhs.append(-rhs[ge])
    A_ub = sparse.vstack(ub_blocks).tocsr() if ub_blocks else None
    b_ub = np.concatenate(ub_rhs) if ub_rhs else None
    A_eq = A[eq].tocsr() if eq.any() else None
    b_eq = rhs[eq] if eq.any() else None

    y_indices = {station: var_index[pool.y[station].VarName] for station in pool.B}

    pool._lp_arrays_cache = dict(
        var_index=var_index, lb=lb, ub=ub, c=c, sense=sense,
        A_ub=A_ub, b_ub=b_ub, A_eq=A_eq, b_eq=b_eq, y_indices=y_indices,
    )
    return pool._lp_arrays_cache


def solve_lp_highs(pool: PersistentOperationalModel, design):
    t0 = time.time()
    cache = _lp_arrays(pool)
    var_index = cache["var_index"]
    lb = cache["lb"].copy()
    ub = cache["ub"].copy()
    for station, idx in cache["y_indices"].items():
        fixed = 1.0 if station in design else 0.0
        lb[idx] = fixed
        ub[idx] = fixed

    bounds = [
        (None if l <= -GRB_INF else l, None if u >= GRB_INF else u)
        for l, u in zip(lb, ub)
    ]

    res = linprog(cache["c"], A_ub=cache["A_ub"], b_ub=cache["b_ub"],
                  A_eq=cache["A_eq"], b_eq=cache["b_eq"],
                  bounds=bounds, method="highs")
    runtime = time.time() - t0
    sense = cache["sense"]

    if not res.success:
        return OracleResult(obj_val=float("-inf"), runtime=runtime,
                            feasible=False, solver="lp_highs",
                            extra={"highs_status": res.status, "message": res.message})

    obj_val = float(res.fun) if sense == 1 else float(-res.fun)
    name_to_val = {name: res.x[idx] for name, idx in var_index.items()}
    pool_for_flow = _PoolView(pool)
    station_flow = _station_flow_from_getter(pool_for_flow, lambda v: name_to_val.get(v.VarName, 0.0))
    obj_val, w, v1 = _repair_dispatch_fixed_cost(pool_for_flow, name_to_val, obj_val)
    return OracleResult(obj_val=obj_val, runtime=runtime, feasible=True,
                        station_flow=station_flow, w=w, v1=v1,
                        solver="lp_highs")


class _PoolView:
    """f/w/v/r/B/epsilon come from the ORIGINAL (unrelaxed) persistent model;
    VarName strings are identical in the relaxed copy, so looking values up
    by name against the parent model's variable objects is safe."""

    def __init__(self, pool):
        self.f = pool.f
        self.w = pool.w
        self.v = pool.v
        self.r = pool.r
        self.B = pool.B
        self.epsilon = pool.epsilon
