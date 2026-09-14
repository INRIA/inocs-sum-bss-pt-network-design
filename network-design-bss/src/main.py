import sys
from itertools import product

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
from model.sequential_optimization import solve_sequential, optimization_model_solver


def main_run_single_instance(instance_config, epsilon, solve_mode="integrated"):
    """
    :param instance_config:
    :param epsilon:
    :param solve_mode: "integrated" or "sequential"
    :return: bike_sharing_model  (so callers can chain or compare results)
    """
    configure, demand_generator, grid_generator, public_transport, station_layout = \
        get_instance_attribute(instance_config)

    network_with_bss, shortest_path_solver = get_shortest_path_solver(grid_generator, public_transport, station_layout)

    bike_sharing_model = optimization_model_solver(demand_generator, epsilon, network_with_bss, shortest_path_solver,
                                                   solve_mode)

    ExperimentHandler(bike_sharing_model, network_with_bss, configure)

    Visualize(grid_generator, public_transport, shortest_path_solver, demand_generator, bike_sharing_model)

    return bike_sharing_model, network_with_bss, shortest_path_solver, demand_generator


def get_shortest_path_solver(grid_generator, public_transport, station_layout):
    G, grid_centers = grid_generator.grid, grid_generator.grid_centers

    # transportation network before introducing bike stations (no distance threshold)
    network_without_bss = NetworkConstructor(G, grid_generator, public_transport,
                                             None, True, False)
    shortest_path_without_bss = ShortestPathSolver(network_without_bss.graph, 1, "before")

    # transportation network after introducing bike stations
    network_with_bss = NetworkConstructor(G, grid_generator, public_transport, station_layout, False)
    shortest_path_solver = ShortestPathSolver(network_with_bss.graph, NUM_SHORTEST_PATHS,
                                              "after", shortest_path_without_bss)
    return network_with_bss, shortest_path_solver


# def main(config_name):
#
#     configure, demand_generator, grid_generator, public_transport, station_layout = get_instance_attribute(
#         config_name)
#
#     network_with_bss, shortest_path_solver = get_shortest_path_solver(grid_generator, public_transport, station_layout)
#
#     bike_sharing_model = BikeSharingModel(network_with_bss, shortest_path_solver,
#                                           demand_generator)
#
#     ExperimentHandler(bike_sharing_model, network_with_bss, configure)
#
#     Visualize(grid_generator, public_transport, shortest_path_solver, demand_generator, bike_sharing_model)

def main(instance_config):
    configure, demand_generator, grid_generator, public_transport, station_layout = \
        get_instance_attribute(instance_config)

    network_with_bss, shortest_path_solver = get_shortest_path_solver(grid_generator, public_transport, station_layout)

    bike_sharing_model = BikeSharingModel(network_with_bss, shortest_path_solver,
                                          demand_generator)

    ExperimentHandler(bike_sharing_model, network_with_bss, configure)

    Visualize(grid_generator, public_transport, shortest_path_solver, demand_generator, bike_sharing_model)


def batch_h3_instances():
    T = 3
    seeds = [10]
    # period_weight_sets = {
    #     f"dirichlet_{s}": tuple(
    #         np.random.RandomState(s).dirichlet(np.ones(T) * 0.5)
    #     )
    #     for s in seeds
    # }
    period_weight_sets = {
        # 算了两遍原因找到了。。。
        # "dirichlet": tuple(np.random.dirichlet(np.ones(T) * 0.5)),

        **{
            f"dirichlet_{s}": tuple(
                np.random.RandomState(s).dirichlet(np.ones(T) * 0.5)
            )
            for s in seeds
        },
        # "bimodal_base": (0.4, 0.2, 0.4),

        # "bimodal_sharp": (0.45, 0.10, 0.45),
        # "bimodal_flat": (1/3, 1/3, 1/3),

        # "uniform": (1 / 3, 1 / 3, 1 / 3),
        # "unimodal_morning": (0.6, 0.2, 0.2),
        # "unimodal_evening": (0.15, 0.15, 0.7),

        # "midday_peak": (0.25, 0.50, 0.25),

        # "bimodal_skew_morning": (0.50, 0.20, 0.30),
        # "bimodal_skew_evening": (0.30, 0.20, 0.50),
        # "bimodal_extended_periods": (0.1, 0.3, 0.2, 0.3, 0.1),
    }
    total_budgets = tuple(range(80000, 100001, 20000))
    op_budget_ratios = tuple(i * 0.025 for i in range(1, 2))  # (0, 0.025, 0.05, 0.1)
    epsilon_sets = [0.04, 0.08]  # [0, 0.01, 0.04, 0.08, 0.12]
    seeds = [100]
    for weight_name, period_weights in period_weight_sets.items():
        for bud, op_ratio, seed, epsilon in product(total_budgets, op_budget_ratios, seeds, epsilon_sets):
            scenario = ScenarioConfig(
                name="Geneva",
                demand_config=DemandConfig(
                    seed=seed,
                    demand_periods=T,
                    period_weights= period_weights,
                    split_method="multinomial",
                    # 如果你 DemandConfig 里还有 demand_type 等字段，也可以在这里补上
                ),
                budget_config=BudgetConfig(
                    total_budget=bud,
                    op_budget_ratio=op_ratio,
                )
            )
            instance = InstanceGenerator(scenario)
            instance.build_realistic_scenario()
            instance.save_to_file("h3_instances_json")
            main_run_single_instance(instance, epsilon, solve_mode="integrated")
            # main_run_single_instance(instance, epsilon, solve_mode="sequential")


if __name__ == '__main__':
    # single test
    config = generate_h3_instances()

    # ── Individual solve modes ───────────────────────────────────────────────
    main_run_single_instance(config, epsilon=EPSILON, solve_mode="integrated")
    # main_run_single_instance(config, epsilon=EPSILON, solve_mode="sequential")

    # batch test
    # batch_h3_instances()

    # if len(sys.argv) < 2:
    #     print("Please provide instance file path")
    #     sys.exit(1)
    # instance_file = sys.argv[1]  # 命令行里传给 Python 脚本的“第一个参数”（要解的是哪一个 instance 文件）
    # main(instance_file)