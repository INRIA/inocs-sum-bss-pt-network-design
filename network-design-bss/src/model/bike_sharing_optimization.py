import gurobipy as gp

from model.constraints import set_constraints
from model.model_template import AbstractModel
from model.objective import set_objective, set_two_stage_objective, \
    set_weighted_multi_objective, set_embedded_lexicographic_objectives
from model.parameters import set_parameters
from output_handler.post_process import post_process, save_selected_stations_geojson
from model.sets import set_sets
from model.variables import set_variables
from output_handler.read_json import save_gurobi_results
from typing import Optional


class BikeSharingModel(AbstractModel):
    def __init__(self, network, shortest_path_solver, demand_generator, epsilon=None,
                 solve_mode="integrated", fixed_design=None, time_limit: float = 3600.0):
        super().__init__()
        self.total_time_gain = None
        self.network = network
        self.shortest_path_solver = shortest_path_solver
        self.demand_generator = demand_generator
        self.epsilon = epsilon
        self.solve_mode = solve_mode   # "integrated", "sequential_stage1", "sequential_stage2"
        self.fixed_design = fixed_design
        self.time_limit = time_limit
        self.demand_matrix = self.demand_generator.demand_matrix
        self.model = gp.Model('NetworkDesign')
        self.solve()

    def _set_sets(self):
        """ 定义集合 """
        set_sets(self)

    def _set_parameters(self):
        set_parameters(self)

    def _set_variables(self):
        set_variables(self)
        print("=== Variables Initialization Completed ===")

    def _set_objective(self):
        # set_objective(self)
        set_weighted_multi_objective(self)
        # set_embedded_lexicographic_objectives(self)
        # set_two_stage_objective(self)
        print("=== Objectives Initialization Completed ===")

    def _set_constraints(self):
        set_constraints(self)
        print(f"=== Constraints Initialization Completed ===")
        print(f"Final total constraints count: {self.model.NumConstrs}")

    def _post_process(self):
        post_process(self)

    def _save_json(self):
        save_gurobi_results(self)
        save_selected_stations_geojson(self)

    def get_design_solution(self):
        return {
            "y": {i: self.y[i].X for i in self.B},
            "w": {i: self.w[i].X for i in self.B},
            "v1": {i: self.v[i, 0].X for i in self.B},
        }
