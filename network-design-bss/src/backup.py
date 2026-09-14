from input_handler.demand_generator import DemandGenerator
from input_handler.grid_generator import GridGenerator
from input_handler.h3_grid_generator import H3GridGenerator
from input_handler.preprocess import preprocess
from input_handler.pt_generator import PublicTransport
from instance_builder import *
from model.bike_sharing_optimization import BikeSharingModel
from network.network_constructor import NetworkConstructor
from network.node import TransferStation, BikeStation
from output_handler.experiment import ExperimentHandler
from shortest_path.shortest_path_solver import ShortestPathSolver
from util.cost import CostParameters
from util.util import *
from output_handler.visualize import Visualize
from input_handler.instance_attribute_extracter import get_instance_attribute


def run_experiment():
    """大规模数值实验"""
    (budget_values, coverage_ratios, operational_budget_ratios,
     random_seeds, total_trips_values) = get_config_parameter_range()

    for coverage_ratio in tqdm(coverage_ratios, desc="Coverage Ratios"):
        for total_trips in tqdm(total_trips_values, desc="Total Trips", leave=False):
            for budget in tqdm(budget_values, desc="Budget", leave=False):
                for op_budget_ratio in tqdm(operational_budget_ratios, desc="Op Budget", leave=False):
                    for demand_type in ["unimodal", "uniform", "bimodal"]:  # "unimodal" "uniform", "bimodal",
                        for run_id, seed in enumerate(random_seeds):
                            CostParameters.total_budget = budget
                            CostParameters.operational_budget_ratio = op_budget_ratio
                            CostParameters.operational_budget = budget * op_budget_ratio
                            config_name = (
                                f"COV{coverage_ratio:.1f}_TRIPS{total_trips}_DIS{demand_type}_"
                                f"BUD{budget}_OP{op_budget_ratio}_SEED{run_id}"
                            )

                            grid_generator, public_transport, bike_stations, demand_generator = preprocess(AREA_LENGTH,
                                                                                                           AREA_WIDTH,
                                                                                                           CELL_SIZE,
                                                                                                           total_trips,
                                                                                                           coverage_ratio,
                                                                                                           demand_type,
                                                                                                           seed)

                            G, grid_centers = grid_generator.grid, grid_generator.grid_centers

                            # transportation network before introducing bike stations (no distance threshold)
                            network_without_bss = NetworkConstructor(G, grid_generator, public_transport,
                                                                     None, True, False)
                            shortest_path_without_bss = ShortestPathSolver(network_without_bss.graph, 1, "before")

                            # transportation network after introducing bike stations (distance threshold constrained)
                            network_with_bss = NetworkConstructor(G, grid_generator, public_transport, bike_stations)
                            shortest_path_solver = ShortestPathSolver(network_with_bss.graph, NUM_SHORTEST_PATHS,
                                                                      "after", shortest_path_without_bss)

                            bike_sharing_model = BikeSharingModel(network_with_bss, shortest_path_solver,
                                                                  demand_generator)

                            ExperimentHandler(bike_sharing_model, network_with_bss, config_name)

                            # Visualize(grid_generator, public_transport, shortest_path_solver, demand_generator,
                            #           bike_sharing_model)
