"""
Static, design-independent problem data shared across every ALNS iteration.

Building this once avoids repeating the expensive parts of instance setup
(shortest-path enumeration, path categorization, arc/node index maps) on
every candidate design evaluation. Only `model.sets.set_sets` and
`model.parameters.set_parameters` are needed for this -- both are plain
Python data-preparation functions that never touch a Gurobi model.
"""
from model.sets import set_sets
from model.parameters import set_parameters


class ProblemContext:
    """Duck-typed stand-in for BikeSharingModel, built once per instance.

    Exposes exactly the attributes `set_sets`/`set_parameters` read or
    write, plus `epsilon` for the weighted objective. Downstream oracle
    calls build a fresh Gurobi model per design but reuse every attribute
    on this object without recomputation.
    """

    def __init__(self, network, shortest_path_solver, demand_generator, epsilon):
        self.network = network
        self.shortest_path_solver = shortest_path_solver
        self.demand_generator = demand_generator
        self.demand_matrix = demand_generator.demand_matrix
        self.epsilon = epsilon
        # set_parameters branches on solve_mode only to decide whether the
        # operational (rebalancing) budget is available; "integrated" gives
        # the full operational budget, matching a from-scratch design solve.
        self.solve_mode = "integrated"

        set_sets(self)
        set_parameters(self)
